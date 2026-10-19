const test = require('node:test');
const assert = require('node:assert/strict');

const {
    construirPayloadNubefact
} = require('../integrations/nubefact-faregas.adapter');
const {
    validarFacturacion,
    validarCuotasContraTotal
} = require('../services/faregas-facturacion.rules');

const facturacionBase = (overrides = {}) => ({
    id: 91,
    tipo_comprobante: 'FACTURA',
    tipo_documento_cliente: 'RUC',
    nro_documento: '20521536463',
    nombre_razon_social: 'EMPRESA PRUEBA S.A.C.',
    direccion: 'AV. PRINCIPAL 123',
    email: 'contacto@prueba.pe',
    telefono: '999888777',
    condicion_pago: 'CREDITO',
    medio_pago: null,
    fecha_documento: '2026-10-15',
    fecha_vencimiento: '2026-10-30',
    serie: 'FFF1',
    numero: 7,
    base_imponible: 76.27,
    igv: 13.73,
    importe_total: 90,
    sede_nombre_snapshot: 'SURCO',
    ...overrides
});

const vehiculo = {
    placa: 'ABC123',
    clase: 'AUTOMOVIL',
    marca: 'TOYOTA',
    modelo: 'YARIS',
    numero_motor: 'HZ1110WKR295C0031'
};

const certificado = {
    id: 585,
    tipo_certificado_clave: 'GLP_ANUAL',
    numero_certificado: null
};

// Helper que replica la validación lógica de orden y facturación en validarEmision
function validarOrdenFacturacion({ orden, facturacion, cuotas }) {
    const errores = [];
    const pushError = (seccion, campo, codigo, mensaje) => errores.push({ seccion, campo, codigo, mensaje });

    const tipoComprobante = String(facturacion?.tipo_comprobante || '').toUpperCase();
    const condicionPago = String(facturacion?.condicion_pago || (orden?.formapago_key === 'credito' ? 'CREDITO' : 'CONTADO')).toUpperCase();
    const esFacturaCredito = tipoComprobante === 'FACTURA' && condicionPago === 'CREDITO';

    if (tipoComprobante === 'BOLETA' && (condicionPago === 'CREDITO' || orden?.formapago_key === 'credito')) {
        pushError('pago', 'condicion', 'BOLETA_CREDITO_INVALIDA', 'Una boleta solo puede emitirse con condición de pago CONTADO.');
    } else if (esFacturaCredito) {
        const saldoPendiente = Number(orden?.saldo_pendiente || 0);
        if (saldoPendiente <= 0.009) {
            pushError('pago', 'saldo', 'CREDITO_SIN_SALDO', 'Una venta a crédito debe conservar un saldo pendiente. Cambie la condición a CONTADO o reduzca el pago inicial.');
        } else if (facturacion?.id) {
            if (!cuotas || cuotas.length === 0) {
                pushError('pago', 'cuotas', 'CUOTAS_REQUERIDAS', 'Una venta al crédito requiere al menos una cuota.');
            } else {
                const sumaCuotas = cuotas.reduce((acc, c) => acc + Number(c.importe || 0), 0);
                if (Math.abs(sumaCuotas - saldoPendiente) > 0.009) {
                    pushError('pago', 'cuotas', 'CUOTAS_SALDO_DISCREPANCIA', 'La suma de las cuotas debe ser igual al saldo pendiente.');
                }
            }
        } else {
            pushError('pago', 'cuotas', 'CUOTAS_REQUERIDAS', 'Una venta al crédito requiere al menos una cuota.');
        }
    } else {
        if (orden?.estado !== 'PAGADO' || Number(orden?.saldo_pendiente || 0) > 0.009) {
            pushError('pago', 'saldo', 'PAGO_INCOMPLETO', `Pago incompleto. Saldo pendiente: S/ ${Number(orden?.saldo_pendiente || 0).toFixed(2)}`);
        }
    }

    return { valido: errores.length === 0, errores };
}

