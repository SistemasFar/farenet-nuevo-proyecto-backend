const db = require('../../../config/database');
const authService = require('./faregas-auth.service');
const { redondear } = require('./faregas-pagos.rules');
const { validarProductoFiscalChip } = require('./faregas-chips-fiscal.rules');

const PLANTA_SURCO = '98';
const TIPO_CONTROL_CANTIDAD = 'CANTIDAD';

const normalizarCantidad = (value) => {
    const cantidad = Number(value);
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error('CANTIDAD_INVALIDA');
    return cantidad;
};

const validarSedeHojas = (plantaKey) => {
    if (String(plantaKey || '').trim() !== PLANTA_SURCO) {
        throw new Error('SEDE_PRODUCTO_CANTIDAD_NO_HABILITADA');
    }
    return PLANTA_SURCO;
};

const calcularStock = (rows) => rows.reduce((total, row) => {
    const cantidad = Number(row.cantidad || 0);
    return total + (row.sentido === 'ENTRADA' ? cantidad : -cantidad);
}, 0);

const validarStockDisponible = (disponibleValue, solicitadoValue) => {
    const disponible = Number(disponibleValue);
    const solicitado = normalizarCantidad(solicitadoValue);
    if (!Number.isFinite(disponible) || disponible < solicitado) {
        const error = new Error('STOCK_INSUFICIENTE');
        error.detalles = { disponible: Number.isFinite(disponible) ? disponible : 0, solicitado };
        throw error;
    }
    return true;
};

const consultarStock = async (queryable, productoInventariableId, plantaKey) => {
    const result = await queryable.query(`
        SELECT COALESCE(SUM(CASE WHEN sentido = 'ENTRADA' THEN cantidad ELSE -cantidad END), 0) AS stock,
               COALESCE(SUM(CASE WHEN tipo_movimiento = 'INGRESO' THEN cantidad ELSE 0 END), 0) AS ingresos,
               COALESCE(SUM(CASE WHEN tipo_movimiento = 'VENTA' THEN cantidad ELSE 0 END), 0) AS vendidos
          FROM fg_inventario_cantidad_movimiento
         WHERE producto_inventariable_id = $1
           AND planta_key = $2
    `, [productoInventariableId, plantaKey]);
    return {
        stock: Number(result.rows[0]?.stock || 0),
        ingresos: Number(result.rows[0]?.ingresos || 0),
        vendidos: Number(result.rows[0]?.vendidos || 0)
    };
};

const obtenerConfiguracion = async (queryable, productoInventariableId, plantaKey, { bloquear = false } = {}) => {
    validarSedeHojas(plantaKey);
    const result = await queryable.query(`
        SELECT pi.id, pi.codigo, pi.nombre, pi.tipo, pi.control_stock, pi.activo,
               pis.activo AS sede_activa, pis.stock_permitido, pis.venta_habilitada,
               pis.producto_facturacion_id,
               pf.codigo_sku, pf.descripcion, pf.unidad,
               pf.tipo_afectacion_igv, pf.codigo_clasificacion_sunat,
               pf.activo AS fiscal_activo, pf.es_para_venta,
               pf.precio_unitario AS valor_unitario_fiscal,
               pf.precio_referencia
          FROM fg_producto_inventariable pi
          JOIN fg_producto_inventariable_sede pis
            ON pis.producto_inventariable_id = pi.id
           AND pis.planta_key = $2
          JOIN fg_planta p ON p.key = pis.planta_key AND p.activo = TRUE
          LEFT JOIN fg_producto_facturacion pf ON pf.id = pis.producto_facturacion_id
         WHERE pi.id = $1
           AND pi.activo = TRUE
           AND pi.tipo = 'CANTIDAD'
           AND pis.activo = TRUE
        ${bloquear ? 'FOR UPDATE OF pis' : ''}
    `, [productoInventariableId, plantaKey]);
    if (!result.rowCount) throw new Error('PRODUCTO_CANTIDAD_NO_CONFIGURADO_SEDE');

    const config = result.rows[0];
    if (config.control_stock !== true || config.stock_permitido !== true) {
        throw new Error('STOCK_PRODUCTO_NO_PERMITIDO');
    }
    if (config.venta_habilitada !== true) throw new Error('VENTA_PRODUCTO_NO_HABILITADA');
    config.precio = validarProductoFiscalChip(config);
    return config;
};

const construirDetalleCantidad = (config, cantidadValue) => {
    const cantidad = normalizarCantidad(cantidadValue);
    const precioUnitario = redondear(Number(config.precio));
    const importeTotal = redondear(precioUnitario * cantidad);
    const baseImponible = redondear(importeTotal / 1.18);
    const igv = redondear(importeTotal - baseImponible);
    return {
        productoInventariableId: Number(config.id),
        productoFacturacionId: Number(config.producto_facturacion_id),
        codigoSku: config.codigo_sku,
        descripcion: config.descripcion,
        unidad: config.unidad,
        afectacionIgv: config.tipo_afectacion_igv,
        codigoSunat: config.codigo_clasificacion_sunat,
        cantidad,
        precioUnitario,
        valorUnitario: redondear(precioUnitario / 1.18),
        baseImponible,
        igv,
        importeTotal
    };
};

