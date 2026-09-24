const test = require('node:test');
const assert = require('node:assert/strict');
const fase2Service = require('../services/faregas-venta-directa-fase2.service');

const usuario = { username: 'USUARIO_FASE2', perfil_id: 'SISTEMAS', planta_key: '201' };
const snapshot = {
    id: 50,
    planta_key: '201',
    estado: 'PAGADO',
    tipo_documento_cliente_snapshot: 'DNI',
    documento_cliente_snapshot: '12345678',
    nombre_cliente_snapshot: 'CLIENTE CANONICO',
    direccion_cliente_snapshot: 'DIRECCION CANONICA'
};

const crearDependencias = ({ estadoFacturacion = 'ACEPTADO', error = null } = {}) => {
    const state = { ventaCalls: 0, guardCalls: [], emitCalls: [], invoiceCreates: 0 };
    const ventaDirectaService = {
        crearVentaDirecta: async () => {
            state.ventaCalls += 1;
            return {
                operacionId: 50,
                ordenPagoId: 70,
                detalles: [{ chipId: 1, numeroChip: 'CHIP-A' }],
                estado: 'PAGADO'
            };
        }
    };
    const database = {
        query: async (sql, params) => {
            if (sql.includes('FROM fg_operacion_comercial')) return { rowCount: 1, rows: [snapshot] };
            throw new Error(`Consulta inesperada: ${sql}`);
        }
    };
    const facturacionService = {
        evaluarDatosFacturacion: (data) => ({ datos: data, errores: [] }),
        guardarFacturacionOperacion: async (operacionId, data) => {
            state.guardCalls.push({ operacionId, data });
            if (state.invoiceCreates === 0) state.invoiceCreates += 1;
            return {
                id: 90,
                certificadoId: null,
                operacionId,
                estado: 'BORRADOR',
                tipoComprobante: data.tipoComprobante,
                nroDocumento: data.nroDocumento,
                nombreRazonSocial: data.nombreRazonSocial,
                direccion: data.direccion
            };
        },
        emitirFacturacionOperacion: async (operacionId) => {
            state.emitCalls.push(operacionId);
            if (error) throw error;
            return {
                id: 90,
                certificadoId: null,
                operacionId,
                estado: estadoFacturacion,
                nroComprobante: 'BBB1-00000001',
                serie: 'BBB1',
                numero: 1,
                sunatDescription: estadoFacturacion === 'REJECTED' ? 'Documento rechazado' : null
            };
        }
    };
    return { state, dependencies: { ventaDirectaService, db: database, facturacionService } };
};

const payload = (tipo = 'BOLETA') => ({
    tipoComprobante: tipo,
    tipoDocumentoCliente: 'DNI',
    nroDocumento: tipo === 'FACTURA' ? '20600444531' : '99999999',
    nombreRazonSocial: 'DATO NO CONFIABLE DEL FRONTEND',
    direccion: 'DIRECCION NO CONFIABLE',
    condicionPago: 'CONTADO',
    pagosAgregados: [{ tipo: 'EFECTIVO', importe: '10.00' }],
    chips: ['CHIP-A']
});

test('Fase 2 rechaza datos fiscales inválidos antes de vender el chip', async () => {
    const { state, dependencies } = crearDependencias();
    dependencies.facturacionService.evaluarDatosFacturacion = () => ({
        datos: {},
        errores: ['El documento debe contener 8 digitos (DNI) u 11 digitos (RUC).']
    });

    await assert.rejects(
        fase2Service.crearVentaDirectaYEmitir({ ...payload(), nroDocumento: '332332' }, usuario, dependencies),
        error => error.code === 'DATOS_FACTURACION_INVALIDOS'
            && error.detalles[0].includes('8 digitos')
    );
    assert.equal(state.ventaCalls, 0);
    assert.equal(state.guardCalls.length, 0);
    assert.equal(state.emitCalls.length, 0);
});

