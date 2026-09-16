const redondear = (valor) => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;

const obtenerTarifaConfigurada = (tipoCertificado) => {
    const variable = `FAREGAS_TARIFA_${tipoCertificado}`;
    const tarifa = redondear(process.env[variable] || process.env.FAREGAS_TARIFA_DEFAULT || 150);
    if (!Number.isFinite(tarifa) || tarifa <= 0) throw new Error('TARIFA_NO_CONFIGURADA');
    return tarifa;
};

const normalizarPagos = (pagos = []) => {
    const normalizados = [];
    let efectivo = 0;
    for (const pago of pagos) {
        const tipo = String(pago.tipo || pago.tipoContadoKey || '').trim().toLowerCase();
        const importe = redondear(pago.importe);
        if (!['efectivo', 'tarjeta', 'banco'].includes(tipo)) throw new Error('TIPO_PAGO_INVALIDO');
        if (!Number.isFinite(importe) || importe <= 0) throw new Error('IMPORTE_PAGO_INVALIDO');
        if (tipo === 'efectivo') {
            efectivo = redondear(efectivo + importe);
        } else {
            normalizados.push({ ...pago, tipo, importe });
        }
    }
    if (efectivo > 0) normalizados.unshift({ tipo: 'efectivo', importe: efectivo });
    return normalizados;
};

const esProductoFiscalChipValido = (producto) => {
    if (!producto || producto.activo !== true || producto.es_para_venta !== true) return false;
    const unidad = String(producto.unidad || '').trim().toUpperCase();
    const afectacionIgv = String(producto.tipo_afectacion_igv || '').trim();
    const codigoSku = String(producto.codigo_sku || '').trim();
    const descripcion = String(producto.descripcion || '').trim();
    const codigoSunat = String(producto.codigo_clasificacion_sunat || '').trim();
    return Boolean(codigoSku)
        && Boolean(descripcion)
        && ['NIU', 'ZZ'].includes(unidad)
        && afectacionIgv === '10'
        && (!codigoSunat || /^\d{8}$/.test(codigoSunat));
};

const construirSnapshotProducto = (tarifa, certificado) => ({
    productoFacturacionId: tarifa.producto_facturacion_id || null,
    codigoSku: tarifa.producto_sku || tarifa.servicio_codigo,
    descripcion: tarifa.producto_descripcion
        || tarifa.servicio_nombre
        || `CERTIFICACION ${certificado.tipo_certificado_clave}`,
    unidad: String(tarifa.producto_unidad || 'ZZ').trim().toUpperCase(),
    afectacionIgv: String(tarifa.producto_afectacion_igv || '10').trim(),
    codigoSunat: tarifa.producto_codigo_sunat || null
});

module.exports = {
    redondear,
    obtenerTarifaConfigurada,
    normalizarPagos,
    construirSnapshotProducto,
    esProductoFiscalChipValido
};
