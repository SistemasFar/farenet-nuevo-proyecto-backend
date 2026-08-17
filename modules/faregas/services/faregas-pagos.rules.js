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

module.exports = { redondear, obtenerTarifaConfigurada, normalizarPagos };
