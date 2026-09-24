const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const facturacionService = require('../services/faregas-facturacion.service');
const nubefactService = require('../../../services/integrations/nubefact.service');
const nubefactConfigService = require('../services/faregas-nubefact-config.service');
const resumenService = require('../services/faregas-resumen-tributario.service');
const correlativosService = require('../services/faregas-correlativos-nubefact.service');

const user = { username: 'USUARIO_REINTENTO' };

test('reintenta una operación rechazada conservando serie, número y codigo_unico', async () => {
    const originales = {
        connect: db.connect,
        query: db.query,
        acceso: authService.validarAccesoPlanta,
        estado: nubefactService.obtenerEstadoConfiguracion,
        resolver: nubefactConfigService.resolverParaPlanta,
        resumen: resumenService.obtenerResumenTributarioPorOperacion,
        detalles: resumenService.construirDetallesNubefact,
        correlativo: correlativosService.reservarSiguiente
    };
    const facturacion = {
        id: 256, operacion_id: 216, certificado_id: null, estado: 'RECHAZADO',
        tipo_comprobante: 'BOLETA', tipo_documento_cliente: 'DNI', nro_documento: '74045612',
        nombre_razon_social: 'DDDSD', direccion: 'DSSDSDDS', email: null, telefono: null,
        moneda_key: 'sol', base_imponible: 152.54, igv: 27.46, importe_total: 180,
        condicion_pago: 'CONTADO', fecha_vencimiento: null, medio_pago: 'EFECTIVO',
        serie: 'BBB1', numero: 50, nro_comprobante: 'BBB1-00000050', intentos: 1,
        codigo_unico: 'FG-256', estado_actual: 'RECHAZADO'
    };
    let reservas = 0;
    let payloadEnviado = null;
    let updatePendiente = null;

    const client = {
        async query(sql) {
            const text = String(sql).replace(/\s+/g, ' ').trim().toUpperCase();
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rowCount: 0, rows: [] };
            if (text.includes('FROM FG_OPERACION_COMERCIAL')) {
                return { rowCount: 1, rows: [{ id: 216, planta_key: '201', estado: 'PAGADO' }] };
            }
            if (text.includes('FROM FG_OPERACION_DETALLE')) {
                return { rowCount: 1, rows: [{ codigo_sunat_snapshot: null }] };
            }
            if (text.includes('FROM FG_FACTURACION WHERE OPERACION_ID = $1 AND CERTIFICADO_ID IS NULL FOR UPDATE')) {
                return { rowCount: 1, rows: [facturacion] };
            }
            if (text.startsWith('UPDATE FG_FACTURACION SET')) {
                updatePendiente = { sql: text };
                return { rowCount: 1, rows: [{ ...facturacion, estado: 'PENDIENTE', intentos: 2 }] };
            }
            if (text.startsWith('INSERT INTO FG_FACTURACION_INTENTO')) {
                return { rowCount: 1, rows: [{ id: 6000 }] };
            }
            if (text.startsWith('UPDATE FG_FACTURACION_INTENTO SET')) {
                return { rowCount: 1, rows: [{ id: 6000 }] };
            }
            if (text.startsWith('UPDATE FG_OPERACION_COMERCIAL SET')) {
                return { rowCount: 1, rows: [{ id: 216, estado: 'FACTURADO' }] };
            }
            return { rowCount: 0, rows: [] };
        },
        release() {}
    };

    try {
        db.connect = async () => client;
        db.query = async (sql) => {
            if (sql.includes('SELECT * FROM fg_facturacion WHERE id = $1')) {
                return { rowCount: 1, rows: [{ ...facturacion, estado: 'ACEPTADO', intentos: 2, enlace_pdf: 'https://demo.test/document.pdf' }] };
            }
            if (sql.includes('FROM fg_facturacion_cuota')) return { rowCount: 0, rows: [] };
            throw new Error(`Consulta final inesperada: ${sql}`);
        };
        authService.validarAccesoPlanta = async () => ({ key: '201', nombre: 'INDEPENDENCIA' });
        nubefactService.obtenerEstadoConfiguracion = () => ({ enabled: true, environment: 'DEMO' });
        nubefactConfigService.resolverParaPlanta = async () => ({
            environment: 'DEMO', empresaKey: 'CAMBRIDGE', rucEmisor: '20600444531',
            credentials: { apiUrl: 'https://demo.test', token: 'test-token', rucEmisor: '20600444531' }
        });
        resumenService.obtenerResumenTributarioPorOperacion = async () => ({
            estado: 'LISTO', items: [], resumenTotales: {}
        });
        resumenService.construirDetallesNubefact = () => [{
            unidad_snapshot: 'NIU', codigo_sku_snapshot: 'CHIP', descripcion_snapshot: 'CHIP',
            cantidad: 1, valor_unitario: 152.54, precio_unitario: 180,
            base_imponible: 152.54, afectacion_igv_snapshot: '10', igv: 27.46,
            importe_total: 180
        }];
        correlativosService.reservarSiguiente = async () => {
            reservas += 1;
            throw new Error('No debe reservar un correlativo durante el reintento');
        };

        const provider = {
            async emitirComprobante(payload) {
                payloadEnviado = payload;
                return { status: 'ACCEPTED', data: { enlace_del_pdf: 'https://demo.test/document.pdf' } };
            }
        };
        const result = await facturacionService.reintentarFacturacionOperacion(216, user, {
            nubefactService: provider
        });

        assert.equal(reservas, 0);
        assert.equal(result.id, 256);
        assert.equal(result.estado, 'ACEPTADO');
        assert.equal(payloadEnviado.serie, 'BBB1');
        assert.equal(payloadEnviado.numero, 50);
        assert.equal(payloadEnviado.codigo_unico, 'FG-256');
        assert.equal(payloadEnviado.total, 180);
        assert.ok(updatePendiente);
    } finally {
        db.connect = originales.connect;
        db.query = originales.query;
        authService.validarAccesoPlanta = originales.acceso;
        nubefactService.obtenerEstadoConfiguracion = originales.estado;
        nubefactConfigService.resolverParaPlanta = originales.resolver;
        resumenService.obtenerResumenTributarioPorOperacion = originales.resumen;
        resumenService.construirDetallesNubefact = originales.detalles;
        correlativosService.reservarSiguiente = originales.correlativo;
    }
});
