const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const integrationsConfig = require('../../../config/integrations.config');
const documentoTributarioPolicy = require('../services/faregas-documento-tributario-policy');
const productosImpactoService = require('../services/faregas-productos-impacto.service');
const categoriasImpactoService = require('../services/faregas-categorias-impacto.service');

const normalizar = (sql) => String(sql).replace(/\s+/g, ' ').trim();

/**
 * Cliente simulado mínimo: registra escrituras y permite verificar que el
 * bloqueo ocurre ANTES de la primera escritura.
 */
class FakeClienteLimpieza {
    constructor() {
        this.escrituras = [];
        this.facturaciones = new Map([[900, { id: 900 }]]);
        this.intentos = new Map();
        this.cuotas = new Map();
        this.ordenes = new Map([[700, { id: 700 }]]);
        this.pagos = new Map([[800, { id: 800 }]]);
        this.operaciones = new Map([[187, { id: 187 }]]);
        this.detalles = new Map([[115, { id: 115 }]]);
        this.certificados = new Map([[302, { id: 302 }]]);
    }

    async query(sqlCrudo, params = []) {
        const sql = normalizar(sqlCrudo);
        if (/^(DELETE|UPDATE) /.test(sql)) this.escrituras.push(sql);
        const vacio = { rowCount: 0, rows: [] };

        if (/SELECT id FROM fg_operacion_comercial WHERE/.test(sql)) return { rowCount: params[0].length, rows: [] };
        if (/SELECT id FROM fg_certificado WHERE/.test(sql)) return { rowCount: params[0].length, rows: [] };
        if (/SELECT id FROM fg_chip|SELECT id FROM fg_chip_movimiento|SELECT id FROM fg_facturacion WHERE|SELECT id FROM fg_orden_pago WHERE|SELECT id FROM fg_credito|SELECT id FROM fg_debito|SELECT id FROM fg_documento_anulacion/.test(sql)) {
            return { rowCount: 0, rows: [] };
        }
        if (/DELETE FROM fg_facturacion_intento/.test(sql)) {
            const antes = this.intentos.size;
            (params[0] || []).forEach((id) => this.intentos.delete(Number(id)));
            return { rowCount: antes - this.intentos.size, rows: [] };
        }
        if (/DELETE FROM fg_facturacion_cuota/.test(sql)) {
            const antes = this.cuotas.size;
            (params[0] || []).forEach((id) => this.cuotas.delete(Number(id)));
            return { rowCount: antes - this.cuotas.size, rows: [] };
        }
        if (/DELETE FROM fg_facturacion WHERE/.test(sql)) {
            const antes = this.facturaciones.size;
            (params[0] || []).forEach((id) => this.facturaciones.delete(Number(id)));
            return { rowCount: antes - this.facturaciones.size, rows: [] };
        }
        if (/DELETE FROM fg_pago/.test(sql)) {
            const antes = this.pagos.size;
            (params[0] || []).forEach((id) => this.pagos.delete(Number(id)));
            return { rowCount: antes - this.pagos.size, rows: [] };
        }
        if (/DELETE FROM fg_orden_pago WHERE/.test(sql)) {
            const antes = this.ordenes.size;
            (params[0] || []).forEach((id) => this.ordenes.delete(Number(id)));
            return { rowCount: antes - this.ordenes.size, rows: [] };
        }
        if (/DELETE FROM fg_certificado WHERE/.test(sql)) {
            const antes = this.certificados.size;
            (params[0] || []).forEach((id) => this.certificados.delete(Number(id)));
            return { rowCount: antes - this.certificados.size, rows: [] };
        }
        if (/DELETE FROM fg_operacion_detalle WHERE/.test(sql)) {
            const antes = this.detalles.size;
            (params[0] || []).forEach((id) => this.detalles.delete(Number(id)));
            return { rowCount: antes - this.detalles.size, rows: [] };
        }
        if (/DELETE FROM fg_operacion_comercial WHERE/.test(sql)) {
            const antes = this.operaciones.size;
            (params[0] || []).forEach((id) => this.operaciones.delete(Number(id)));
            return { rowCount: antes - this.operaciones.size, rows: [] };
        }
        if (/^SELECT descuento_cliente_id/.test(sql)) return vacio;
        return vacio;
    }

    release() {}
}

const impactoConComprobante = (estado = 'ACEPTADO', entorno = 'DEMO') => ({
    operacionesMixtas: [{ id: 187, detalles: [{ id: 115 }] }],
    certificadosMixtos: [{ id: 302 }],
    certificadosAEliminar: [302],
    facturaciones: [{
        id: 900,
        operacion_id: 187,
        estado,
        nro_comprobante: 'F001-00000050',
        serie: 'F001',
        numero: 50,
        proveedor: 'NUBEFACT',
        entorno_facturador: entorno,
        aceptada_sunat: estado === 'ACEPTADO'
    }],
    ordenesPago: [{ id: 700, operacion_id: 187, certificado_id: 302 }],
    pagos: [{ id: 800, orden_pago_id: 700 }],
    otrosProductos: []
});

