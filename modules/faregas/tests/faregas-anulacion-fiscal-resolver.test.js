const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const {
    resolverOperacionFiscal,
    RESULTADOS,
    OPERACIONES
} = require('../services/faregas-anulacion-fiscal.resolver');

const AHORA = new Date('2026-10-26T12:00:00Z');
const RECIENTE = '2026-10-24T10:00:00Z';
const ANTIGUO = '2026-10-01T10:00:00Z';

const documentoBase = (overrides = {}) => ({
    tipoComprobante: 'BOLETA',
    serie: 'BBB1',
    numero: 231,
    nroComprobante: 'BBB1-00000231',
    estado: 'PENDIENTE_SUNAT',
    aceptadaSunat: false,
    fechaEmision: RECIENTE,
    importeTotal: 118,
    ...overrides
});

test('factura pendiente sin CDR no permite baja ni nota', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({ tipoComprobante: 'FACTURA', serie: 'F001', nroComprobante: 'F001-00000001' }),
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.PENDIENTE_VERIFICACION);
    assert.equal(resolucion.operacion, OPERACIONES.CONSULTAR);
    assert.equal(resolucion.siguientePaso, 'ESPERAR_CDR');
});

test('factura aceptada dentro del plazo es baja elegible', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({
            tipoComprobante: 'FACTURA',
            serie: 'F001',
            nroComprobante: 'F001-00000001',
            estado: 'ACEPTADO',
            aceptadaSunat: true,
            fechaAceptacion: RECIENTE
        }),
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.BAJA_ELEGIBLE);
    assert.equal(resolucion.operacion, OPERACIONES.COMUNICACION_BAJA);
    assert.equal(resolucion.plazo.dias, 7);
});

test('factura aceptada fuera del plazo exige nota de crédito total', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({
            tipoComprobante: 'FACTURA',
            serie: 'F001',
            nroComprobante: 'F001-00000001',
            estado: 'ACEPTADO',
            aceptadaSunat: true,
            fechaAceptacion: ANTIGUO
        }),
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.NOTA_CREDITO_ELEGIBLE);
    assert.equal(resolucion.operacion, OPERACIONES.NOTA_CREDITO);
});

test('boleta no informada dentro del plazo permite baja pese a PENDIENTE_SUNAT', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase(),
        resumenDiario: { informada: false },
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.BAJA_ELEGIBLE);
    assert.equal(resolucion.operacion, OPERACIONES.COMUNICACION_BAJA);
    assert.equal(resolucion.requiereSeguimientoTicket, true);
});

test('boleta no informada fuera del plazo exige verificación del resumen/CDR', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({ fechaEmision: ANTIGUO }),
        resumenDiario: { informada: false },
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.PENDIENTE_VERIFICACION);
    assert.equal(resolucion.siguientePaso, 'CONSULTAR_RESUMEN_DIARIO_O_CDR');
});

test('boleta informada y aceptada dentro del plazo es baja elegible', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({
            estado: 'ACEPTADO',
            aceptadaSunat: true,
            fechaAceptacion: RECIENTE
        }),
        resumenDiario: { informada: true, aceptada: true, estado: 'ACEPTADO' },
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.BAJA_ELEGIBLE);
});

test('boleta informada y aceptada fuera del plazo exige nota de crédito', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({
            estado: 'ACEPTADO',
            aceptadaSunat: true,
            fechaAceptacion: ANTIGUO
        }),
        resumenDiario: { informada: true, aceptada: true, estado: 'ACEPTADO' },
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.NOTA_CREDITO_ELEGIBLE);
});

test('boleta con resumen diario pendiente no se opera hasta tener CDR', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase(),
        resumenDiario: { informada: true, pendiente: true, estado: 'PENDIENTE' },
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.PENDIENTE_VERIFICACION);
    assert.equal(resolucion.siguientePaso, 'ESPERAR_CDR_RESUMEN');
});

test('nota de crédito aceptada dentro del plazo permite baja por tipo 3', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({
            tipoComprobante: 'NOTA_CREDITO_FACTURA',
            serie: 'FC01',
            nroComprobante: 'FC01-00000001',
            estado: 'ACEPTADO',
            aceptadaSunat: true,
            fechaAceptacion: RECIENTE
        }),
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.BAJA_ELEGIBLE);
    assert.equal(resolucion.tipoComprobanteApi, 3);
});

