const { redondear, esProductoFiscalChipValido } = require('./faregas-pagos.rules');

const SEDES_OPERATIVAS_CHIPS = Object.freeze(['13', '98', '160']);

const validarSedeOperativaChips = (plantaKey, codigo = 'SEDE_CHIP_NO_HABILITADA') => {
    const key = String(plantaKey || '').trim();
    if (!SEDES_OPERATIVAS_CHIPS.includes(key)) {
        const error = new Error(codigo);
        error.detalles = { plantaKey: key, sedesPermitidas: SEDES_OPERATIVAS_CHIPS };
        throw error;
    }
    return key;
};

const obtenerPrecioVentaFiscal = (productoFiscal) => {
    const precio = Number(productoFiscal?.precio_referencia);
    if (!Number.isFinite(precio) || precio <= 0) {
        throw new Error('PRECIO_VENTA_FISCAL_CHIP_INVALIDO');
    }
    return redondear(precio);
};

const validarProductoFiscalChip = (productoFiscal) => {
    if (!productoFiscal?.producto_facturacion_id) {
        throw new Error('CHIP_PRODUCTO_FISCAL_NO_CONFIGURADO');
    }
    if (!esProductoFiscalChipValido({
        activo: productoFiscal.fiscal_activo,
        es_para_venta: productoFiscal.es_para_venta,
        codigo_sku: productoFiscal.codigo_sku,
        descripcion: productoFiscal.descripcion,
        unidad: productoFiscal.unidad,
        tipo_afectacion_igv: productoFiscal.tipo_afectacion_igv,
        codigo_clasificacion_sunat: productoFiscal.codigo_clasificacion_sunat
    })) {
        throw new Error('PRODUCTO_FISCAL_CHIP_INVALIDO');
    }
    return obtenerPrecioVentaFiscal(productoFiscal);
};

module.exports = {
    SEDES_OPERATIVAS_CHIPS,
    validarSedeOperativaChips,
    obtenerPrecioVentaFiscal,
    validarProductoFiscalChip
};
