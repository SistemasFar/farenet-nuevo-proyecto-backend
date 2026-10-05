const db = require('../../../config/database');
const { randomUUID } = require('node:crypto');
const configService = require('./faregas-config.service');
const productosImpactoService = require('./faregas-productos-impacto.service');
const paginacion = require('./faregas-paginacion.rules');

/** Centinela del filtro "Sin categoría" (productos con categoria_id NULL). */
const SIN_CATEGORIA = 'SIN_CATEGORIA';

/** Normaliza los decimales que Postgres devuelve como numeric. */
const mapearProducto = (producto) => ({
    ...producto,
    // `fg_producto_facturacion.id` es bigint y node-postgres lo entrega como
    // string. El contrato HTTP y el frontend lo tratan como number; si no se
    // normaliza, Map distingue "273" de 273 y pierde relaciones válidas.
    id: Number(producto.id),
    precio_unitario: producto.precio_unitario === null ? null : Number(producto.precio_unitario),
    precio_referencia: producto.precio_referencia === null ? null : Number(producto.precio_referencia),
    valor_referencial_unitario: producto.valor_referencial_unitario === null ? null : Number(producto.valor_referencial_unitario),
    porcentaje_isc: producto.porcentaje_isc === null ? null : Number(producto.porcentaje_isc),
    precio_chip: producto.precio_chip === null ? null : Number(producto.precio_chip)
});

exports.mapearProducto = mapearProducto;