test('nota de crédito fuera del plazo no admite otra nota sobre sí misma', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({
            tipoComprobante: 'NOTA_CREDITO',
            serie: 'FC01',
            nroComprobante: 'FC01-00000001',
            estado: 'ACEPTADO',
            aceptadaSunat: true,
            fechaAceptacion: ANTIGUO
        }),
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.NO_ELEGIBLE);
    assert.equal(resolucion.requiereIntervencion, true);
});

test('nota pendiente sin CDR queda en verificación', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({
            tipoComprobante: 'NOTA_DEBITO',
            serie: 'FD01',
            nroComprobante: 'FD01-00000001',
            estado: 'PENDIENTE_SUNAT',
            aceptadaSunat: false
        }),
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.PENDIENTE_VERIFICACION);
    assert.equal(resolucion.siguientePaso, 'ESPERAR_CDR');
});

test('documento ya anulado o con nota total aceptada no se vuelve a operar', () => {
    const porAnulado = resolverOperacionFiscal({
        documento: documentoBase({ anulado: true, estado: 'ACEPTADO', aceptadaSunat: true }),
        ahora: AHORA
    });
    assert.equal(porAnulado.resultado, RESULTADOS.YA_ANULADO);

    const porNota = resolverOperacionFiscal({
        documento: documentoBase({ estado: 'ACEPTADO', aceptadaSunat: true, fechaAceptacion: ANTIGUO }),
        operacionesPrevias: [{ tipo: 'NOTA_CREDITO', estado: 'ACEPTADO', importeTotal: 118 }],
        totalNotasPrevias: 118,
        ahora: AHORA
    });
    assert.equal(porNota.resultado, RESULTADOS.YA_ANULADO);
});

test('operación previa activa evita duplicados', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({ estado: 'ACEPTADO', aceptadaSunat: true, fechaAceptacion: RECIENTE }),
        operacionesPrevias: [{ id: 77, tipo: 'BAJA', estado: 'PENDIENTE', ticket: 'T-77' }],
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.PENDIENTE_VERIFICACION);
    assert.equal(resolucion.operacion, OPERACIONES.CONSULTAR);
    assert.equal(resolucion.operacionId, 77);
});

test('operación previa fallida exige reintentar el mismo registro, no crear otro', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({ estado: 'ACEPTADO', aceptadaSunat: true, fechaAceptacion: RECIENTE }),
        operacionesPrevias: [{ id: 88, tipo: 'NOTA_CREDITO', estado: 'ERROR' }],
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.PENDIENTE_VERIFICACION);
    assert.equal(resolucion.reintentarMismoRegistro, true);
    assert.equal(resolucion.operacionId, 88);
});

test('rechazo definitivo y tipo no soportado son no elegibles', () => {
    const rechazado = resolverOperacionFiscal({
        documento: documentoBase({ estado: 'RECHAZADO', aceptadaSunat: false }),
        ahora: AHORA
    });
    assert.equal(rechazado.resultado, RESULTADOS.NO_ELEGIBLE);

    const desconocido = resolverOperacionFiscal({
        documento: documentoBase({ tipoComprobante: 'GUIA_REMISION' }),
        ahora: AHORA
    });
    assert.equal(desconocido.resultado, RESULTADOS.NO_ELEGIBLE);
});

test('identidad incompleta detiene la operación', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({ serie: null, numero: null, nroComprobante: null }),
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.NO_ELEGIBLE);
    assert.match(resolucion.motivo, /condiciones tributarias operables/i);
});

test('la evidencia de plazo del repositorio prevalece para pruebas controladas', () => {
    const resolucion = resolverOperacionFiscal({
        documento: documentoBase({ estado: 'ACEPTADO', aceptadaSunat: true }),
        plazoBaja: { dentro: false, fechaBase: ANTIGUO, fuente: 'CDR' },
        ahora: AHORA
    });
    assert.equal(resolucion.resultado, RESULTADOS.NOTA_CREDITO_ELEGIBLE);
    assert.equal(resolucion.plazo.vencido, true);
});
