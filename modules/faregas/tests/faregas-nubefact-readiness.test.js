const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-nubefact-readiness.service');
const db = require('../../../config/database');

test.after(() => db.end());

const resumen = {
    cliente: { numeroDocumento: '12345678', nombreRazonSocial: 'CLIENTE' },
    emisor: { ruc: '20600444531', razonSocial: 'EMPRESA' },
    comprobante: { serie: 'BE02' },
    items: [{ productoFacturacionId: 10 }],
    totales: { baseImponible: 67.8, igv: 12.2, total: 80 },
    errores: [],
    advertencias: []
};

test('presenta bloqueos separados sin intentar emitir', () => {
    const result = service._private.construirChecksCertificado({
        resumen: { ...resumen, items: [{ productoFacturacionId: null }] },
        integracion: { configured: false }
    });
    assert.equal(result.estado, 'BLOQUEADO');
    assert.ok(result.checks.some(item => item.codigo === 'CATALOGO_FISCAL' && item.estado === 'BLOQUEO'));
    assert.ok(result.checks.some(item => item.codigo === 'CREDENCIALES' && item.estado === 'BLOQUEO'));
});

test('no confunde una advertencia tributaria con un bloqueo', () => {
    const result = service._private.construirChecksCertificado({
        resumen: { ...resumen, advertencias: ['No se registró correo.'] },
        integracion: { configured: true }
    });
    assert.ok(result.checks.some(item => item.estado === 'ADVERTENCIA'));
});

test('no duplica el bloqueo de catálogo cuando el resumen usa otra redacción', () => {
    const result = service._private.construirChecksCertificado({
        resumen: {
            ...resumen,
            items: [{ productoFacturacionId: null }],
            errores: ['La tarifa seleccionada no tiene un producto de facturación vinculado.']
        },
        integracion: { configured: true }
    });
    assert.equal(result.checks.filter(item => item.codigo === 'CATALOGO_FISCAL').length, 1);
    assert.equal(result.checks.filter(item => /producto (fiscal|de facturación)/i.test(item.mensaje)).length, 1);
});

const entradaFase2Lista = (pruebaDemo = { aceptadas: 0, aceptadasConArchivos: 0 }) => ({
    configuracion: { environment: 'DEMO', detractionDecision: 'NO_APLICA' },
    esquema: { seriesV2Aplicada: true, pendienteSunatAplicado: true, completo: true },
    catalogo: { activas: 81, listas: 81 },
    series: {
        nubefactPredeterminadas: 2,
        seriesBasicasRequeridas: 2,
        seriesBasicasConfiguradas: 2,
        seriesBasicasFaltantes: []
    },
    credenciales: { total: 14, configuradas: 14 },
    pruebaDemo
});

test('fase 2 queda lista para prueba cuando las cinco puertas previas están completas', () => {
    const result = service._private.construirFase2(entradaFase2Lista());
    assert.equal(result.estado, 'LISTA_PARA_PRUEBA_DEMO');
    assert.equal(result.completados, 5);
    assert.equal(result.progreso, 83);
    assert.equal(result.pasos.find(item => item.codigo === 'PRUEBA_DEMO').estado, 'PENDIENTE');
});

test('fase 2 solamente termina con evidencia de PDF, XML y CDR en DEMO', () => {
    const result = service._private.construirFase2(entradaFase2Lista({
        aceptadas: 1,
        aceptadasConArchivos: 1
    }));
    assert.equal(result.estado, 'COMPLETADA');
    assert.equal(result.completados, 6);
    assert.equal(result.progreso, 100);
});

test('fase 2 identifica cada puerta pendiente sin habilitar operaciones', () => {
    const result = service._private.construirFase2({
        configuracion: { environment: 'PRODUCCION', detractionDecision: 'PENDIENTE' },
        esquema: { seriesV2Aplicada: false, pendienteSunatAplicado: false, completo: false },
        catalogo: { activas: 81, listas: 0 },
        series: {
            nubefactPredeterminadas: 0,
            seriesBasicasRequeridas: 2,
            seriesBasicasConfiguradas: 0,
            seriesBasicasFaltantes: ['201:FACTURA', '201:BOLETA']
        },
        credenciales: { total: 14, configuradas: 0 },
        pruebaDemo: { aceptadas: 0, aceptadasConArchivos: 0 }
    });
    assert.equal(result.estado, 'EN_PREPARACION');
    assert.equal(result.completados, 0);
    assert.ok(result.pasos.every(item => item.siguienteAccion));
});

test('verifica de forma independiente las dos migraciones exigidas por fase 2', async () => {
    const queryable = {
        query: async (sql) => sql.includes('COUNT(*)::int AS columnas')
            ? { rows: [{ columnas: 6 }] }
            : { rows: [{ pendiente_sunat_aplicado: true, chips_aplicado: false }] }
    };
    const result = await service._private.obtenerEstadoEsquema(queryable);
    assert.deepEqual(result, {
        seriesV2Aplicada: true,
        pendienteSunatAplicado: true,
        chipsAplicado: false,
        completo: true
    });
});

const entradaProduccionLista = (pruebas = {
    boletaAceptadaConArchivos: false,
    facturaAceptadaConArchivos: false
}) => ({
    configuracion: {
        environment: 'PRODUCCION', enabled: true, productionConfirmed: true,
        correlativosV2Enabled: true, cronReconciliationEnabled: true,
        enviarSunat: true, detractionDecision: 'NO_APLICA'
    },
    esquema: { completo: true },
    catalogo: { activas: 5, listasProduccion: 5 },
    credenciales: { total: 1, configuradas: 1 },
    series: {
        requeridas: 2,
        confirmadas: 2,
        detalle: [
            {
                tipoComprobante: 'FACTURA', configurada: true, serie: 'F001', ultimoNumero: 4562,
                confirmadaProduccion: true, numeroInicialConfirmado: 4562, fechaCorte: '2026-09-07'
            },
            {
                tipoComprobante: 'BOLETA', configurada: true, serie: 'B001', ultimoNumero: 12058,
                confirmadaProduccion: true, numeroInicialConfirmado: 12058, fechaCorte: '2026-09-07'
            }
        ]
    },
    pruebas
});

test('producción puede quedar lista sin exigir que DEMO esté al 100%', () => {
    const result = service._private.construirPreparacionProduccion(entradaProduccionLista());
    assert.equal(result.requiereDemo, false);
    assert.equal(result.estado, 'LISTA_PARA_EMISION_CONTROLADA');
    assert.equal(result.pasos.find(item => item.codigo === 'BOLETA_PRODUCTIVA').estado, 'PENDIENTE');
    assert.ok(result.pasos.every(item => !item.codigo.includes('DEMO')));
});

test('producción solo queda operativa con boleta y factura aceptadas con archivos', () => {
    const result = service._private.construirPreparacionProduccion(entradaProduccionLista({
        boletaAceptadaConArchivos: true,
        facturaAceptadaConArchivos: true
    }));
    assert.equal(result.estado, 'OPERATIVA');
    assert.equal(result.progreso, 100);
});

test('catálogo con marcadores DEMO bloquea el preflight productivo', () => {
    const input = entradaProduccionLista();
    input.catalogo.listasProduccion = 0;
    const result = service._private.construirPreparacionProduccion(input);
    assert.equal(result.estado, 'EN_PREPARACION');
    assert.equal(result.pasos.find(item => item.codigo === 'CATALOGO_PRODUCTIVO').estado, 'PENDIENTE');
});
