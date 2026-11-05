const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const auth = require('../services/faregas-auth.service');
const controller = require('../controllers/faregas-dashboard.controller');
const consolidado = require('../services/faregas-reporte-financiero.service');
const extendido = require('../services/faregas-documentos-emitidos-extendido.service');
const mensual = require('../services/faregas-resumen-mensual-facturacion.service');
const tributario = require('../services/faregas-registro-ventas-tributario.service');

test('los cuatro endpoints responden 200 en alcance GLOBAL y pasan la lista autorizada completa', async () => {
    const originalQuery = db.query;
    const originalPlantas = auth.getPlantasPorUsuario;
    const serviceMethods = [
        [consolidado, 'obtenerReporteFinanciero', controller.obtenerReporteFinanciero, { operaciones: [], lineas: [], ventasDirectas: [], comprobantes: [], ordenes: [], pagos: [], descuentos: [], ajustes: [] }],
        [extendido, 'obtenerDocumentosEmitidosExtendido', controller.obtenerDocumentosEmitidosExtendido, { cabeceras: [], lineas: [] }],
        [mensual, 'obtenerResumenMensualFacturacion', controller.obtenerResumenMensualFacturacion, { cabeceras: [], metadatos: { empresasEmisoras: [], rucEmisores: [] } }],
        [tributario, 'obtenerRegistroVentasTributario', controller.obtenerRegistroVentasTributario, { documentos: [] }]
    ];
    const originals = serviceMethods.map(([service, key]) => service[key]);
    const authorizedPlants = [{ key: '98' }, { key: '201' }];
    try {
        db.query = async (sql) => sql.includes('SELECT permiso_clave FROM fg_perfil_permiso')
            ? { rows: [{ permiso_clave: 'DASHBOARD_GLOBAL' }] }
            : { rowCount: 1, rows: [{}] };
        auth.getPlantasPorUsuario = async () => authorizedPlants;
        const received = [];
        serviceMethods.forEach(([service, key], index) => {
            service[key] = async (args) => { received[index] = args; return serviceMethods[index][3]; };
        });

        for (const [, , handler] of serviceMethods) {
            const res = {
                statusCode: 0,
                status(code) { this.statusCode = code; return this; },
                json(body) { this.body = body; return this; }
            };
            await handler({
                user: { username: 'test', perfil_id: 'SISTEMAS', planta_key: '98' },
                query: { alcance: 'GLOBAL', desde: '2026-11-01', hasta: '2026-11-30' }
            }, res);
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.success, true);
        }

        assert.equal(received.length, 4);
        for (const args of received) {
            assert.deepEqual(args.plantasAutorizadas, ['98', '201']);
            assert.equal(args.plantasFiltro, null);
            assert.equal(args.desde, '2026-11-01');
            assert.equal(args.hasta, '2026-11-30');
        }
    } finally {
        db.query = originalQuery;
        auth.getPlantasPorUsuario = originalPlantas;
        serviceMethods.forEach(([service, key], index) => { service[key] = originals[index]; });
    }
});