const conAmbiente = async (ambiente, fn) => {
    const originales = {
        permite: documentoTributarioPolicy.permiteLimpiezaLocalDeComprobantes,
        efectivo: documentoTributarioPolicy.entornoFacturacionEfectivo,
        esDemo: documentoTributarioPolicy.esDocumentoFacturacionDemoLocal
    };
    documentoTributarioPolicy.permiteLimpiezaLocalDeComprobantes = (environment) => (
        ambiente === 'PRODUCCION' ? false : originales.permite(environment)
    );
    documentoTributarioPolicy.entornoFacturacionEfectivo = () => ambiente;
    documentoTributarioPolicy.esDocumentoFacturacionDemoLocal = (documento, environment) => (
        ambiente === 'PRODUCCION' ? false : originales.esDemo(documento, environment)
    );
    try {
        return await fn();
    } finally {
        documentoTributarioPolicy.permiteLimpiezaLocalDeComprobantes = originales.permite;
        documentoTributarioPolicy.entornoFacturacionEfectivo = originales.efectivo;
        documentoTributarioPolicy.esDocumentoFacturacionDemoLocal = originales.esDemo;
    }
};

// ---------------------------------------------------------------------------
// Política de ambiente (fuente autoritativa: integrations.config)
// ---------------------------------------------------------------------------

test('el ambiente se toma de integrations.config, no de una variable inventada', () => {
    assert.equal(typeof integrationsConfig.nubefact.environment, 'string');
    assert.equal(
        documentoTributarioPolicy.entornoFacturacionEfectivo(),
        documentoTributarioPolicy.normalizarEntorno(integrationsConfig.nubefact.environment)
    );
    assert.equal(
        documentoTributarioPolicy.permiteLimpiezaLocalDeComprobantes(),
        documentoTributarioPolicy.normalizarEntorno(integrationsConfig.nubefact.environment) !== 'PRODUCCION'
    );
});

test('PRODUCCION nunca habilita la limpieza local', () => {
    assert.equal(documentoTributarioPolicy.esAmbienteFacturacionProduccion('PRODUCCION'), true);
    assert.equal(documentoTributarioPolicy.esAmbienteFacturacionProduccion('PRODUCTION'), true);
    assert.equal(documentoTributarioPolicy.permiteLimpiezaLocalDeComprobantes('PRODUCCION'), false);
    assert.equal(documentoTributarioPolicy.esDocumentoFacturacionDemoLocal({ entorno_facturador: 'DEMO' }, 'PRODUCCION'), false);
});

test('DEMO habilita la limpieza local', () => {
    assert.equal(documentoTributarioPolicy.permiteLimpiezaLocalDeComprobantes('DEMO'), true);
    assert.equal(documentoTributarioPolicy.esDocumentoFacturacionDemoLocal({ entorno_facturador: 'DEMO' }, 'DEMO'), true);
    assert.equal(documentoTributarioPolicy.esDocumentoFacturacionDemoLocal({ entorno_facturador: null }, 'DEMO'), true);
});

test('un documento marcado PRODUCCION no se borra ni en DEMO', () => {
    assert.equal(documentoTributarioPolicy.esDocumentoFacturacionDemoLocal({ entorno_facturador: 'PRODUCCION' }, 'DEMO'), false);
});

// ---------------------------------------------------------------------------
// DEMO: cleanup completo aunque haya comprobantes protegidos
// ---------------------------------------------------------------------------

test('DEMO: permite eliminar comprobantes ACEPTADO/PENDIENTE_SUNAT/ERROR/RECHAZADO del conjunto', async () => {
    for (const estado of ['ACEPTADO', 'PENDIENTE_SUNAT', 'ERROR', 'RECHAZADO', 'BORRADOR']) {
        const client = new FakeClienteLimpieza();
        const resumen = await conAmbiente('DEMO', () => productosImpactoService.eliminarOperacionesMixtas(
            client,
            impactoConComprobante(estado),
            { permitirComprobantesDemo: true }
        ));

        assert.equal(resumen.limpiezaLocalHabilitada, true, `ambiente mal detectado para ${estado}`);
        assert.equal(resumen.comprobantesLocalesEliminados, 1, `no se autorizó ${estado}`);
        assert.equal(resumen.facturacionesEliminadas, 1);
        assert.equal(resumen.operacionesEliminadas, 1);
        assert.equal(resumen.certificadosEliminados, 1);
        assert.equal(client.facturaciones.size, 0, `quedó la facturación ${estado}`);
    }
});

// ---------------------------------------------------------------------------
// PRODUCCIÓN: el bloqueo se mantiene
// ---------------------------------------------------------------------------

