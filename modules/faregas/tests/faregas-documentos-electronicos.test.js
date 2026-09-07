const test = require('node:test');
const assert = require('node:assert/strict');
const documentos = require('../services/faregas-documentos-electronicos.service');
const {
    construirPayloadNota,
    mapearAceptacionSunat,
    mapearEstadoProveedor
} = require('../integrations/nubefact-faregas.adapter');

test('valida importes y limite de una nota de credito', () => {
    const validar = documentos._private.validarDatosNota;
    const data = validar('CREDITO', {
        motivoCodigo: '1', sustento: 'ANULACION DE OPERACION',
        baseImponible: 100, igv: 18, importeTotal: 118
    }, { importe_total: 118 });
    assert.equal(data.motivoCodigo, '1');
    assert.throws(() => validar('CREDITO', {
        motivoCodigo: '1', sustento: 'EXCESO', baseImponible: 200, igv: 36, importeTotal: 236
    }, { importe_total: 118 }), /NOTA_CREDITO_DEBE_SER_TOTAL/);
});

test('construye una nota vinculada al comprobante original', () => {
    const payload = construirPayloadNota({
        tipoNota: 'CREDITO',
        nota: { serie: 'FC01', numero: 10, motivo_codigo: '1', sustento: 'ANULACION', base_imponible: 100, igv: 18, importe_total: 118, codigo_unico: 'FGNC-10' },
        facturacion: { tipo_comprobante: 'FACTURA', tipo_documento_cliente: 'RUC', nro_documento: '20123456789', nombre_razon_social: 'CLIENTE', direccion: 'LIMA', serie: 'FE01', numero: 7 }
    });
    assert.equal(payload.tipo_de_comprobante, 3);
    assert.equal(payload.documento_que_se_modifica_tipo, 1);
    assert.equal(payload.documento_que_se_modifica_serie, 'FE01');
    assert.equal(payload.documento_que_se_modifica_numero, 7);
    assert.equal(payload.tipo_de_nota_de_credito, 1);
});

test('mapea el estado asíncrono según el agregado persistido', () => {
    const pendiente = { status: 'PENDING_SUNAT' };
    assert.equal(mapearEstadoProveedor(pendiente, 'FACTURACION'), 'PENDIENTE_SUNAT');
    assert.equal(mapearEstadoProveedor(pendiente, 'DOCUMENTO_RELACIONADO'), 'PENDIENTE');
    assert.equal(mapearEstadoProveedor(pendiente, 'OPERACION'), 'PROCESANDO');
    assert.equal(mapearEstadoProveedor({ status: 'ACCEPTED' }, 'DOCUMENTO_RELACIONADO'), 'ACEPTADO');
    assert.equal(mapearEstadoProveedor({ status: 'REJECTED' }, 'DOCUMENTO_RELACIONADO'), 'RECHAZADO');
    assert.equal(mapearEstadoProveedor({ status: 'ERROR' }, 'DOCUMENTO_RELACIONADO'), 'ERROR');
    assert.equal(mapearAceptacionSunat({ status: 'ACCEPTED' }), true);
    assert.equal(mapearAceptacionSunat({ status: 'REJECTED' }), false);
    assert.equal(mapearAceptacionSunat(pendiente), null);
});

test('consulta antes de decidir cuando una nota o anulación tuvo resultado incierto', async () => {
    let consultas = 0;
    const resultado = await documentos._private.recuperarResultadoIncierto({
        resultado: { status: 'ERROR', reason: 'TIMEOUT' },
        consultar: async () => {
            consultas += 1;
            return { status: 'PENDING_SUNAT', reason: 'PENDING_SUNAT' };
        },
        payload: { serie: 'FC01', numero: 10 },
        credentials: { token: 'secreto-de-prueba' }
    });
    assert.equal(consultas, 1);
    assert.equal(resultado.status, 'PENDING_SUNAT');
});

test('no consulta nuevamente ante un rechazo tributario definitivo', async () => {
    let consultas = 0;
    const rechazo = { status: 'REJECTED', reason: 'REJECTED_BY_PROVIDER' };
    const resultado = await documentos._private.recuperarResultadoIncierto({
        resultado: rechazo,
        consultar: async () => { consultas += 1; },
        payload: {},
        credentials: {}
    });
    assert.equal(consultas, 0);
    assert.equal(resultado, rechazo);
});