exports.listar = async ({ buscar, estado, paraVenta, unidad, categoriaId, page, pageSize } = {}) => {
    const { page: pagina, limit, offset } = paginacion.normalizarPaginacion({ page, pageSize });
    const condiciones = [];
    const valores = [];
    const agregar = (sql, valor) => {
        valores.push(valor);
        condiciones.push(sql.replace('?', `$${valores.length}`));
    };

    if (buscar) {
        valores.push(`%${buscar}%`);
        const codigoParam = `$${valores.length}`;
        valores.push(`%${buscar}%`);
        const descripcionParam = `$${valores.length}`;
        condiciones.push(`(p.codigo_sku ILIKE ${codigoParam} OR p.descripcion ILIKE ${descripcionParam})`);
    }
    if (estado === true || estado === false) agregar('p.activo = ?', estado);
    if (paraVenta === true || paraVenta === false) agregar('p.es_para_venta = ?', paraVenta);
    if (unidad) agregar('p.unidad = ?', unidad);
    if (categoriaId) {
        // El filtro "Sin categoría" no se puede expresar con una igualdad: son
        // los productos cuya categoria_id es NULL. Se reconoce por el centinela
        // que ya usa la pantalla, para no quitarle esa opción al usuario.
        if (categoriaId === SIN_CATEGORIA) condiciones.push('p.categoria_id IS NULL');
        else agregar('p.categoria_id = ?', categoriaId);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    // El COUNT usa los MISMOS filtros que el listado, para que el total sea el
    // del resultado filtrado y nunca items.length.
    const conteo = await db.query(
        `SELECT COUNT(*)::int AS total FROM fg_producto_facturacion p
         LEFT JOIN fg_categoria_servicio c ON c.id = p.categoria_id
         ${where}`,
        valores
    );

    // Catalogo maestro: NO se filtra por fecha. Se muestran todos los
    // productos funcionales, solo paginados.
    const result = await db.query(`
        SELECT p.id, p.codigo_sku, p.descripcion, p.tipo_producto, p.categoria_dms,
               p.categoria_id, c.codigo AS categoria_codigo, c.nombre AS categoria_nombre,
               COALESCE(ARRAY(
                   SELECT DISTINCT planta.nombre
                   FROM fg_tarifa tarifa
                   JOIN fg_planta planta ON planta.key = tarifa.planta_key
                   WHERE tarifa.producto_facturacion_id = p.id
                     AND tarifa.activo = TRUE
                     AND planta.activo = TRUE
                   ORDER BY planta.nombre
               ), ARRAY[]::text[]) AS sedes_faregas,
               p.cuenta_por_cobrar, p.codigo_barras, p.unidad,
               p.precio_unitario, p.precio_referencia,
               p.valor_referencial_unitario, p.codigo_clasificacion_sunat,
               p.tipo_afectacion_igv, p.codigo_afectacion_isc, p.porcentaje_isc,
               p.disponible_pos, p.es_para_venta, p.es_para_compra,
               p.tiene_icbper, p.imagen_url, p.activo,
               p.requiere_chip, p.producto_chip_id, p.precio_chip,
               p.fecha_creacion, p.fecha_modificacion
        FROM fg_producto_facturacion p
        LEFT JOIN fg_categoria_servicio c ON c.id = p.categoria_id
        ${where}
        ORDER BY p.codigo_sku ASC
        LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}
    `, [...valores, limit, offset]);

    // Catálogo de unidades tributarias del catálogo COMPLETO, no del resultado
    // filtrado. Si se calculara sobre la página, al buscar un texto el desplegable
    // "Unidad" se quedaría con las unidades de los productos encontrados y
    // dejaría de ofrecer el resto.
    const unidades = await db.query(
        `SELECT DISTINCT p.unidad FROM fg_producto_facturacion p
         WHERE p.unidad IS NOT NULL AND p.unidad <> ''
         ORDER BY p.unidad ASC`
    );

    const envelope = paginacion.respuestaPaginada(
        result.rows.map(mapearProducto),
        Number(conteo.rows[0]?.total || 0),
        pagina,
        limit
    );

    // `productos` se conserva para no romper a los consumidores actuales.
    return {
        ...envelope,
        productos: envelope.items,
        unidades: unidades.rows.map((row) => row.unidad)
    };
};

/**
 * Productos QUE TIENEN CATEGORÍA, agrupados por `categoria_id`.
 *
 * La pantalla "Operación y formatos" (Catálogo) recorre categoría por categoría
 * y necesita saber qué producto fiscal pertenece a cada una. Antes usaba el
 * listado paginado del catálogo, que devuelve sólo 10 filas de 271: cualquier
 * categoría cuyo producto no caía en esa primera página aparecía con
 * "0 producto(s)", y sin producto no se habilitaba el botón de
 * "+ Configurar operación", con lo que la operación era imposible de crear
 * desde esa pantalla.
 *
 * A diferencia del listado, aquí NO se pagina y NO se corta con un pageSize
 * grande: el conjunto está acotado por la propia naturaleza de los datos (solo
 * los productos con categoría asignada), igual que `obtenerSedesPorServicio`.
 * Los productos sin categoría no pertenecen a ninguna categoría operativa y no
 * tienen nada que mostrar en esta vista.
 *
 * No crea ni inventa ninguna relación: devuelve lo que ya existe.
 */
exports.listarPorCategoria = async () => {
    const result = await db.query(`
        SELECT p.id, p.codigo_sku, p.descripcion, p.tipo_producto, p.categoria_dms,
               p.categoria_id, c.codigo AS categoria_codigo, c.nombre AS categoria_nombre,
               p.cuenta_por_cobrar, p.codigo_barras, p.unidad,
               p.precio_unitario, p.precio_referencia,
               p.valor_referencial_unitario, p.codigo_clasificacion_sunat,
               p.tipo_afectacion_igv, p.codigo_afectacion_isc, p.porcentaje_isc,
               p.disponible_pos, p.es_para_venta, p.es_para_compra,
               p.tiene_icbper, p.imagen_url, p.activo,
               p.requiere_chip, p.producto_chip_id, p.precio_chip,
               p.fecha_creacion, p.fecha_modificacion
        FROM fg_producto_facturacion p
        JOIN fg_categoria_servicio c ON c.id = p.categoria_id
        ORDER BY c.codigo ASC, p.codigo_sku ASC
    `);

    const porCategoria = {};
    for (const fila of result.rows) {
        const producto = mapearProducto(fila);
        (porCategoria[fila.categoria_id] = porCategoria[fila.categoria_id] || []).push(producto);
    }
    return {
        porCategoria,
        productos: result.rows.map(mapearProducto),
        total: result.rows.length
    };
};

const validarCategoriaActiva = async (client, categoriaId) => {
    const categoria = await client.query(
        'SELECT id, codigo, nombre FROM fg_categoria_servicio WHERE id = $1 AND activo = TRUE',
        [categoriaId]
    );
    if (categoria.rowCount === 0) throw new Error('CATEGORIA_NO_DISPONIBLE');
    return categoria.rows[0];
};


const validarProductoChip = async (client, requiereChip, productoChipId) => {
    if (!requiereChip) return null;
    if (!productoChipId) throw new Error('CHIP_REQUERIDO');
    const chipRes = await client.query(
        'SELECT id, tipo, activo, control_stock FROM fg_producto_inventariable WHERE id = $1',
        [productoChipId]
    );
    if (chipRes.rowCount === 0) throw new Error('CHIP_NOT_FOUND');
    if (!chipRes.rows[0].activo) throw new Error('CHIP_INACTIVO');
    if (!chipRes.rows[0].control_stock) throw new Error('CHIP_SIN_CONTROL_STOCK');
    if (chipRes.rows[0].tipo !== 'CHIP_SERIALIZADO') throw new Error('CHIP_TIPO_INVALIDO');
    return productoChipId;
};

const validarPrecioChip = (requiereChip, precioChip) => {
    if (!requiereChip) return null;
    // El precio operativo del chip se resuelve por sede desde la configuración
    // del tipo de chip. `precio_chip` se conserva únicamente por compatibilidad
    // con productos antiguos que ya tuvieran ese valor grabado.
    if (precioChip === null || precioChip === undefined || precioChip === '') return null;
    const precio = Number(precioChip);
    if (!Number.isFinite(precio) || precio <= 0) throw new Error('CHIP_PRECIO_INVALIDO');
    return precio;
};

/**
 * Núcleo de inserción + auditoría de un producto fiscal. Lo comparten
 * `exports.crear` y `exports.crearSinCategoria`: misma transacción, mismo
 * INSERT, misma auditoría y mismo mapeo de errores.
 *
 * `validarCategoria` llega como Bandera porque la única diferencia entre ambos
 * métodos es si la categoría funcional es obligatoria.
 */
const insertarProducto = async (producto, username, ip_direccion, { validarCategoria }) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        if (validarCategoria) {
            await validarCategoriaActiva(client, producto.categoria_id);
        }
        const productoChipIdValidado = await validarProductoChip(client, producto.requiere_chip, producto.producto_chip_id);
        const precioChipValidado = validarPrecioChip(producto.requiere_chip, producto.precio_chip);
        const result = await client.query(`
            INSERT INTO fg_producto_facturacion (
                codigo_sku, descripcion, tipo_producto, categoria_dms, categoria_id,
                cuenta_por_cobrar, codigo_barras, unidad,
                precio_unitario, precio_referencia,
                valor_referencial_unitario, codigo_clasificacion_sunat,
                tipo_afectacion_igv, codigo_afectacion_isc, porcentaje_isc,
                disponible_pos, es_para_venta, es_para_compra, tiene_icbper,
                imagen_url, activo,
                requiere_chip, producto_chip_id, precio_chip
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19,
                $20, $21, $22, $23, $24
            ) RETURNING id
        `, [
            producto.codigo_sku, producto.descripcion, producto.tipo_producto,
            producto.categoria_dms, producto.categoria_id,
            producto.cuenta_por_cobrar, producto.codigo_barras, producto.unidad,
            producto.precio_unitario, producto.precio_referencia,
            producto.valor_referencial_unitario, producto.codigo_clasificacion_sunat,
            producto.tipo_afectacion_igv, producto.codigo_afectacion_isc,
            producto.porcentaje_isc,
            producto.disponible_pos, producto.es_para_venta,
            producto.es_para_compra, producto.tiene_icbper, producto.imagen_url,
            producto.activo,
            Boolean(producto.requiere_chip), productoChipIdValidado, precioChipValidado
        ]);
        await configService.registrarAuditoria(client, {
            username, entidad: 'PRODUCTO_FACTURACION', accion: 'CREAR_PRODUCTO',
            identificador: producto.codigo_sku,
            detalles: { despues: producto }, planta_key: null, ip_direccion
        });
        await client.query('COMMIT');
        return result.rows[0].id;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw new Error('SKU_DUPLICADO');
        throw error;
    } finally {
        client.release();
    }
};

