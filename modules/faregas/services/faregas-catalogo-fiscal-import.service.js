const db = require('../../../config/database');
const configService = require('./faregas-config.service');
const tarifasService = require('./faregas-tarifas-admin.service');

const LIMITE_FILAS = 500;

const texto = (value) => String(value ?? '').trim();
const canonizar = (value) => texto(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

const normalizarFila = (row, indice) => {
    const tarifaIdRaw = row.tarifa_id ?? row.tarifaId;
    return {
        fila: indice + 2,
        plantaKey: texto(row.planta_key ?? row.plantaKey),
        servicioCodigo: texto(row.servicio_codigo ?? row.servicioCodigo).toUpperCase(),
        productoSku: texto(row.codigo_sku ?? row.producto_sku ?? row.productoSku),
        tarifaId: tarifaIdRaw === undefined || tarifaIdRaw === null || tarifaIdRaw === ''
            ? null
            : Number(tarifaIdRaw)
    };
};

const validarEntrada = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) {
        throw Object.assign(new Error('IMPORTACION_SIN_FILAS'), { statusCode: 400 });
    }
    if (rows.length > LIMITE_FILAS) {
        throw Object.assign(new Error('IMPORTACION_DEMASIADAS_FILAS'), { statusCode: 400 });
    }
    return rows.map(normalizarFila);
};

const extraerPlantaCategoria = (categoriaDms) => {
    const categoria = canonizar(categoriaDms);
    const marcador = 'PLANTA ';
    const posicion = categoria.indexOf(marcador);
    return posicion >= 0 ? categoria.slice(posicion + marcador.length).trim() : null;
};

const consultarContexto = async (rows, queryable, { bloquearTarifas = false } = {}) => {
    const plantas = [...new Set(rows.map(row => row.plantaKey).filter(Boolean))];
    const servicios = [...new Set(rows.map(row => row.servicioCodigo).filter(Boolean))];
    const skus = [...new Set(rows.map(row => row.productoSku).filter(Boolean))];

    // La misma función también opera dentro de una transacción con un PoolClient.
    // pg no permite consultas concurrentes sobre esa única conexión; mantenerlas
    // secuenciales evita estados ambiguos y es compatible con pg 9.
    const plantasResult = plantas.length === 0
        ? { rows: [] }
        : await queryable.query('SELECT key, nombre, activo FROM fg_planta WHERE key = ANY($1::varchar[])', [plantas]);
    const serviciosResult = servicios.length === 0
        ? { rows: [] }
        : await queryable.query(`
                SELECT id, codigo, nombre, tipo_flujo, activo
                FROM fg_servicio
                WHERE UPPER(BTRIM(codigo)) = ANY($1::text[])
            `, [servicios]);
    const tarifasResult = plantas.length === 0 || servicios.length === 0
        ? { rows: [] }
        : await queryable.query(`
                SELECT t.id, t.planta_key, t.producto_facturacion_id,
                       s.codigo AS servicio_codigo, s.nombre AS servicio_nombre,
                       s.tipo_flujo, p.nombre AS planta_nombre
                FROM fg_tarifa t
                JOIN fg_servicio s ON s.id = t.servicio_id
                JOIN fg_planta p ON p.key = t.planta_key
                WHERE t.planta_key = ANY($1::varchar[])
                  AND UPPER(BTRIM(s.codigo)) = ANY($2::text[])
                  AND t.activo = TRUE
                ORDER BY t.id
                ${bloquearTarifas ? 'FOR UPDATE OF t' : ''}
            `, [plantas, servicios]);
    const productosResult = skus.length === 0
        ? { rows: [] }
        : await queryable.query(`
                SELECT id, codigo_sku, descripcion, categoria_dms, unidad,
                       codigo_clasificacion_sunat, tipo_afectacion_igv,
                       es_para_venta, activo
                FROM fg_producto_facturacion
                WHERE UPPER(BTRIM(codigo_sku)) = ANY($1::text[])
            `, [skus.map(value => value.toUpperCase())]);

    const productoIds = productosResult.rows.map(row => Number(row.id));
    const alcanceResult = productoIds.length === 0
        ? { rows: [] }
        : await queryable.query(`
            SELECT producto_facturacion_id, planta_key
            FROM fg_producto_sede
            WHERE activo = TRUE AND producto_facturacion_id = ANY($1::bigint[])
        `, [productoIds]);

    const indexar = (items, key) => new Map(items.map(item => [key(item), item]));
    const alcances = new Map();
    for (const row of alcanceResult.rows) {
        const id = Number(row.producto_facturacion_id);
        if (!alcances.has(id)) alcances.set(id, new Set());
        alcances.get(id).add(String(row.planta_key));
    }
    return {
        plantas: indexar(plantasResult.rows, row => String(row.key)),
        servicios: indexar(serviciosResult.rows, row => canonizar(row.codigo)),
        tarifas: indexar(tarifasResult.rows, row => `${row.planta_key}::${canonizar(row.servicio_codigo)}`),
        productos: indexar(productosResult.rows, row => canonizar(row.codigo_sku)),
        alcances
    };
};