test('Fase 2 crea facturación de BOLETA usando el snapshot de la operación', async () => {
    const { state, dependencies } = crearDependencias();
    const result = await fase2Service.crearVentaDirectaYEmitir(payload('BOLETA'), usuario, dependencies);

    assert.equal(result.success, true);
    assert.equal(result.facturacionEstado, 'ACEPTADO');
    assert.equal(result.facturacion.certificadoId, null);
    assert.equal(result.facturacion.operacionId, 50);
    assert.equal(result.message.includes('BBB1-00000001'), true);
    assert.equal(state.guardCalls[0].operacionId, 50);
    assert.equal(state.guardCalls[0].data.tipoComprobante, 'BOLETA');
    assert.equal(state.guardCalls[0].data.nroDocumento, '12345678');
    assert.equal(state.guardCalls[0].data.nombreRazonSocial, 'CLIENTE CANONICO');
    assert.equal(state.guardCalls[0].data.direccion, 'DIRECCION CANONICA');
    assert.deepEqual(state.emitCalls, [50]);
});

test('Fase 2 crea facturación de FACTURA con la misma relación sin certificado', async () => {
    const { state, dependencies } = crearDependencias();
    const result = await fase2Service.crearVentaDirectaYEmitir(payload('FACTURA'), usuario, dependencies);

    assert.equal(result.success, true);
    assert.equal(result.facturacion.certificadoId, null);
    assert.equal(result.facturacion.operacionId, 50);
    assert.equal(state.guardCalls[0].data.tipoComprobante, 'FACTURA');
});

test('Fase 2 devuelve PENDIENTE_SUNAT sin cerrar la venta local', async () => {
    const { dependencies } = crearDependencias({ estadoFacturacion: 'PENDING_SUNAT' });
    const result = await fase2Service.crearVentaDirectaYEmitir(payload(), usuario, dependencies);

    assert.equal(result.success, true);
    assert.equal(result.operacionEstado, 'PAGADO');
    assert.equal(result.facturacionEstado, 'PENDING_SUNAT');
    assert.match(result.message, /pendiente/i);
});

test('Fase 2 conserva la venta local y devuelve el rechazo normalizado', async () => {
    const rejection = new Error('NUBEFACT_RECHAZADO');
    rejection.code = 'NUBEFACT_RECHAZADO';
    rejection.statusCode = 422;
    rejection.detalles = {
        facturacion: {
            id: 90,
            certificadoId: null,
            operacionId: 50,
            estado: 'RECHAZADO',
            nroComprobante: 'BBB1-00000001',
            sunatDescription: 'Datos rechazado por proveedor'
        }
    };
    const { dependencies } = crearDependencias({ error: rejection });
    const result = await fase2Service.crearVentaDirectaYEmitir(payload(), usuario, dependencies);

    assert.equal(result.success, false);
    assert.equal(result.operacionEstado, 'PAGADO');
    assert.equal(result.facturacionEstado, 'RECHAZADO');
    assert.equal(result.httpStatus, 422);
    assert.match(result.message, /rechazó/i);
    assert.equal(result.detalles.operacionId, 50);
    assert.equal(result.detalles.ventaRegistrada, true);
    assert.equal(result.facturacion.operacionId, 50);
});

test('Fase 2 no vuelve a vender chips al reintentar la misma operación', async () => {
    const { state, dependencies } = crearDependencias();
    await fase2Service.crearVentaDirectaYEmitir(payload(), usuario, dependencies);
    await fase2Service.crearVentaDirectaYEmitir(payload(), usuario, dependencies);

    assert.equal(state.invoiceCreates, 1);
    assert.deepEqual(state.emitCalls, [50, 50]);
});

test('Fase 2 no contiene uso del service legacy ni de series hardcodeadas', () => {
    const source = require('node:fs').readFileSync(
        require.resolve('../services/faregas-venta-directa-fase2.service.js'),
        'utf8'
    );
    assert.equal(source.includes('faregas-ventas.service'), false);
    assert.equal(source.includes('BE03'), false);
    assert.equal(source.includes('FFF1'), false);
    assert.equal(source.includes('fg_talonario_serie'), false);
});