exports.crear = async (producto, username, ip_direccion) =>
    insertarProducto(producto, username, ip_direccion, { validarCategoria: true });

/**
 * Alta de producto fiscal para migración / carga maestra DMS, cuando todavía
 * NO se ha definido su categoría funcional.
 *
 * Es la ÚNICA diferencia respecto a `exports.crear`: `categoria_id` puede ser
 * NULL. Todo lo demás es idéntico porque se delega en `insertarProducto`:
 * misma validación de chip, mismos tipos, mismo INSERT, misma transacción,
 * misma auditoría (`CREAR_PRODUCTO`) y mismo `SKU_DUPLICADO`.
 *
 * NO se expone como endpoint. `validarCategoriaActiva` sigue exigiendo
 * categoría en `exports.crear` y en `exports.editar`, así que el API público y
 * el formulario estándar no pueden crear productos sin categoría. Este método
 * es para scripts de migración/homologación controlados.
 *
 * `categoria_dms` se conserva tal cual venga (puede ser NULL o el texto de
 * sede de DMS): es información de origen, no la categoría funcional.
 */
exports.crearSinCategoria = async (producto, username, ip_direccion) => {
    if (producto.categoria_id !== null && producto.categoria_id !== undefined) {
        const error = new Error('CREAR_SIN_CATEGORIA_NO_PERMITE_CATEGORIA');
        error.status = 400;
        throw error;
    }
    return insertarProducto(
        { ...producto, categoria_id: null },
        username,
        ip_direccion,
        { validarCategoria: false }
    );
};