const analizar = async (rows, queryable, options = {}) => {
    const normalizadas = validarEntrada(rows);
    const repetidas = new Set();
    const vistas = new Set();
    for (const fila of normalizadas) {
        const clave = `${fila.plantaKey}::${canonizar(fila.servicioCodigo)}`;
        if (vistas.has(clave)) repetidas.add(clave);
        vistas.add(clave);
    }

    const contexto = await consultarContexto(normalizadas, queryable, options);
    const resultados = normalizadas.map((fila) => {
        const errores = [];
        const claveTarifa = `${fila.plantaKey}::${canonizar(fila.servicioCodigo)}`;
        if (!fila.plantaKey) errores.push('La planta_key es obligatoria.');
        if (!fila.servicioCodigo) errores.push('El servicio_codigo es obligatorio.');
        if (!fila.productoSku) errores.push('El codigo_sku es obligatorio.');
        if (fila.tarifaId !== null && (!Number.isSafeInteger(fila.tarifaId) || fila.tarifaId <= 0)) {
            errores.push('El tarifa_id opcional es inválido.');
        }
        if (repetidas.has(claveTarifa)) {
            errores.push('La combinación planta y servicio aparece más de una vez en el archivo.');
        }

        const planta = contexto.plantas.get(fila.plantaKey) || null;
        const servicio = contexto.servicios.get(canonizar(fila.servicioCodigo)) || null;
        const tarifa = contexto.tarifas.get(claveTarifa) || null;
        const producto = contexto.productos.get(canonizar(fila.productoSku)) || null;

        if (fila.plantaKey && !planta) errores.push('La planta no existe.');
        if (planta && !planta.activo) errores.push('La planta está inactiva.');
        if (fila.servicioCodigo && !servicio) errores.push('El servicio no existe.');
        if (servicio && !servicio.activo) errores.push('El servicio está inactivo.');
        if (planta && servicio && !tarifa) errores.push('No existe una tarifa activa para la planta y el servicio indicados.');
        if (tarifa && fila.tarifaId !== null && Number(tarifa.id) !== fila.tarifaId) {
            errores.push('El tarifa_id no coincide con la planta y el servicio indicados.');
        }
        if (fila.productoSku && !producto) errores.push('El SKU no existe.');

        if (producto) {
            try {
                tarifasService._private.validarProducto(producto, tarifa?.tipo_flujo === 'CERTIFICACION');
            } catch (error) {
                errores.push(error.message);
            }
            if (canonizar(producto.codigo_sku).includes('DEMO')
                || canonizar(producto.descripcion).includes('DEMO')) {
                errores.push('No se permite vincular un producto DEMO.');
            }

            const plantaCategoria = extraerPlantaCategoria(producto.categoria_dms);
            if (plantaCategoria && planta && plantaCategoria !== canonizar(planta.nombre)) {
                errores.push(`El SKU está identificado para la planta ${plantaCategoria}, no para ${canonizar(planta.nombre)}.`);
            }
            const alcances = contexto.alcances.get(Number(producto.id));
            if (alcances && alcances.size > 0 && !alcances.has(fila.plantaKey)) {
                errores.push('El SKU tiene alcance explícito en otra sede.');
            }
        }

        const sinCambios = errores.length === 0
            && Number(tarifa?.producto_facturacion_id || 0) === Number(producto?.id || 0);
        return {
            ...fila,
            estado: errores.length > 0 ? 'INVALIDA' : sinCambios ? 'SIN_CAMBIOS' : 'VALIDA',
            errores,
            tarifa: tarifa && {
                id: Number(tarifa.id),
                plantaKey: tarifa.planta_key,
                plantaNombre: tarifa.planta_nombre,
                servicioCodigo: tarifa.servicio_codigo,
                servicioNombre: tarifa.servicio_nombre,
                productoActualId: tarifa.producto_facturacion_id ? Number(tarifa.producto_facturacion_id) : null
            },
            producto: producto && {
                id: Number(producto.id),
                sku: producto.codigo_sku,
                descripcion: producto.descripcion,
                categoriaDms: producto.categoria_dms || null,
                unidad: producto.unidad,
                afectacionIgv: producto.tipo_afectacion_igv,
                codigoSunat: producto.codigo_clasificacion_sunat || null
            }
        };
    });

    return {
        total: resultados.length,
        validas: resultados.filter(row => row.estado !== 'INVALIDA').length,
        invalidas: resultados.filter(row => row.estado === 'INVALIDA').length,
        cambios: resultados.filter(row => row.estado === 'VALIDA').length,
        sinCambios: resultados.filter(row => row.estado === 'SIN_CAMBIOS').length,
        filas: resultados
    };
};