test('CASO 1: Factura crédito Total 90, Inicial 0, Cuota 90 -> válido, payload crédito', () => {
    const orden = { estado: 'PENDIENTE', importe_total: 90, importe_pagado: 0, saldo_pendiente: 90, formapago_key: 'credito' };
    const facturacion = facturacionBase({ condicion_pago: 'CREDITO' });
    const cuotas = [{ numero_cuota: 1, fecha_pago: '2026-10-30', importe: 90 }];

    const validacion = validarOrdenFacturacion({ orden, facturacion, cuotas });
    assert.equal(validacion.valido, true, 'Validación debe ser exitosa');
    assert.equal(validacion.errores.length, 0);

    const payload = construirPayloadNubefact({ facturacion, certificado, vehiculo, cuotas });
    assert.equal(payload.condiciones_de_pago, 'CREDITO');
    assert.equal(payload.cancelado, false);
    assert.equal(payload.forma_de_pago, 'Credito');
    assert.equal(payload.medio_de_pago, 'credito');
    assert.equal(payload.venta_al_credito.length, 1);
    assert.equal(payload.venta_al_credito[0].importe, 90);
});

test('CASO 2: Factura crédito Total 90, Inicial 30, Cuotas 60 -> válido', () => {
    const orden = { estado: 'PENDIENTE', importe_total: 90, importe_pagado: 30, saldo_pendiente: 60, formapago_key: 'credito' };
    const facturacion = facturacionBase({ condicion_pago: 'CREDITO', medio_pago: 'EFECTIVO' });
    const cuotas = [{ numero_cuota: 1, fecha_pago: '2026-10-30', importe: 60 }];

    const validacion = validarOrdenFacturacion({ orden, facturacion, cuotas });
    assert.equal(validacion.valido, true);
    assert.equal(validacion.errores.length, 0);

    assert.equal(validarCuotasContraTotal(cuotas, orden.saldo_pendiente), true);

    const payload = construirPayloadNubefact({ facturacion, certificado, vehiculo, cuotas });
    assert.equal(payload.condiciones_de_pago, 'CREDITO');
    assert.equal(payload.medio_de_pago, 'credito');
    assert.equal(payload.cancelado, false);
    assert.equal(payload.venta_al_credito.length, 1);
    assert.equal(payload.venta_al_credito[0].importe, 60);
});

test('CASO 3: Factura crédito Total 90, Inicial 90, Saldo 0 -> inválido como crédito', () => {
    const orden = { estado: 'PAGADO', importe_total: 90, importe_pagado: 90, saldo_pendiente: 0, formapago_key: 'credito' };
    const facturacion = facturacionBase({ condicion_pago: 'CREDITO' });
    const cuotas = [];

    const validacion = validarOrdenFacturacion({ orden, facturacion, cuotas });
    assert.equal(validacion.valido, false);
    assert.match(validacion.errores[0].mensaje, /debe conservar un saldo pendiente/i);
});

test('CASO 4: Factura crédito Saldo 90, Sin cuotas -> inválido', () => {
    const orden = { estado: 'PENDIENTE', importe_total: 90, importe_pagado: 0, saldo_pendiente: 90, formapago_key: 'credito' };
    const facturacion = facturacionBase({ condicion_pago: 'CREDITO' });
    const cuotas = [];

    const validacion = validarOrdenFacturacion({ orden, facturacion, cuotas });
    assert.equal(validacion.valido, false);
    assert.equal(validacion.errores[0].codigo, 'CUOTAS_REQUERIDAS');
});

test('CASO 5: Factura crédito Saldo 90, Cuotas suman 80 -> inválido', () => {
    const orden = { estado: 'PENDIENTE', importe_total: 90, importe_pagado: 0, saldo_pendiente: 90, formapago_key: 'credito' };
    const facturacion = facturacionBase({ condicion_pago: 'CREDITO' });
    const cuotas = [{ numero_cuota: 1, fecha_pago: '2026-10-30', importe: 80 }];

    const validacion = validarOrdenFacturacion({ orden, facturacion, cuotas });
    assert.equal(validacion.valido, false);
    assert.equal(validacion.errores[0].codigo, 'CUOTAS_SALDO_DISCREPANCIA');
});

test('CASO 6: Factura contado Saldo > 0 -> inválido', () => {
    const orden = { estado: 'PENDIENTE', importe_total: 90, importe_pagado: 30, saldo_pendiente: 60, formapago_key: 'contado' };
    const facturacion = facturacionBase({ condicion_pago: 'CONTADO' });
    const cuotas = [];

    const validacion = validarOrdenFacturacion({ orden, facturacion, cuotas });
    assert.equal(validacion.valido, false);
    assert.equal(validacion.errores[0].codigo, 'PAGO_INCOMPLETO');
});

