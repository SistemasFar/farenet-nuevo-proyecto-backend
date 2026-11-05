const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const { obtenerReporteFinanciero } = require('../services/faregas-reporte-financiero.service');

test('reporte financiero separa lecturas por relación y aplica el período/sede de Lima', async () => {
    const originalQuery = db.query;
    const calls = [];
    db.query = async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('FROM fg_planta')) return { rows: [{ planta_key: 'ATE', planta_nombre: 'Ate' }] };
        return { rows: [] };
    };
    try {
        const data = await obtenerReporteFinanciero({
            plantasAutorizadas: ['ATE', 'CAMACHO'], plantasFiltro: ['ATE'],
            desde: '2026-10-01', hasta: '2026-10-31', username: 'caja'
        });
        assert.equal(calls.length, 9);
        assert.ok(calls.every(({ params }) => params[0][0] === 'ATE'));
        assert.ok(calls.filter(({ params }) => params.length > 1).every(({ params }) => params[1] === '2026-10-01 00:00:00-05'));
        assert.ok(calls.filter(({ params }) => params.length > 1).every(({ params }) => params[2] === '2026-11-01 00:00:00-05'));
        assert.equal(data.metadatos.rucEmisor, '');
        assert.deepEqual(data.sedes, [{ planta_key: 'ATE', planta_nombre: 'Ate' }]);
        assert.equal(data.metadatos.plantas.join(','), 'ATE');
        const paymentRead = calls.find(({ sql }) => sql.includes('FROM fg_pago p JOIN fg_orden_pago'));
        assert.match(paymentRead.sql, /op\.id = p\.orden_pago_id/);
        assert.match(paymentRead.sql, /op\.certificado_id/);
        assert.doesNotMatch(paymentRead.sql, /JOIN fg_operacion_detalle/);
        const invoiceRead = calls.find(({ sql }) => sql.includes('FROM fg_facturacion f LEFT JOIN fg_operacion_comercial'));
        assert.match(invoiceRead.sql, /AS en_periodo_emision/);
        assert.match(invoiceRead.sql, /f\.fecha_documento IS NOT NULL/);
        assert.match(invoiceRead.sql, /f\.fecha_documento >= \$4::date/);
        assert.match(invoiceRead.sql, /f\.fecha_documento <= \$5::date/);
        assert.doesNotMatch(invoiceRead.sql, /COALESCE\(f\.fecha_documento::timestamp, f\.fecha_creacion\)/);
        assert.match(invoiceRead.sql, /OR \(oc\.fecha_creacion >= \$2::timestamptz/);
        assert.match(invoiceRead.sql, /OR \(v\.creado_en >= \$2::timestamptz/);
        const operationRead = calls.find(({ sql }) => sql.includes('FROM fg_operacion_comercial oc LEFT JOIN fg_planta'));
        assert.match(operationRead.sql, /AS comprobante_operable/);
        assert.match(operationRead.sql, /f\.aceptada_sunat IS TRUE/);
        assert.match(operationRead.sql, /f\.entorno_facturador/);
        const orderRead = calls.find(({ sql }) => sql.includes('FROM fg_orden_pago op'));
        assert.match(orderRead.sql, /AS en_periodo_orden/);
        assert.match(orderRead.sql, /LEFT JOIN fg_certificado cert ON cert\.id = op\.certificado_id/);
        assert.match(orderRead.sql, /cert\.planta_key = ANY\(\$1::varchar\[\]\)/);
        assert.match(orderRead.sql, /cert\.planta_key = ANY\(\$1::varchar\[\]\)\)\)\)\s+ORDER BY op\.id/);
        const adjustmentsRead = calls.find(({ sql }) => sql.includes("'NOTA DE CRÉDITO' AS tipo"));
        assert.match(adjustmentsRead.sql, /FROM fg_debito nd/);
        assert.match(adjustmentsRead.sql, /cr\.aceptada_sunat/);
        assert.match(adjustmentsRead.sql, /nd\.aceptada_sunat/);
        assert.match(adjustmentsRead.sql, /da\.estado/);
        assert.match(adjustmentsRead.sql, /da\.aceptada_sunat/);
        const lineRead = calls.find(({ sql }) => sql.includes('FROM fg_operacion_detalle od'));
        assert.doesNotMatch(lineRead.sql, /JOIN fg_pago/);
        const discountRead = calls.find(({ sql }) => sql.includes('FROM fg_descuentocomprobante dc'));
        assert.match(discountRead.sql, /dc\.descuento_id/);
        assert.match(discountRead.sql, /COALESCE\(dc\.descuento_id, dcli\.descuento_id\)/);
    } finally {
        db.query = originalQuery;
    }
});

test('reporte financiero no produce filas fuera del acceso autorizado', async () => {
    const result = await obtenerReporteFinanciero({ plantasAutorizadas: ['ATE'], plantasFiltro: ['FUERA'], desde: '2026-10-01', hasta: '2026-10-31' });
    assert.deepEqual(result.operaciones, []);
    assert.deepEqual(result.lineas, []);
    assert.deepEqual(result.pagos, []);
});

test('reporte financiero devuelve estructura vacía sin error para un período/sede sin registros', async () => {
    const originalQuery = db.query;
    const calls = [];
    db.query = async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
    };
    try {
        const data = await obtenerReporteFinanciero({
            plantasAutorizadas: ['98'], plantasFiltro: ['98'],
            desde: '2026-08-01', hasta: '2026-08-31'
        });
        assert.equal(calls.length, 9);
        assert.ok(calls.every(({ params }) => params[0][0] === '98'));
        assert.equal(data.metadatos.plantas.join(','), '98');
        for (const key of ['operaciones', 'lineas', 'ventasDirectas', 'comprobantes', 'ordenes', 'pagos', 'descuentos', 'ajustes', 'sedes']) {
            assert.deepEqual(data[key], []);
        }
    } finally {
        db.query = originalQuery;
    }
});