exports.previsualizar = async (rows, queryable = db) => analizar(rows, queryable);

exports.aplicar = async (rows, { confirmar, username, ipDireccion }, dependencies = {}) => {
    if (confirmar !== true) {
        throw Object.assign(new Error('IMPORTACION_CONFIRMACION_REQUERIDA'), { statusCode: 400 });
    }
    const pool = dependencies.db || db;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const vista = await analizar(rows, client, { bloquearTarifas: true });
        if (vista.invalidas > 0) {
            throw Object.assign(new Error('IMPORTACION_CONTIENE_ERRORES'), { statusCode: 409, detalles: vista });
        }
        for (const fila of vista.filas.filter(item => item.estado === 'VALIDA')) {
            await client.query(
                'UPDATE fg_tarifa SET producto_facturacion_id = $1 WHERE id = $2',
                [fila.producto.id, fila.tarifa.id]
            );
            await configService.registrarAuditoria(client, {
                username,
                entidad: 'TARIFA',
                accion: fila.tarifa.productoActualId ? 'CAMBIAR_SKU_TARIFA_MASIVO' : 'ASIGNAR_SKU_TARIFA_MASIVO',
                identificador: `${fila.tarifa.plantaKey}:${fila.tarifa.servicioCodigo}`,
                detalles: {
                    antes: { productoId: fila.tarifa.productoActualId },
                    despues: { productoId: fila.producto.id, sku: fila.producto.sku },
                    filaArchivo: fila.fila
                },
                planta_key: fila.tarifa.plantaKey,
                ip_direccion: ipDireccion
            });
        }
        await client.query('COMMIT');
        return {
            totalProcesadas: vista.total,
            totalActualizadas: vista.cambios,
            totalSinCambios: vista.sinCambios,
            filas: vista.filas
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports._private = {
    analizar,
    consultarContexto,
    validarEntrada,
    normalizarFila,
    canonizar,
    extraerPlantaCategoria,
    LIMITE_FILAS
};