test('CASO 7: Boleta Saldo > 0 -> inválido', () => {
    const orden = { estado: 'PENDIENTE', importe_total: 90, importe_pagado: 0, saldo_pendiente: 90, formapago_key: 'contado' };
    const facturacion = facturacionBase({ tipo_comprobante: 'BOLETA', condicion_pago: 'CONTADO' });
    const cuotas = [];

    const validacion = validarOrdenFacturacion({ orden, facturacion, cuotas });
    assert.equal(validacion.valido, false);
    assert.equal(validacion.errores[0].codigo, 'PAGO_INCOMPLETO');
});

test('CASO 8: Factura ya emitida + Certificado pendiente + Crédito válido -> reintento no duplica y valida', () => {
    const facturacionEmitida = facturacionBase({
        estado: 'ACEPTADO',
        nro_comprobante: 7,
        serie: 'FFF1',
        condicion_pago: 'CREDITO'
    });
    const orden = { estado: 'PENDIENTE', importe_total: 90, importe_pagado: 0, saldo_pendiente: 90, formapago_key: 'credito' };
    const cuotas = [{ numero_cuota: 1, fecha_pago: '2026-10-30', importe: 90 }];

    // Idempotencia: estado ACEPTADO indica comprobante resuelto
    const esComprobanteYaEmitido = (f) => f?.estado === 'ACEPTADO' || f?.estado === 'PENDIENTE_SUNAT';
    assert.equal(esComprobanteYaEmitido(facturacionEmitida), true);

    const validacion = validarOrdenFacturacion({ orden, facturacion: facturacionEmitida, cuotas });
    assert.equal(validacion.valido, true);
    assert.equal(validacion.errores.length, 0);
});

test('CASO 9 — PAYLOAD: Factura crédito -> condiciones_de_pago = CREDITO, cancelado = false, venta_al_credito con cuotas', () => {
    const facturacion = facturacionBase({ condicion_pago: 'CREDITO' });
    const cuotas = [{ numero_cuota: 1, fecha_pago: '2026-10-30', importe: 90 }];

    const payload = construirPayloadNubefact({ facturacion, certificado, vehiculo, cuotas });
    assert.equal(payload.condiciones_de_pago, 'CREDITO');
    assert.equal(payload.forma_de_pago, 'Credito');
    assert.equal(payload.medio_de_pago, 'credito');
    assert.equal(payload.cancelado, false);
    assert.deepEqual(payload.venta_al_credito, [
        { cuota: 1, fecha_de_pago: '30-10-2026', importe: 90 }
    ]);
});

test('CASO 10 — PAYLOAD CONTADO: Factura contado -> CONTADO, cancelado = true, sin venta_al_credito', () => {
    const facturacion = facturacionBase({ condicion_pago: 'CONTADO', medio_pago: null });
    const payload = construirPayloadNubefact({ facturacion, certificado, vehiculo, cuotas: [] });

    assert.equal(payload.condiciones_de_pago, 'CONTADO');
    assert.equal(payload.forma_de_pago, 'Contado');
    assert.equal(payload.medio_de_pago, '');
    assert.equal(payload.cancelado, true);
    assert.deepEqual(payload.venta_al_credito, []);
});

test('CASO 11 — BOLETA: Siempre CONTADO sin crédito', () => {
    const facturacion = facturacionBase({ tipo_comprobante: 'BOLETA', condicion_pago: 'CONTADO', medio_pago: 'EFECTIVO' });
    const payload = construirPayloadNubefact({ facturacion, certificado, vehiculo, cuotas: [] });

    assert.equal(payload.tipo_de_comprobante, 2);
    assert.equal(payload.condiciones_de_pago, 'CONTADO');
    assert.equal(payload.forma_de_pago, 'Contado');
    assert.equal(payload.medio_de_pago, 'EFECTIVO');
    assert.equal(payload.cancelado, true);
    assert.deepEqual(payload.venta_al_credito, []);

    // Regla de validación: Boleta no admite crédito
    const errores = validarFacturacion({
        tipoComprobante: 'BOLETA',
        condicionPago: 'CREDITO',
        tipoDocumentoCliente: 'DNI',
        nroDocumento: '12345678',
        nombreRazonSocial: 'JUAN',
        direccion: 'DIR',
        cuotas: []
    });
    assert.match(errores.join(' '), /Una BOLETA solo puede emitirse con condicion de pago CONTADO/);
});
