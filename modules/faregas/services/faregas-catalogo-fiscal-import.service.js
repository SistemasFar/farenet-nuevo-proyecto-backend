const db = require('../../../config/database');
const configService = require('./faregas-config.service');
const tarifasService = require('./faregas-tarifas-admin.service');

const LIMITE_FILAS = 500;

const normalizarFila = (row, indice) => ({
    fila: indice + 2,
    tarifaId: Number(row.tarifa_id ?? row.tarifaId),
    productoSku: String(row.producto_sku ?? row.productoSku ?? '').trim()
});

const validarEntrada = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) throw Object.assign(new Error('IMPORTACION_SIN_FILAS'), { statusCode: 400 });
    if (rows.length > LIMITE_FILAS) throw Object.assign(new Error('IMPORTACION_DEMASIADAS_FILAS'), { statusCode: 400 });
    return rows.map(normalizarFila);
};

const analizar = async (rows, queryable) => {
    const normalizadas = validarEntrada(rows);
    const repetidas = new Set();
    const vistas = new Set();
    for (const fila of normalizadas) {
        if (vistas.has(fila.tarifaId)) repetidas.add(fila.tarifaId);
        vistas.add(fila.tarifaId);
    }

    const resultados = [];
    for (const fila of normalizadas) {
        const errores = [];
        if (!Number.isSafeInteger(fila.tarifaId) || fila.tarifaId <= 0) errores.push('El identificador de tarifa es inválido.');
        if (!fila.productoSku) errores.push('El SKU del producto es obligatorio.');
        if (repetidas.has(fila.tarifaId)) errores.push('La tarifa aparece más de una vez en el archivo.');

        let tarifa = null;
        let producto = null;
        if (errores.length === 0) {
            const [tarifaResult, productoResult] = await Promise.all([
                queryable.query(`
                    SELECT t.id, t.planta_key, t.producto_facturacion_id,
                           s.codigo AS servicio_codigo, s.nombre AS servicio_nombre,
                           s.tipo_flujo
                    FROM fg_tarifa t JOIN fg_servicio s ON s.id = t.servicio_id
                    WHERE t.id = $1 AND t.activo = TRUE
                `, [fila.tarifaId]),
                queryable.query(`
                    SELECT id, codigo_sku, descripcion, unidad, codigo_clasificacion_sunat,
                           tipo_afectacion_igv, es_para_venta, activo
                    FROM fg_producto_facturacion
                    WHERE UPPER(BTRIM(codigo_sku)) = UPPER(BTRIM($1))
                `, [fila.productoSku])
            ]);
            tarifa = tarifaResult.rows[0] || null;
            producto = productoResult.rows[0] || null;
            if (!tarifa) errores.push('La tarifa no existe o está inactiva.');
            if (!producto) errores.push('El SKU no existe.');
            if (producto) {
                try {
                    tarifasService._private.validarProducto(producto, tarifa?.tipo_flujo === 'CERTIFICACION');
                } catch (error) {
                    errores.push(error.message);
                }
            }
        }
        resultados.push({
            ...fila,
            estado: errores.length === 0 ? 'VALIDA' : 'INVALIDA',
            errores,
            tarifa: tarifa && {
                id: Number(tarifa.id),
                plantaKey: tarifa.planta_key,
                servicioCodigo: tarifa.servicio_codigo,
                servicioNombre: tarifa.servicio_nombre,
                productoActualId: tarifa.producto_facturacion_id ? Number(tarifa.producto_facturacion_id) : null
            },
            producto: producto && {
                id: Number(producto.id),
                sku: producto.codigo_sku,
                descripcion: producto.descripcion,
                unidad: producto.unidad,
                afectacionIgv: producto.tipo_afectacion_igv,
                codigoSunat: producto.codigo_clasificacion_sunat || null
            }
        });
    }
    return {
        total: resultados.length,
        validas: resultados.filter(row => row.estado === 'VALIDA').length,
        invalidas: resultados.filter(row => row.estado === 'INVALIDA').length,
        filas: resultados
    };
};

exports.previsualizar = async (rows, queryable = db) => analizar(rows, queryable);

exports.aplicar = async (rows, { confirmar, username, ipDireccion }, dependencies = {}) => {
    if (confirmar !== true) throw Object.assign(new Error('IMPORTACION_CONFIRMACION_REQUERIDA'), { statusCode: 400 });
    const pool = dependencies.db || db;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const vista = await analizar(rows, client);
        if (vista.invalidas > 0) throw Object.assign(new Error('IMPORTACION_CONTIENE_ERRORES'), { statusCode: 409, detalles: vista });
        for (const fila of vista.filas) {
            await client.query('UPDATE fg_tarifa SET producto_facturacion_id = $1 WHERE id = $2', [fila.producto.id, fila.tarifa.id]);
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
        return { totalActualizadas: vista.validas, filas: vista.filas };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports._private = { analizar, validarEntrada, normalizarFila, LIMITE_FILAS };