exports.editar = async (id, producto, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query('SELECT * FROM fg_producto_facturacion WHERE id = $1 FOR UPDATE', [id]);
        if (actual.rowCount === 0) throw new Error('PRODUCTO_NO_ENCONTRADO');
        await validarCategoriaActiva(client, producto.categoria_id);
        const productoChipIdValidado = await validarProductoChip(client, producto.requiere_chip, producto.producto_chip_id);
        const precioChipValidado = validarPrecioChip(producto.requiere_chip, producto.precio_chip);
        const activo = producto.activo === undefined ? actual.rows[0].activo : producto.activo;
        await client.query(`
            UPDATE fg_producto_facturacion SET
                descripcion = $1, tipo_producto = $2, categoria_dms = $3,
                categoria_id = $4, cuenta_por_cobrar = $5, codigo_barras = $6,
                unidad = $7, precio_unitario = $8, precio_referencia = $9,
                valor_referencial_unitario = $10,
                codigo_clasificacion_sunat = $11, tipo_afectacion_igv = $12,
                codigo_afectacion_isc = $13, porcentaje_isc = $14,
                disponible_pos = $15, es_para_venta = $16,
                es_para_compra = $17, tiene_icbper = $18, imagen_url = $19,
                activo = $20, requiere_chip = $21,
                producto_chip_id = $22, precio_chip = $23,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $24
        `, [
            producto.descripcion, producto.tipo_producto, producto.categoria_dms,
            producto.categoria_id, producto.cuenta_por_cobrar,
            producto.codigo_barras, producto.unidad, producto.precio_unitario,
            producto.precio_referencia, producto.valor_referencial_unitario,
            producto.codigo_clasificacion_sunat, producto.tipo_afectacion_igv,
            producto.codigo_afectacion_isc, producto.porcentaje_isc,
            producto.disponible_pos,
            producto.es_para_venta, producto.es_para_compra,
            producto.tiene_icbper, producto.imagen_url, activo,
            Boolean(producto.requiere_chip), productoChipIdValidado,
            precioChipValidado, id
        ]);
        await configService.registrarAuditoria(client, {
            username, entidad: 'PRODUCTO_FACTURACION', accion: 'EDITAR_PRODUCTO',
            identificador: actual.rows[0].codigo_sku,
            detalles: { antes: actual.rows[0], despues: { ...actual.rows[0], ...producto } },
            planta_key: null, ip_direccion
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Homologa exclusivamente la categoría funcional de un lote controlado.
 *
 * No se publica mediante rutas HTTP. La función existe para cargas internas
 * auditables y evita reutilizar `editar`, que reemplaza el producto completo.
 * Las filas quedan bloqueadas hasta verificar que todos los demás campos
 * permanecen idénticos y confirmar la transacción.
 */
exports.actualizarCategoriasMasivas = async (
    asignaciones,
    username,
    ip_direccion,
    { esperadosActualizar, esperadosYaCorrectos } = {}
) => {
    if (!Array.isArray(asignaciones) || asignaciones.length === 0) {
        throw new Error('HOMOLOGACION_SIN_ASIGNACIONES');
    }

    const normalizadas = asignaciones.map(({ producto_id, categoria_id }) => ({
        producto_id: Number(producto_id),
        categoria_id: Number(categoria_id)
    }));
    if (normalizadas.some(({ producto_id, categoria_id }) =>
        !Number.isInteger(producto_id) || producto_id <= 0
        || !Number.isInteger(categoria_id) || categoria_id <= 0
    )) {
        throw new Error('HOMOLOGACION_ASIGNACION_INVALIDA');
    }

    const idsProductos = normalizadas.map(({ producto_id }) => producto_id);
    if (new Set(idsProductos).size !== idsProductos.length) {
        throw new Error('HOMOLOGACION_PRODUCTO_DUPLICADO');
    }

    const client = await db.connect();
    const loteId = randomUUID();
    try {
        await client.query('BEGIN');

        const categoriasDestino = [...new Set(normalizadas.map(({ categoria_id }) => categoria_id))];
        const categorias = new Map();
        for (const categoriaId of categoriasDestino) {
            const categoria = await validarCategoriaActiva(client, categoriaId);
            categorias.set(categoriaId, categoria);
        }

        const bloqueados = await client.query(`
            SELECT *
            FROM fg_producto_facturacion
            WHERE id = ANY($1::integer[])
            ORDER BY id
            FOR UPDATE
        `, [idsProductos]);
        if (bloqueados.rowCount !== normalizadas.length) {
            throw new Error('HOMOLOGACION_PRODUCTOS_INCOMPLETOS');
        }

        const antesPorId = new Map(bloqueados.rows.map((fila) => [Number(fila.id), fila]));
        if (bloqueados.rows.some((fila) => String(fila.codigo_sku) === '1111112')) {
            throw new Error('HOMOLOGACION_PRODUCTO_PRUEBA_BLOQUEADO');
        }

        const cambios = [];
        const yaCorrectos = [];
        for (const asignacion of normalizadas) {
            const antes = antesPorId.get(asignacion.producto_id);
            if (Number(antes.categoria_id) === asignacion.categoria_id) {
                yaCorrectos.push({
                    producto_id: asignacion.producto_id,
                    codigo_sku: antes.codigo_sku,
                    categoria_id: asignacion.categoria_id
                });
                continue;
            }

            const actualizado = await client.query(`
                UPDATE fg_producto_facturacion
                SET categoria_id = $1
                WHERE id = $2
                  AND categoria_id IS NOT DISTINCT FROM $3::integer
            `, [asignacion.categoria_id, asignacion.producto_id, antes.categoria_id]);
            if (actualizado.rowCount !== 1) {
                throw new Error('HOMOLOGACION_ESTADO_CONCURRENTE');
            }

            const categoria = categorias.get(asignacion.categoria_id);
            await configService.registrarAuditoria(client, {
                username,
                entidad: 'PRODUCTO_FACTURACION',
                accion: 'HOMOLOGAR_CATEGORIA',
                identificador: antes.codigo_sku,
                detalles: {
                    lote_id: loteId,
                    antes: { categoria_id: antes.categoria_id },
                    despues: {
                        categoria_id: asignacion.categoria_id,
                        categoria_codigo: categoria.codigo
                    }
                },
                planta_key: null,
                ip_direccion
            });
            cambios.push({
                producto_id: asignacion.producto_id,
                codigo_sku: antes.codigo_sku,
                categoria_id_anterior: antes.categoria_id,
                categoria_id_nueva: asignacion.categoria_id
            });
        }

        if (Number.isInteger(esperadosActualizar) && cambios.length !== esperadosActualizar) {
            throw new Error('HOMOLOGACION_CANTIDAD_ACTUALIZADA_INESPERADA');
        }
        if (Number.isInteger(esperadosYaCorrectos) && yaCorrectos.length !== esperadosYaCorrectos) {
            throw new Error('HOMOLOGACION_CANTIDAD_CORRECTA_INESPERADA');
        }

        const despues = await client.query(`
            SELECT *
            FROM fg_producto_facturacion
            WHERE id = ANY($1::integer[])
            ORDER BY id
        `, [idsProductos]);
        if (despues.rowCount !== bloqueados.rowCount) {
            throw new Error('HOMOLOGACION_VERIFICACION_INCOMPLETA');
        }

        const asignacionPorId = new Map(normalizadas.map((fila) => [fila.producto_id, fila]));
        for (const filaDespues of despues.rows) {
            const filaAntes = antesPorId.get(Number(filaDespues.id));
            const asignacion = asignacionPorId.get(Number(filaDespues.id));
            if (Number(filaDespues.categoria_id) !== asignacion.categoria_id) {
                throw new Error('HOMOLOGACION_CATEGORIA_NO_APLICADA');
            }
            for (const campo of Object.keys(filaAntes)) {
                if (campo === 'categoria_id') continue;
                const antesComparable = filaAntes[campo] instanceof Date
                    ? filaAntes[campo].toISOString()
                    : filaAntes[campo];
                const despuesComparable = filaDespues[campo] instanceof Date
                    ? filaDespues[campo].toISOString()
                    : filaDespues[campo];
                if (JSON.stringify(antesComparable) !== JSON.stringify(despuesComparable)) {
                    throw new Error(`HOMOLOGACION_CAMPO_ALTERADO:${campo}`);
                }
            }
        }

        await client.query('COMMIT');
        return {
            lote_id: loteId,
            recibidos: normalizadas.length,
            actualizados: cambios.length,
            ya_correctos: yaCorrectos.length,
            auditorias: cambios.length,
            cambios,
            correctos: yaCorrectos
        };
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (_rollbackError) {
            // Se conserva el error que causó el rollback.
        }
        throw error;
    } finally {
        client.release();
    }
};

exports.cambiarEstado = async (id, activo, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query('SELECT * FROM fg_producto_facturacion WHERE id = $1 FOR UPDATE', [id]);
        if (actual.rowCount === 0) throw new Error('PRODUCTO_NO_ENCONTRADO');
        await client.query(`
            UPDATE fg_producto_facturacion
            SET activo = $1, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [activo, id]);
        await configService.registrarAuditoria(client, {
            username, entidad: 'PRODUCTO_FACTURACION',
            accion: activo ? 'ACTIVAR_PRODUCTO' : 'DESACTIVAR_PRODUCTO',
            identificador: actual.rows[0].codigo_sku,
            detalles: { antes: { activo: actual.rows[0].activo }, despues: { activo } },
            planta_key: null, ip_direccion
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const SNAPSHOT_OPERACION_CAMPOS = [
    'codigo_sku_snapshot',
    'descripcion_snapshot',
    'unidad_snapshot',
    'afectacion_igv_snapshot',
    'valor_unitario',
    'precio_unitario',
    'base_imponible',
    'igv',
    'importe_total'
];

const snapshotOperacionCompleto = (detalle) => SNAPSHOT_OPERACION_CAMPOS.every((campo) => {
    const valor = detalle?.[campo];
    return valor !== null && valor !== undefined && String(valor).trim() !== '';
});

const crearErrorEliminacion = (codigo, detalles = {}) => {
    const error = new Error(codigo);
    error.codigo = codigo;
    error.detalles = detalles;
    return error;
};

const ids = (rows) => rows.map((row) => row.id);

const eliminarProductoEnTransaccion = async (client, id, username, ip_direccion, opciones = {}) => {
    const productoResult = await client.query(
        'SELECT * FROM fg_producto_facturacion WHERE id = $1 FOR UPDATE',
        [id]
    );
    if (productoResult.rowCount === 0) throw new Error('PRODUCTO_NO_ENCONTRADO');
    const producto = productoResult.rows[0];

    const impacto = await productosImpactoService.calcularImpactoEnTransaccion(client, id, producto);
    let limpiezaConjunto = null;
    if (impacto.requiereConfirmacionConjunto) {
        if (opciones.confirmarConjunto !== true) {
            throw crearErrorEliminacion('CONFIRMAR_IMPACTO', { impacto });
        }
        limpiezaConjunto = await productosImpactoService.eliminarOperacionesMixtas(client, impacto);
    }

    // Las tarifas son la configuración que realmente hace visible un servicio
    // en Nuevo Certificado. Las que tengan historial también se eliminan; sus
    // referencias históricas se desvinculan más abajo conservando snapshots.
    const tarifasResult = await client.query(`
        SELECT t.id, t.servicio_id, t.activo, t.producto_facturacion_id,
               EXISTS (
                   SELECT 1
                   FROM fg_operacion_detalle od
                   WHERE od.tarifa_id = t.id
               ) AS tiene_historial
        FROM fg_tarifa t
        WHERE t.producto_facturacion_id = $1
        FOR UPDATE OF t
    `, [id]);
    const tarifasPorChipResult = await client.query(`
        SELECT t.id, t.servicio_id, t.activo, t.producto_facturacion_id,
               EXISTS (
                   SELECT 1
                   FROM fg_operacion_detalle od
                   WHERE od.tarifa_id = t.id
               ) AS tiene_historial
        FROM fg_tarifa t
        JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
        JOIN fg_producto_inventariable pi
          ON pi.id = pf.producto_chip_id
         AND pi.activo = TRUE
         AND pi.control_stock = TRUE
         AND pi.tipo = 'CHIP_SERIALIZADO'
        LEFT JOIN fg_producto_inventariable_sede pis
          ON pis.producto_inventariable_id = pi.id
         AND pis.planta_key = t.planta_key
         AND pis.activo = TRUE
        WHERE COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id) = $1
        FOR UPDATE OF t
    `, [id]);
    const tarifasPorId = new Map(tarifasResult.rows.map((tarifa) => [Number(tarifa.id), tarifa]));
    for (const tarifa of tarifasPorChipResult.rows) {
        if (!tarifasPorId.has(Number(tarifa.id))) tarifasPorId.set(Number(tarifa.id), tarifa);
    }
    const tarifas = [...tarifasPorId.values()];
    const tarifaIds = ids(tarifas);
    const serviciosAfectados = [...new Set(tarifas.map((tarifa) => tarifa.servicio_id))];

    const detallesResult = await client.query(`
        SELECT od.id, od.operacion_id, od.tipo_item, od.tarifa_id,
               od.producto_facturacion_id,
               od.codigo_sku_snapshot, od.descripcion_snapshot,
               od.unidad_snapshot, od.afectacion_igv_snapshot,
               od.valor_unitario, od.precio_unitario,
               od.base_imponible, od.igv, od.importe_total
        FROM fg_operacion_detalle od
        WHERE od.producto_facturacion_id = $1
        FOR UPDATE
    `, [id]);
    let detalles = detallesResult.rows;
    if (tarifaIds.length > 0) {
        const detallesPorTarifaResult = await client.query(`
            SELECT od.id, od.operacion_id, od.tipo_item, od.tarifa_id,
                   od.producto_facturacion_id,
                   od.codigo_sku_snapshot, od.descripcion_snapshot,
                   od.unidad_snapshot, od.afectacion_igv_snapshot,
                   od.valor_unitario, od.precio_unitario,
                   od.base_imponible, od.igv, od.importe_total
            FROM fg_operacion_detalle od
            WHERE od.tarifa_id = ANY($1::integer[])
            FOR UPDATE
        `, [tarifaIds]);
        const idsDetalle = new Set(detalles.map((detalle) => Number(detalle.id)));
        detalles = [
            ...detalles,
            ...detallesPorTarifaResult.rows.filter((detalle) => !idsDetalle.has(Number(detalle.id)))
        ];
    }
    const operacionIds = [...new Set(detalles.map((detalle) => detalle.operacion_id))];

    // No se permite arrastrar una operación que todavía contiene otro SKU.
    // Bloqueamos también las cabeceras para que no entre otro detalle mientras
    // se decide la limpieza. Todo sigue ocurriendo antes de la primera escritura.
    if (operacionIds.length > 0) {
        await client.query(
            'SELECT id FROM fg_operacion_comercial WHERE id = ANY($1::bigint[]) FOR UPDATE',
            [operacionIds]
        );
    }
    let operacionesMixtas = [];
    if (operacionIds.length > 0) {
        const mixturesResult = await client.query(`
            SELECT od.operacion_id,
                   array_agg(DISTINCT od.producto_facturacion_id)
                       FILTER (WHERE od.producto_facturacion_id IS NOT NULL) AS productos
            FROM fg_operacion_detalle od
            WHERE od.operacion_id = ANY($1::bigint[])
              AND od.producto_facturacion_id IS NOT NULL
              AND od.producto_facturacion_id <> $2
            GROUP BY od.operacion_id
            ORDER BY od.operacion_id
        `, [operacionIds, id]);
        operacionesMixtas = mixturesResult.rows;
    }
    if (operacionesMixtas.length > 0) {
        const impactoActual = await productosImpactoService.calcularImpactoEnTransaccion(client, id, producto);
        throw crearErrorEliminacion('CONFIRMAR_IMPACTO', { impacto: impactoActual });
    }

    const detalleSinSnapshot = detalles.find((detalle) => !snapshotOperacionCompleto(detalle));
    if (detalleSinSnapshot) {
        throw crearErrorEliminacion('HISTORICO_SIN_SNAPSHOT', {
            operacion_detalle_id: detalleSinSnapshot.id
        });
    }

    // Los certificados emitted sólo se desvinculan cuando su detalle comercial
    // del mismo producto conserva todos los snapshots. Los borradores y anulados son configuración
    // activa y pueden quedar sin SKU para que el operador los reconfigure.
    const certificadosResult = await client.query(`
        SELECT c.id, c.estado,
               c.producto_facturacion_certificado_id,
               c.producto_facturacion_chip_id,
               EXISTS (
                   SELECT 1
                   FROM fg_operacion_detalle od
                   WHERE od.certificado_id = c.id
                     AND od.producto_facturacion_id = $1
                     AND od.codigo_sku_snapshot IS NOT NULL
                     AND od.descripcion_snapshot IS NOT NULL
                     AND od.unidad_snapshot IS NOT NULL
                     AND od.afectacion_igv_snapshot IS NOT NULL
                     AND od.valor_unitario IS NOT NULL
                     AND od.precio_unitario IS NOT NULL
                     AND od.base_imponible IS NOT NULL
                     AND od.igv IS NOT NULL
                     AND od.importe_total IS NOT NULL
               ) AS snapshot_completo
        FROM fg_certificado c
        WHERE c.producto_facturacion_certificado_id = $1
           OR c.producto_facturacion_chip_id = $1
        FOR UPDATE OF c
    `, [id]);
    const certificados = certificadosResult.rows;
    const certificadoInseguro = certificados.find((certificado) => (
        !['BORRADOR', 'ANULADO'].includes(certificado.estado)
        && certificado.snapshot_completo !== true
    ));
    if (certificadoInseguro) {
        throw crearErrorEliminacion('CERTIFICADO_SIN_SNAPSHOT', {
            certificado_id: certificadoInseguro.id,
            estado: certificadoInseguro.estado
        });
    }

    const productoSedeResult = await client.query(
        'SELECT id FROM fg_producto_sede WHERE producto_facturacion_id = $1 FOR UPDATE',
        [id]
    );
    const productoInventariableResult = await client.query(
        'SELECT id FROM fg_producto_inventariable WHERE producto_facturacion_id = $1 FOR UPDATE',
        [id]
    );
    const productoInventariableSedeResult = await client.query(
        'SELECT id FROM fg_producto_inventariable_sede WHERE producto_facturacion_id = $1 FOR UPDATE',
        [id]
    );

    // Las operaciones históricas no se borran: se conserva el snapshot y sólo
    // se retiran las FK vivas de producto/tarifa. La migración temporal permite
    // este caso cuando el snapshot está completo.
    if (detalles.length > 0) {
        await client.query(`
            UPDATE fg_operacion_detalle
            SET producto_facturacion_id = CASE
                    WHEN producto_facturacion_id = $1 THEN NULL
                    ELSE producto_facturacion_id
                END,
                tarifa_id = CASE
                    WHEN tarifa_id = ANY($2::integer[]) THEN NULL
                    ELSE tarifa_id
                END
            WHERE id = ANY($3::bigint[])
        `, [id, tarifaIds, ids(detalles)]);
    }

    if (certificados.length > 0) {
        await client.query(`
            UPDATE fg_certificado
            SET producto_facturacion_certificado_id = CASE
                    WHEN producto_facturacion_certificado_id = $1 THEN NULL
                    ELSE producto_facturacion_certificado_id
                END,
                producto_facturacion_chip_id = CASE
                    WHEN producto_facturacion_chip_id = $1 THEN NULL
                    ELSE producto_facturacion_chip_id
                END,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = ANY($2::bigint[])
        `, [id, ids(certificados)]);
    }

    // Todas las tarifas del producto se retiran físicamente. Las referencias
    // históricas de detalle se desvinculan arriba conservando sus snapshots.
    if (tarifas.length > 0) {
        await client.query(
            'DELETE FROM fg_tarifa WHERE id = ANY($1::integer[])',
            [tarifaIds]
        );
    }

    if (productoSedeResult.rowCount > 0) {
        await client.query(
            'DELETE FROM fg_producto_sede WHERE id = ANY($1::bigint[])',
            [ids(productoSedeResult.rows)]
        );
    }
    if (productoInventariableResult.rowCount > 0) {
        await client.query(`
            UPDATE fg_producto_inventariable
            SET producto_facturacion_id = NULL,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = ANY($1::bigint[])
        `, [ids(productoInventariableResult.rows)]);
    }
    if (productoInventariableSedeResult.rowCount > 0) {
        await client.query(`
            UPDATE fg_producto_inventariable_sede
            SET producto_facturacion_id = NULL,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = ANY($1::bigint[])
        `, [ids(productoInventariableSedeResult.rows)]);
    }

    let serviciosDesactivados = 0;
    if (serviciosAfectados.length > 0) {
        const serviciosResult = await client.query(`
            UPDATE fg_servicio s
            SET activo = FALSE
            WHERE s.id = ANY($1::integer[])
              AND s.activo = TRUE
              AND NOT EXISTS (
                  SELECT 1
                  FROM fg_tarifa t
                  WHERE t.servicio_id = s.id
                    AND t.activo = TRUE
              )
        `, [serviciosAfectados]);
        serviciosDesactivados = serviciosResult.rowCount;
    }

    const eliminado = await client.query(
        'DELETE FROM fg_producto_facturacion WHERE id = $1',
        [id]
    );
    if (eliminado.rowCount !== 1) {
        throw crearErrorEliminacion('PRODUCTO_NO_ELIMINADO');
    }

    const resumen = {
        productoEliminado: {
            id: Number(producto.id),
            codigo_sku: producto.codigo_sku,
            descripcion: producto.descripcion
        },
        tarifasEliminadas: tarifas.length,
        tarifasDesvinculadas: 0,
        mappingsEliminados: productoSedeResult.rowCount,
        mappingsDesvinculados: productoInventariableResult.rowCount
            + productoInventariableSedeResult.rowCount,
        serviciosDesactivados,
        operacionesDesvinculadas: operacionIds.length,
        certificadosDesvinculados: certificados.length,
        historicosPreservados: {
            operaciones: operacionIds.length,
            certificados: certificados.length
        },
        conjuntoPrueba: limpiezaConjunto
    };

    await configService.registrarAuditoria(client, {
        username,
        entidad: 'PRODUCTO_FACTURACION',
        accion: 'ELIMINAR_PRODUCTO',
        identificador: producto.codigo_sku,
        detalles: { eliminado: producto, resumen },
        planta_key: null,
        ip_direccion
    });

    return resumen;
};

exports.eliminar = async (id, username, ip_direccion, opciones = {}) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const resumen = await eliminarProductoEnTransaccion(client, id, username, ip_direccion, opciones);
        await client.query('COMMIT');
        return resumen;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (_rollbackError) {
            // Se conserva el error original si el rollback ya no es posible.
        }
        if (error.code === '23503') throw new Error('DEPENDENCIA_NO_CLASIFICADA');
        if (error.code === '23514' && /ck_fg_operacion_detalle_concepto/i.test(error.message || '')) {
            throw new Error('MIGRACION_HISTORICO_REQUERIDA');
        }
        throw error;
    } finally {
        client.release();
    }
};

exports.obtenerImpacto = productosImpactoService.preview;

exports._private = {
    validarProductoChip,
    validarPrecioChip,
    validarCategoriaActiva,
    eliminarProductoEnTransaccion,
    snapshotOperacionCompleto
};