test('PRODUCCION: el hard delete de comprobantes emitidos queda bloqueado', async () => {
    const client = new FakeClienteLimpieza();
    await assert.rejects(
        () => conAmbiente('PRODUCCION', () => productosImpactoService.eliminarOperacionesMixtas(
            client,
            impactoConComprobante('ACEPTADO'),
            { permitirComprobantesDemo: true }
        )),
        (error) => error.message === 'FACTURACION_PROTEGIDA' && error.detalles.ambiente === 'PRODUCCION'
    );

    assert.equal(client.facturaciones.size, 1);
    assert.equal(client.operaciones.size, 1);
    assert.equal(client.certificados.size, 1);
    assert.deepEqual(client.escrituras, [], 'no debe escribir nada antes de bloquear');
});

test('PRODUCCION: la opción interna permitirComprobantesDemo no anula el bloqueo', async () => {
    const client = new FakeClienteLimpieza();
    await assert.rejects(
        () => conAmbiente('PRODUCCION', () => productosImpactoService.eliminarOperacionesMixtas(
            client,
            impactoConComprobante('PENDIENTE_SUNAT'),
            { permitirComprobantesDemo: true, ambiente: 'DEMO' }
        )),
        (error) => error.message === 'FACTURACION_PROTEGIDA'
    );
    assert.equal(client.facturaciones.size, 1);
});

test('DEMO: un comprobante individual marcado PRODUCCION sigue bloqueando', async () => {
    const client = new FakeClienteLimpieza();
    await assert.rejects(
        () => conAmbiente('DEMO', () => productosImpactoService.eliminarOperacionesMixtas(
            client,
            impactoConComprobante('ACEPTADO', 'PRODUCCION'),
            { permitirComprobantesDemo: true }
        )),
        (error) => error.message === 'FACTURACION_PROTEGIDA'
    );
    assert.equal(client.facturaciones.size, 1);
});

// ---------------------------------------------------------------------------
// Sin regresión del flujo de productos fiscales
// ---------------------------------------------------------------------------

test('el flujo de productos NO habilita limpieza local aunque pida la categoría', async () => {
    const client = new FakeClienteLimpieza();
    await assert.rejects(
        () => conAmbiente('DEMO', () => productosImpactoService.eliminarOperacionesMixtas(
            client,
            impactoConComprobante('ACEPTADO')
        )),
        (error) => error.message === 'FACTURACION_PROTEGIDA'
    );
    assert.equal(client.facturaciones.size, 1);
});

test('una facturación sin protección se elimina igual en cualquier ambiente', async () => {
    const client = new FakeClienteLimpieza();
    const impacto = impactoConComprobante('BORRADOR');
    impacto.facturaciones = [{
        id: 900,
        operacion_id: 187,
        estado: 'BORRADOR',
        nro_comprobante: null,
        serie: null,
        numero: null,
        proveedor: 'NUBEFACT',
        entorno_facturador: 'DEMO',
        aceptada_sunat: false
    }];
    const resumen = await conAmbiente('PRODUCCION', () => productosImpactoService.eliminarOperacionesMixtas(
        client,
        impacto,
        { permitirComprobantesDemo: true }
    ));
    assert.equal(resumen.facturacionesEliminadas, 1);
    assert.equal(resumen.comprobantesLocalesEliminados, 0);
});

// ---------------------------------------------------------------------------
// La limpieza es local: no toca Nubefact, SUNAT, series ni correlativos
// ---------------------------------------------------------------------------

test('la limpieza de categorías y productos es puramente local', () => {
    for (const archivo of [
        '../services/faregas-categorias-impacto.service',
        '../services/faregas-productos-impacto.service'
    ]) {
        const fuente = fs.readFileSync(require.resolve(archivo), 'utf8');
        assert.doesNotMatch(fuente, /nubefact\.(enviar|emitir|anular|anularComprobante|crearComprobante)/i, archivo);
        assert.doesNotMatch(fuente, /require\(.*faregas-nubefact/i, archivo);
        assert.doesNotMatch(fuente, /axios|fetch\(|https?:\/\//i, archivo);
        assert.doesNotMatch(fuente, /fg_correlativo_certificado/, archivo);
        assert.doesNotMatch(fuente, /fg_serie_comprobante/, archivo);
        assert.doesNotMatch(fuente, /nro_actual\s*=|ultimo_numero\s*=/, archivo);
    }
});

test('la categoría pide la limpieza local al helper y la política la modula', () => {
    const fuente = fs.readFileSync(
        require.resolve('../services/faregas-categorias-impacto.service'),
        'utf8'
    );
    assert.match(fuente, /eliminarOperacionesMixtas\(client, limpiezaOperaciones, \{/);
    assert.match(fuente, /permitirComprobantesDemo: true/);
    assert.match(fuente, /evaluarComprobantes/);
    assert.match(fuente, /facturacionesBloqueantes/);
    assert.equal(typeof categoriasImpactoService.eliminarServiciosYDependencias, 'function');
});