const prepararVentaEnTransaccion = async (client, { productoInventariableId, cantidad, plantaKey }) => {
    const config = await obtenerConfiguracion(client, productoInventariableId, plantaKey, { bloquear: true });
    const detalle = construirDetalleCantidad(config, cantidad);
    const stock = await consultarStock(client, productoInventariableId, plantaKey);
    validarStockDisponible(stock.stock, detalle.cantidad);
    return { config, detalle, stockAntes: stock.stock };
};

const registrarSalidaVenta = async (client, { detalle, detalleId, plantaKey, operacionId, username }) => {
    await client.query(`
        INSERT INTO fg_inventario_cantidad_movimiento (
            producto_inventariable_id, planta_key, tipo_movimiento, sentido,
            cantidad, operacion_detalle_id, usuario, referencia, detalles
        ) VALUES ($1, $2, 'VENTA', 'SALIDA', $3, $4, $5, $6, $7)
    `, [
        detalle.productoInventariableId,
        plantaKey,
        detalle.cantidad,
        detalleId,
        username,
        `Operación comercial #${operacionId}`,
        JSON.stringify({
            operacion_comercial_id: operacionId,
            precio_unitario_snapshot: detalle.precioUnitario,
            importe_total_snapshot: detalle.importeTotal
        })
    ]);
};

const validarAcceso = async (user, plantaKey) => {
    validarSedeHojas(plantaKey);
    const planta = await authService.validarAccesoPlanta(user.username, user.perfil_id, plantaKey);
    if (!planta) throw new Error('PLANTA_NO_AUTORIZADA');
    return planta;
};

const registrarIngreso = async ({ productoInventariableId, cantidad, referencia, plantaKey }, user) => {
    await validarAcceso(user, plantaKey);
    const cantidadNormalizada = normalizarCantidad(cantidad);
    const referenciaNormalizada = String(referencia || '').trim() || null;
    if (referenciaNormalizada && referenciaNormalizada.length > 250) throw new Error('REFERENCIA_INVALIDA');

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerConfiguracion(client, productoInventariableId, plantaKey, { bloquear: true });
        const movimiento = await client.query(`
            INSERT INTO fg_inventario_cantidad_movimiento (
                producto_inventariable_id, planta_key, tipo_movimiento, sentido,
                cantidad, usuario, referencia, detalles
            ) VALUES ($1, $2, 'INGRESO', 'ENTRADA', $3, $4, $5, '{}'::jsonb)
            RETURNING id, producto_inventariable_id, planta_key, tipo_movimiento,
                      sentido, cantidad, usuario, referencia, fecha_creacion
        `, [productoInventariableId, plantaKey, cantidadNormalizada, user.username, referenciaNormalizada]);
        const stock = await consultarStock(client, productoInventariableId, plantaKey);
        await client.query('COMMIT');
        return { ...movimiento.rows[0], id: Number(movimiento.rows[0].id), cantidad: cantidadNormalizada, stock: stock.stock };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const listarMovimientos = async ({ productoInventariableId, plantaKey, limite = 100 }, user) => {
    await validarAcceso(user, plantaKey);
    await obtenerConfiguracion(db, productoInventariableId, plantaKey);
    const limit = Math.min(Math.max(Number(limite) || 100, 1), 500);
    const result = await db.query(`
        SELECT id, tipo_movimiento, sentido, cantidad, usuario, referencia,
               operacion_detalle_id, fecha_creacion
          FROM fg_inventario_cantidad_movimiento
         WHERE producto_inventariable_id = $1
           AND planta_key = $2
         ORDER BY fecha_creacion DESC, id DESC
         LIMIT $3
    `, [productoInventariableId, plantaKey, limit]);
    return result.rows.map((row) => ({
        id: Number(row.id),
        tipoMovimiento: row.tipo_movimiento,
        sentido: row.sentido,
        cantidad: Number(row.cantidad),
        usuario: row.usuario,
        referencia: row.referencia,
        operacionDetalleId: row.operacion_detalle_id == null ? null : Number(row.operacion_detalle_id),
        fechaCreacion: row.fecha_creacion
    }));
};

module.exports = {
    PLANTA_SURCO,
    TIPO_CONTROL_CANTIDAD,
    registrarIngreso,
    listarMovimientos,
    consultarStock,
    obtenerConfiguracion,
    construirDetalleCantidad,
    prepararVentaEnTransaccion,
    registrarSalidaVenta,
    validarSedeHojas,
    normalizarCantidad,
    validarStockDisponible,
    _private: Object.freeze({ calcularStock })
};
