const test = require('node:test');
const assert = require('node:assert');
const db = require('../../../config/database');
const facturacionService = require('../services/faregas-facturacion.service');
const nubefactConfigService = require('../services/faregas-nubefact-config.service');

// We override the DB pool for the test since we can't use proxyquire
let originalDbQuery;
let originalDbConnect;
const resumenTributarioService = require('../services/faregas-resumen-tributario.service');
const correlativosService = require('../services/faregas-correlativos-nubefact.service');
const facturacionRules = require('../services/faregas-facturacion.rules');

test('Facturacion Service - NubeFact funcional', async (t) => {
    t.beforeEach(() => {
        const integrationsConfig = require('../../../config/integrations.config');
        if (integrationsConfig.nubefact) {
            integrationsConfig.nubefact.enabled = true;
        }
        originalDbQuery = db.query;
        originalDbConnect = db.connect;
        
        const nubefactServiceReal = require('../../../services/integrations/nubefact.service');
        t.mock.method(nubefactServiceReal, 'obtenerEstadoConfiguracion', () => ({ enabled: true, environment: 'DEMO' }));

        t.mock.method(nubefactConfigService, 'resolverParaPlanta', async () => {
            return { environment: 'DEMO', credentials: {}, rucEmisor: '123' };
        });
        
        t.mock.method(resumenTributarioService, 'obtenerResumenTributarioPorOperacion', async () => {
            return { estado: 'LISTO', detalles: [] };
        });
        
        t.mock.method(resumenTributarioService, 'construirDetallesNubefact', () => {
            return [];
        });
        
        t.mock.method(correlativosService, 'reservarSiguiente', async () => {
            return { serie: 'F001', numero: 2, nroComprobante: 'F001-2', id: 10 };
        });

        t.mock.method(facturacionRules, 'validarFacturacionNubefact', () => {
            return [];
        });
    });

    t.afterEach(() => {
        db.query = originalDbQuery;
        db.connect = originalDbConnect;
    });

    await t.test('Documento aceptado no vuelve a invocar al proveedor', async (t) => {
        // Mock reserving finding already accepted
        const mockClient = {
            query: t.mock.fn(async (q, args) => {
                if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return;
                if (q.includes('fg_operacion_detalle')) {
                    return { rowCount: 1, rows: [{ codigo_sunat_snapshot: '12345678' }] };
                }
                if (q.includes('fg_operacion_comercial')) {
                    return { rowCount: 1, rows: [{ id: 1, planta_key: 'TEST' }] };
                }
                if (q.includes('SELECT * FROM fg_facturacion WHERE operacion_id = $1')) {
                    return { rowCount: 1, rows: [{ 
                        id: 1, estado: 'ACEPTADO', serie: 'F001', numero: 1, 
                        tipo_comprobante: 'FACTURA',
                        condicion_pago: 'CONTADO',
                        moneda: 'PEN',
                        tipo_documento: '6',
                        nro_documento: '20100070970',
                        nombre_razon_social: 'TEST CLIENT',
                        direccion: 'TEST DIR',
                        total_gravadas: 100,
                        total_igv: 18,
                        total: 118,
                        medio_pago: 'EFECTIVO' 
                    }] };
                }
                return { rowCount: 1, rows: [{ id: 1 }] };
            }),
            release: t.mock.fn()
        };
        db.connect = t.mock.fn(async () => mockClient);
        
        db.query = t.mock.fn(async (query, args) => {
            if (query.includes('fg_operacion_comercial')) {
                return { rowCount: 1, rows: [{ id: 1, planta_key: 'TEST' }] };
            }
            if (query.includes('fg_operacion_detalle')) {
                return { rowCount: 1, rows: [{ codigo_sunat_snapshot: '12345678' }] };
            }
            if (query.includes('fg_facturacion_intento')) {
                return { rowCount: 1, rows: [{ id: 1 }] };
            }
            if (query.includes('FROM fg_facturacion')) {
                return { rowCount: 1, rows: [{ 
                    id: 1, estado: 'ACEPTADO', serie: 'F001', numero: 1, 
                    tipo_comprobante: 'FACTURA',
                    condicion_pago: 'CONTADO',
                    moneda: 'PEN',
                    tipo_documento: '6',
                    nro_documento: '20100070970',
                    nombre_razon_social: 'TEST CLIENT',
                    direccion: 'TEST DIR',
                    total_gravadas: 100,
                    total_igv: 18,
                    total: 118,
                    medio_pago: 'EFECTIVO' 
                }] };
            }
            if (query.includes('fg_orden_pago')) {
                return { rowCount: 1, rows: [{ id: 1, estado: 'PAGADO', saldo_pendiente: 0 }] };
            }
            if (query.includes('fg_pago')) {
                return { rowCount: 1, rows: [{ tipocontado_key: 'EFECTIVO' }] };
            }
            if (query.includes('fg_facturacion_cuota')) {
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 0, rows: [] };
        });

        const deps = {
            nubefactService: {
                emitirComprobante: t.mock.fn(async () => { throw new Error('No debio invocar proveedor'); })
            }
        };

        let result;
        try {
            result = await facturacionService.emitirFacturacionOperacion(1, { username: 'test' }, deps);
        } catch (e) {
            console.error('ERROR DETAILS:', e.detalles);
            throw e;
        }
        
        assert.strictEqual(deps.nubefactService.emitirComprobante.mock.callCount(), 0);
        assert.strictEqual(result.estado, 'ACEPTADO');
    });

    await t.test('Flujo completo emite, usa proveedor 1 vez y persiste ACEPTADO en nueva transaccion', async (t) => {
        let beginCount = 0;
        let commitCount = 0;
        const mockClient = {
            query: t.mock.fn(async (q, args) => {
                if (q === 'BEGIN') beginCount++;
                if (q === 'COMMIT') commitCount++;
                if (q.includes('RETURNING *')) {
                    return { rowCount: 1, rows: [{ id: 1, estado: 'PENDIENTE', serie: 'F001', numero: 2, tipo_comprobante: 'FACTURA', intentos: 1 }] };
                }
                if (q.includes('RETURNING id')) {
                    return { rowCount: 1, rows: [{ id: 100 }] }; // IntentoId
                }
                if (q.includes('UPDATE fg_facturacion SET')) {
                    assert.strictEqual(beginCount, 2, 'El update de persistencia debe estar en la segunda transaccion');
                }
                if (q.includes('fg_operacion_detalle')) {
                    return { rowCount: 1, rows: [{ codigo_sunat_snapshot: '12345678' }] };
                }
                if (q.includes('fg_operacion_comercial')) {
                    return { rowCount: 1, rows: [{ id: 1, planta_key: 'TEST' }] };
                }
                if (q.includes('SELECT * FROM fg_facturacion WHERE operacion_id = $1 AND certificado_id IS NULL FOR UPDATE')) {
                    return { rowCount: 1, rows: [{ 
                        id: 1, estado: 'PENDIENTE', serie: 'F001', numero: 2, 
                        tipo_comprobante: 'FACTURA',
                        condicion_pago: 'CONTADO',
                        moneda: 'PEN',
                        tipo_documento: '6',
                        nro_documento: '20100070970',
                        nombre_razon_social: 'TEST CLIENT',
                        direccion: 'TEST DIR',
                        total_gravadas: 100,
                        total_igv: 18,
                        total: 118,
                        medio_pago: 'EFECTIVO'
                    }] };
                }
                return { rowCount: 1, rows: [{ id: 1 }] };
            }),
            release: t.mock.fn()
        };
        db.connect = t.mock.fn(async () => mockClient);
        
        db.query = t.mock.fn(async (query, args) => {
            if (query.includes('fg_operacion_comercial')) {
                return { rowCount: 1, rows: [{ id: 1, planta_key: 'TEST' }] };
            }
            if (query.includes('SELECT * FROM fg_facturacion WHERE')) {
                if (query.includes('id = $1')) {
                    // Result at the very end
                    return { rowCount: 1, rows: [{ id: 1, estado: 'ACEPTADO', serie: 'F001', numero: 2, tipo_comprobante: 'FACTURA', enlace_pdf: 'test.pdf' }] };
                }
                // Initial check for existing document
                return { rowCount: 1, rows: [{ 
                    id: 1, estado: 'PENDIENTE_SUNAT', serie: 'F001', numero: 2, 
                    tipo_comprobante: 'FACTURA',
                    condicion_pago: 'CONTADO',
                    moneda: 'PEN',
                    tipo_documento: '6',
                    nro_documento: '20100070970',
                    nombre_razon_social: 'TEST CLIENT',
                    direccion: 'TEST DIR',
                    total_gravadas: 100,
                    total_igv: 18,
                    total: 118,
                    medio_pago: 'EFECTIVO'
                }] };
            }
            if (query.includes('fg_operacion_detalle')) {
                return { rowCount: 1, rows: [{ codigo_sunat_snapshot: '12345678' }] };
            }
            if (query.includes('fg_orden_pago')) {
                return { rowCount: 1, rows: [{ id: 1, estado: 'PAGADO', saldo_pendiente: 0 }] };
            }
            if (query.includes('fg_pago')) {
                return { rowCount: 1, rows: [{ tipocontado_key: 'EFECTIVO' }] };
            }
            if (query.includes('fg_facturacion_cuota')) {
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 0, rows: [] };
        });

        const deps = {
            nubefactService: {
                emitirComprobante: t.mock.fn(async () => {
                    assert.strictEqual(commitCount, 1, 'Proveedor invocado despues de confirmar reserva (COMMIT 1)');
                    return { status: 'ACCEPTED', data: { enlace_del_pdf: 'test.pdf', sunat_description: 'Exito' } };
                }),
                consultarComprobante: t.mock.fn(async () => {
                    return { status: 'ACCEPTED', data: {} };
                })
            }
        };

        let result;
        try {
            result = await facturacionService.emitirFacturacionOperacion(1, { username: 'test' }, deps);
        } catch (e) {
            console.error('ERROR DETAILS:', e.detalles);
            throw e;
        }
        
        assert.strictEqual(deps.nubefactService.emitirComprobante.mock.callCount(), 1, 'Proveedor invocado exactamente una vez');
        assert.strictEqual(beginCount, 2, 'Utiliza transaccion distinta (2 BEGINs)');
        assert.strictEqual(commitCount, 2, 'Utiliza transaccion distinta (2 COMMITs)');
        assert.strictEqual(result.estado, 'ACEPTADO');
        
        const updateCall = mockClient.query.mock.calls.find(c => c.arguments[0] && c.arguments[0].includes('UPDATE fg_facturacion SET') && c.arguments[0].includes('sunat_description'));
        if (!updateCall) {
            console.log('--- ALL CALLS ---');
            mockClient.query.mock.calls.forEach((c, i) => console.log(i, typeof c.arguments[0], c.arguments[0]));
        }
        assert.ok(updateCall, 'Debe haber un UPDATE a fg_facturacion con estado=$1');
        assert.strictEqual(updateCall.arguments[1][0], 'ACEPTADO', 'Estado persistido es ACEPTADO');
        assert.strictEqual(updateCall.arguments[1][5], 'test.pdf', 'Enlace PDF extraído correctamente');
    });
});
