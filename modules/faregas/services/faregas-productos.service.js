const db = require('../../../config/database');
const configService = require('./faregas-config.service');
const productosImpactoService = require('./faregas-productos-impacto.service');

exports.listar = async ({ buscar, estado, paraVenta, unidad, categoriaId } = {}) => {
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
    if (categoriaId) agregar('p.categoria_id = ?', categoriaId);

    const result = await db.query(`
        SELECT p.id, p.codigo_sku, p.descripcion, p.tipo_producto, p.categoria_dms,
               p.categoria_id, c.codigo AS categoria_codigo, c.nombre AS categoria_nombre,
               p.cuenta_por_cobrar, p.unidad, p.precio_unitario, p.precio_referencia,
               p.valor_referencial_unitario, p.codigo_clasificacion_sunat,
               p.tipo_afectacion_igv, p.porcentaje_isc, p.disponible_pos,
               p.es_para_venta, p.es_para_compra, p.tiene_icbper, p.activo,
               p.requiere_chip, p.producto_chip_id, p.precio_chip,
               p.fecha_creacion, p.fecha_modificacion
        FROM fg_producto_facturacion p
        LEFT JOIN fg_categoria_servicio c ON c.id = p.categoria_id
        ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
        ORDER BY p.codigo_sku ASC
    `, valores);
    return result.rows.map((producto) => ({
        ...producto,
        precio_unitario: producto.precio_unitario === null ? null : Number(producto.precio_unitario),
        precio_referencia: producto.precio_referencia === null ? null : Number(producto.precio_referencia),
        valor_referencial_unitario: producto.valor_referencial_unitario === null ? null : Number(producto.valor_referencial_unitario),
        porcentaje_isc: producto.porcentaje_isc === null ? null : Number(producto.porcentaje_isc),
        precio_chip: producto.precio_chip === null ? null : Number(producto.precio_chip)
    }));
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
    const precio = Number(precioChip);
    if (!Number.isFinite(precio) || precio <= 0) throw new Error('CHIP_PRECIO_INVALIDO');
    return precio;
};

exports.crear = async (producto, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await validarCategoriaActiva(client, producto.categoria_id);
        const productoChipIdValidado = await validarProductoChip(client, producto.requiere_chip, producto.producto_chip_id);
        const precioChipValidado = validarPrecioChip(producto.requiere_chip, producto.precio_chip);
        const result = await client.query(`
            INSERT INTO fg_producto_facturacion (
                codigo_sku, descripcion, tipo_producto, categoria_dms, categoria_id,
                cuenta_por_cobrar, unidad, precio_unitario, precio_referencia,
                valor_referencial_unitario, codigo_clasificacion_sunat,
                tipo_afectacion_igv, porcentaje_isc, disponible_pos,
                es_para_venta, es_para_compra, tiene_icbper, activo,
                requiere_chip, producto_chip_id, precio_chip
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9,
                $10, $11, $12, $13, $14, $15, $16, $17, $18,
                $19, $20, $21
            ) RETURNING id
        `, [
            producto.codigo_sku, producto.descripcion, producto.tipo_producto,
            producto.categoria_dms, producto.categoria_id,
            producto.cuenta_por_cobrar, producto.unidad,
            producto.precio_unitario, producto.precio_referencia,
            producto.valor_referencial_unitario, producto.codigo_clasificacion_sunat,
            producto.tipo_afectacion_igv, producto.porcentaje_isc,
            producto.disponible_pos, producto.es_para_venta,
            producto.es_para_compra, producto.tiene_icbper, producto.activo,
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

exports.editar = async (id, producto, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query('SELECT * FROM fg_producto_facturacion WHERE id = $1 FOR UPDATE', [id]);
        if (actual.rowCount === 0) throw new Error('PRODUCTO_NO_ENCONTRADO');
        await validarCategoriaActiva(client, producto.categoria_id);
        const productoChipIdValidado = await validarProductoChip(client, producto.requiere_chip, producto.producto_chip_id);
        const precioChipValidado = validarPrecioChip(producto.requiere_chip, producto.precio_chip);
        await client.query(`
            UPDATE fg_producto_facturacion SET
                descripcion = $1, tipo_producto = $2, categoria_dms = $3,
                categoria_id = $4, cuenta_por_cobrar = $5, unidad = $6,
                precio_unitario = $7, precio_referencia = $8,
                valor_referencial_unitario = $9,
                codigo_clasificacion_sunat = $10, tipo_afectacion_igv = $11,
                porcentaje_isc = $12, disponible_pos = $13,
                es_para_venta = $14, es_para_compra = $15, tiene_icbper = $16,
                requiere_chip = $17, producto_chip_id = $18, precio_chip = $19,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $20
        `, [
            producto.descripcion, producto.tipo_producto, producto.categoria_dms,
            producto.categoria_id, producto.cuenta_por_cobrar,
            producto.unidad, producto.precio_unitario,
            producto.precio_referencia, producto.valor_referencial_unitario,
            producto.codigo_clasificacion_sunat, producto.tipo_afectacion_igv,
            producto.porcentaje_isc, producto.disponible_pos,
            producto.es_para_venta, producto.es_para_compra,
            producto.tiene_icbper, Boolean(producto.requiere_chip), productoChipIdValidado,
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
