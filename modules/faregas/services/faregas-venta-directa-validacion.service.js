const db = require('../../../config/database');
const authService = require('./faregas-auth.service');
const { normalizarLoteScanner } = require('./faregas-chips.rules');
const {
    redondear,
    esProductoFiscalChipValido
} = require('./faregas-pagos.rules');

const ESTADOS_NO_DISPONIBLES = {
    RESERVADO: { codigo: 'CHIP_RESERVADO', motivo: 'Reservado' },
    VENDIDO: { codigo: 'CHIP_VENDIDO', motivo: 'Vendido' },
    BAJA: { codigo: 'CHIP_BAJA', motivo: 'Dado de baja' }
};

const numeroOpcional = (value) => value == null ? null : Number(value);

const construirItem = (numeroChip) => ({
    numeroChip,
    existe: false,
    estado: null,
    plantaKey: null,
    plantaNombre: null,
    productoInventariableId: null,
    productoCodigo: null,
    productoNombre: null,
    precio: null,
    precioConfigurado: false,
    stockPermitido: false,
    ventaHabilitada: false,
    productoFiscalValido: false,
    validoParaVenta: false,
    codigo: 'CHIP_NO_ENCONTRADO',
    motivo: 'No encontrado'
});

const construirItemEncontrado = (row) => {
    const precio = Number(row.precio);
    const precioConfigurado = Number.isFinite(precio) && precio > 0;

    return {
        numeroChip: String(row.numero_chip || '').trim().toUpperCase(),
        existe: true,
        estado: row.estado || null,
        plantaKey: String(row.planta_actual_key || '').trim() || null,
        plantaNombre: row.planta_nombre || null,
        productoInventariableId: numeroOpcional(row.producto_inventariable_id),
        productoCodigo: row.producto_codigo || null,
        productoNombre: row.producto_nombre || null,
        precio: precioConfigurado ? redondear(precio) : null,
        precioConfigurado,
        stockPermitido: row.stock_permitido === true,
        ventaHabilitada: row.venta_habilitada === true,
        productoFiscalValido: esProductoFiscalChipValido({
            activo: row.fiscal_activo,
            es_para_venta: row.es_para_venta,
            codigo_sku: row.codigo_sku,
            descripcion: row.descripcion,
            unidad: row.unidad,
            tipo_afectacion_igv: row.tipo_afectacion_igv,
            codigo_clasificacion_sunat: row.codigo_clasificacion_sunat
        }),
        validoParaVenta: false,
        codigo: null,
        motivo: null
    };
};

const invalidar = (item, codigo, motivo) => ({
    ...item,
    precio: item.precioConfigurado ? item.precio : null,
    validoParaVenta: false,
    codigo,
    motivo
});

const evaluarChip = ({ row, plantaKey, plantaNombre }) => {
    const item = construirItemEncontrado(row);

    if (item.plantaKey !== plantaKey) {
        return invalidar(item, 'CHIP_OTRA_SEDE', 'El chip pertenece a otra sede');
    }

    if (item.estado !== 'DISPONIBLE') {
        const estado = ESTADOS_NO_DISPONIBLES[item.estado] || {
            codigo: 'CHIP_NO_DISPONIBLE',
            motivo: 'No disponible'
        };
        return invalidar(item, estado.codigo, estado.motivo);
    }

    if (row.producto_activo !== true || row.sede_activa !== true) {
        return invalidar(
            item,
            'PRODUCTO_INVENTARIABLE_NO_CONFIGURADO_SEDE',
            'Producto no configurado para esta sede'
        );
    }

    if (!item.stockPermitido) {
        return invalidar(
            item,
            'STOCK_CHIP_NO_PERMITIDO',
            `Stock no permitido para ${plantaNombre}`
        );
    }

    if (!item.ventaHabilitada) {
        return invalidar(
            item,
            'VENTA_CHIP_NO_HABILITADA',
            `Venta no habilitada para ${plantaNombre}`
        );
    }

    if (!item.productoFiscalValido) {
        return invalidar(
            item,
            'PRODUCTO_FISCAL_CHIP_INVALIDO',
            'Producto fiscal no configurado correctamente para esta sede'
        );
    }

    if (!item.precioConfigurado) {
        return invalidar(
            item,
            'PRECIO_PRODUCTO_INVALIDO',
            'Precio no configurado para esta sede'
        );
    }

    return { ...item, validoParaVenta: true };
};

const validarVentaDirecta = async (payload, userContext, queryable = db) => {
    const plantaKey = String(userContext?.planta_key || '').trim();
    if (!plantaKey) throw new Error('PLANTA_REQUERIDA');

    if (!Array.isArray(payload?.chips) || payload.chips.length === 0) {
        throw new Error('CHIPS_REQUERIDOS');
    }

    const lote = normalizarLoteScanner(payload.chips);
    if (lote.errores.length > 0) throw new Error('CHIP_NUMERO_INVALIDO');
    if (lote.duplicados.length > 0) throw new Error('CHIP_DUPLICADO');
    if (lote.validos.length === 0) throw new Error('CHIPS_REQUERIDOS');

    const planta = await authService.validarAccesoPlanta(
        userContext.username,
        userContext.perfil_id,
        plantaKey
    );
    if (!planta) throw new Error('PLANTA_NO_AUTORIZADA');

    const plantaNombre = String(planta.nombre || plantaKey).trim();
    const result = await queryable.query(`
        SELECT c.id, c.numero_chip, c.estado, c.planta_actual_key,
               p.nombre AS planta_nombre,
               pi.id AS producto_inventariable_id,
               pi.codigo AS producto_codigo,
               pi.nombre AS producto_nombre,
               pi.activo AS producto_activo,
               pis.activo AS sede_activa,
               pis.precio, pis.stock_permitido, pis.venta_habilitada,
               pf.codigo_sku, pf.descripcion, pf.unidad,
               pf.tipo_afectacion_igv, pf.codigo_clasificacion_sunat,
               pf.activo AS fiscal_activo, pf.es_para_venta
        FROM fg_chip c
        JOIN fg_planta p
          ON p.key = c.planta_actual_key
        JOIN fg_producto_inventariable pi
          ON pi.id = c.producto_inventariable_id
        LEFT JOIN fg_producto_inventariable_sede pis
          ON pis.producto_inventariable_id = pi.id
         AND pis.planta_key = $2
        LEFT JOIN fg_producto_facturacion pf
          ON pf.id = COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id)
        WHERE c.numero_chip = ANY($1::varchar[])
        ORDER BY c.numero_chip
    `, [lote.validos, plantaKey]);

    const filasPorNumero = new Map(result.rows.map((row) => [
        String(row.numero_chip || '').trim().toUpperCase(),
        row
    ]));

    const items = lote.validos.map((numeroChip) => {
        const row = filasPorNumero.get(numeroChip);
        if (!row) return construirItem(numeroChip);
        return evaluarChip({ row, plantaKey, plantaNombre });
    });

    const totalEstimado = redondear(items.reduce(
        (total, item) => total + (item.validoParaVenta ? Number(item.precio) : 0),
        0
    ));
    const cantidadValidos = items.filter((item) => item.validoParaVenta).length;

    return {
        items,
        totalEstimado,
        cantidadSolicitados: items.length,
        cantidadValidos
    };
};

module.exports = {
    validarVentaDirecta
};
