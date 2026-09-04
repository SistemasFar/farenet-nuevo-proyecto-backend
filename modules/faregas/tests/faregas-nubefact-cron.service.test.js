const test = require('node:test');
const assert = require('node:assert');
const { reconciliarPendientesSunat } = require('../services/faregas-nubefact-cron.service');
const db = require('../../../config/database');
const nubefactService = require('../../../services/integrations/nubefact.service');
const nubefactConfigService = require('../services/faregas-nubefact-config.service');
const integrationsConfig = require('../../../config/integrations.config');

const originalQuery = db.query;
const originalConnect = db.connect;
const originalConsultar = nubefactService.consultarComprobante;
const originalResolver = nubefactConfigService.resolverParaPlanta;
const originalEnv = integrationsConfig.nubefact.environment;

test('faregas-nubefact-cron.service', async (t) => {
    t.beforeEach(() => {
        integrationsConfig.nubefact.environment = 'DEMO';
        db.connect = async () => ({
            query: async () => ({ rows: [], rowCount: 0 }),
            release: () => {}
        });
        nubefactService.consultarComprobante = async () => ({ status: 'ACCEPTED', data: {} });
        nubefactConfigService.resolverParaPlanta = async () => ({ credentials: { ambiente: 'DEMO' }, environment: 'DEMO' });
    });

    t.afterEach(() => {
        db.query = originalQuery;
        db.connect = originalConnect;
        nubefactService.consultarComprobante = originalConsultar;
        nubefactConfigService.resolverParaPlanta = originalResolver;
        integrationsConfig.nubefact.environment = originalEnv;
    });

    await t.test('1. Entorno invalido retorna 0 inmediatamente', async () => {
        integrationsConfig.nubefact.environment = 'LOCAL';
        const res = await reconciliarPendientesSunat();
        assert.deepStrictEqual(res, { procesados: 0, aceptados: 0, rechazados: 0 });
    });

    await t.test('2. Entorno vacio retorna 0 inmediatamente', async () => {
        integrationsConfig.nubefact.environment = '';
        const res = await reconciliarPendientesSunat();
        assert.deepStrictEqual(res, { procesados: 0, aceptados: 0, rechazados: 0 });
    });

    await t.test('3. Documentos ya reclamados son ignorados (simulado por DB mock)', async () => {
        const res = await reconciliarPendientesSunat();
        assert.deepStrictEqual(res, { procesados: 0, aceptados: 0, rechazados: 0 });
    });

    await t.test('4. Procesa y acepta documentos (mock completo)', async () => {
        let updateComercialLlamado = false;
        let queryParamsGuardados = null;

        db.connect = async () => ({
            query: async (query, params) => {
                if (query.includes('SELECT f.id')) {
                    return {
                        rowCount: 1,
                        rows: [{
                            facturacion_id: 1,
                            certificado_id: 1,
                            estado: 'PENDIENTE_SUNAT',
                            serie: 'F001',
                            numero: 123,
                            tipo_comprobante: 'FACTURA',
                            operacion_id: 100,
                            planta_key: 'PLANTA1'
                        }]
                    };
                }
                if (query.includes('UPDATE fg_facturacion') && query.includes('ACEPTADO')) {
                    queryParamsGuardados = params;
                }
                if (query.includes('UPDATE fg_operacion_comercial')) {
                    updateComercialLlamado = true;
                }
                return { rowCount: 1, rows: [] };
            },
            release: () => {}
        });

        nubefactService.consultarComprobante = async () => ({
            status: 'ACCEPTED',
            data: {
                sunat_ticket_numero: 'TICKET123',
                enlace_del_pdf: 'http://pdf',
                enlace_del_xml: 'http://xml',
                enlace_del_cdr: 'http://cdr',
                cadena_para_codigo_qr: 'QR123',
                codigo_hash: 'HASH123',
                sunat_responsecode: '0',
                sunat_description: 'Aceptado'
            }
        });

        const res = await reconciliarPendientesSunat();
        assert.deepStrictEqual(res, { procesados: 1, aceptados: 1, rechazados: 0 });
        assert.ok(updateComercialLlamado, 'Actualiza operacion comercial');
        assert.ok(queryParamsGuardados, 'Ejecutó UPDATE de facturacion');
        assert.strictEqual(queryParamsGuardados[1], 'TICKET123', 'Ticket mapeado');
    });

    await t.test('5. Procesa y rechaza documentos', async () => {
        db.connect = async () => ({
            query: async (query, params) => {
                if (query.includes('SELECT f.id')) {
                    return {
                        rowCount: 1,
                        rows: [{
                            facturacion_id: 2,
                            certificado_id: 2,
                            estado: 'PENDIENTE_SUNAT',
                            serie: 'B001',
                            numero: 456,
                            tipo_comprobante: 'BOLETA',
                            operacion_id: null,
                            planta_key: 'PLANTA1'
                        }]
                    };
                }
                return { rowCount: 1, rows: [] };
            },
            release: () => {}
        });

        nubefactService.consultarComprobante = async () => ({
            status: 'REJECTED',
            data: {
                sunat_description: 'El ruc no existe',
                sunat_responsecode: '1033',
                errors: 'Rechazo fatal'
            }
        });

        const res = await reconciliarPendientesSunat();
        assert.deepStrictEqual(res, { procesados: 1, aceptados: 0, rechazados: 1 });
    });

    await t.test('6. Error de red (timeout) se ignora gracefully', async () => {
        db.connect = async () => ({
            query: async (query, params) => {
                if (query.includes('SELECT f.id')) {
                    return {
                        rowCount: 1,
                        rows: [{ facturacion_id: 3, serie: 'F001', numero: 1, tipo_comprobante: 'FACTURA', planta_key: 'P1' }]
                    };
                }
                return { rowCount: 1, rows: [] };
            },
            release: () => {}
        });

        nubefactService.consultarComprobante = async () => {
            throw new Error('ETIMEDOUT');
        };

        const res = await reconciliarPendientesSunat();
        assert.deepStrictEqual(res, { procesados: 1, aceptados: 0, rechazados: 0 });
    });
});
