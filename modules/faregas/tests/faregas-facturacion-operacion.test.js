const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const facturacionService = require('../services/faregas-facturacion.service');
const { validarCodigosSunatOperacion } = facturacionService._private;

const user = { username: 'USUARIO_FACTURACION', perfil_id: 'SISTEMAS' };
const datos = {
    tipoComprobante: 'BOLETA',
    nroDocumento: '12345678',
    nombreRazonSocial: 'CLIENTE FACTURACION',
    direccion: 'DIRECCION FISCAL',
    condicionPago: 'CONTADO'
};

const crearCliente = () => {
    const state = { invoiceInserts: 0, invoiceRows: [], invoiceInsertSql: '', existingEstado: null };
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim().toUpperCase();
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rowCount: 0, rows: [] };
            if (text.includes('FROM FG_OPERACION_COMERCIAL') && text.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 50, planta_key: '201', estado: 'PAGADO' }] };
            }
            if (text.includes('FROM FG_ORDEN_PAGO')) {
                return { rowCount: 1, rows: [{ id: 70, estado: 'PAGADO', saldo_pendiente: 0, moneda_key: 'sol', baseimponible: 8.47, igv: 1.53, importe_total: 10 }] };
            }
            if (text.includes('FROM FG_PAGO')) {
                return { rowCount: 1, rows: [{ tipocontado_key: 'efectivo' }] };
            }
            if (text.includes('SELECT * FROM FG_FACTURACION WHERE OPERACION_ID')) {
                if (state.invoiceInserts > 0) {
                    return { rowCount: 1, rows: [{ ...state.invoiceRows[0], estado: state.existingEstado || 'ACEPTADO' }] };
                }
                return { rowCount: 0, rows: [] };
            }
            if (text.startsWith('INSERT INTO FG_FACTURACION')) {
                state.invoiceInserts += 1;
                state.invoiceInsertSql = text;
                const row = {
                    id: 90,
                    certificado_id: null,
                    operacion_id: 50,
                    estado: 'BORRADOR',
                    tipo_comprobante: params[0] || 'BOLETA',
                    tipo_documento_cliente: 'DNI',
                    nro_documento: '12345678',
                    nombre_razon_social: 'CLIENTE FACTURACION',
                    direccion: 'DIRECCION FISCAL',
                    email: null,
                    telefono: null,
                    moneda_key: 'sol',
                    base_imponible: 8.47,
                    igv: 1.53,
                    importe_total: 10,
                    condicion_pago: 'CONTADO',
                    intentos: 0
                };
                state.invoiceRows.push(row);
                return { rowCount: 1, rows: [row] };
            }
            if (text.includes('FROM FG_FACTURACION_CUOTA')) return { rowCount: 0, rows: [] };
            return { rowCount: 0, rows: [] };
        },
        release() {}
    };
    return { client, state };
};

test.after(() => db.end());

test('permite operación CHIP con código SUNAT vacío y rechaza solo valores informados inválidos', () => {
    assert.deepEqual(validarCodigosSunatOperacion([{ codigo_sunat_snapshot: null }]), []);
    assert.deepEqual(validarCodigosSunatOperacion([{ codigo_sunat_snapshot: '' }]), []);
    assert.deepEqual(validarCodigosSunatOperacion([{ codigo_sunat_snapshot: '12345678' }]), []);
    assert.deepEqual(validarCodigosSunatOperacion([{ codigo_sunat_snapshot: '1234567' }]), [
        'El código de clasificación SUNAT del producto Chip debe contener 8 dígitos.'
    ]);
});

test('la prevalidación fiscal rechaza documentos inválidos antes de vender', () => {
    const boletaInvalida = facturacionService.evaluarDatosFacturacion({
        ...datos,
        nroDocumento: '332332'
    });
    assert.equal(boletaInvalida.errores.length > 0, true);

    const facturaConDni = facturacionService.evaluarDatosFacturacion({
        ...datos,
        tipoComprobante: 'FACTURA'
    });
    assert.equal(facturaConDni.errores.length > 0, true);

    const facturaValida = facturacionService.evaluarDatosFacturacion({
        ...datos,
        tipoComprobante: 'FACTURA',
        nroDocumento: '20600444531'
    });
    assert.deepEqual(facturaValida.errores, []);
});

test('guardarFacturacionOperacion crea una factura sin certificado y con operacion_id', async () => {
    const originalConnect = db.connect;
    const { client, state } = crearCliente();
    db.connect = async () => client;
    try {
        const result = await facturacionService.guardarFacturacionOperacion(50, datos, user);
        assert.equal(state.invoiceInserts, 1);
        assert.equal(result.certificadoId, null);
        assert.equal(result.operacionId, 50);
        assert.equal(result.tipoComprobante, 'BOLETA');
        assert.match(state.invoiceInsertSql, /ON CONFLICT \(OPERACION_ID\) WHERE OPERACION_ID IS NOT NULL/);
    } finally {
        db.connect = originalConnect;
    }
});

test('guardarFacturacionOperacion acepta FACTURA con RUC válido y la misma relación', async () => {
    const originalConnect = db.connect;
    const { client, state } = crearCliente();
    db.connect = async () => client;
    try {
        const result = await facturacionService.guardarFacturacionOperacion(50, {
            ...datos,
            tipoComprobante: 'FACTURA',
            nroDocumento: '20600444531'
        }, user);
        assert.equal(state.invoiceInserts, 1);
        assert.equal(result.tipoComprobante, 'FACTURA');
        assert.equal(result.certificadoId, null);
        assert.equal(result.operacionId, 50);
    } finally {
        db.connect = originalConnect;
    }
});

test('una factura rechazada se conserva y no se recrea al reintentar', async () => {
    const originalConnect = db.connect;
    const { client, state } = crearCliente();
    db.connect = async () => client;
    try {
        await facturacionService.guardarFacturacionOperacion(50, datos, user);
        state.existingEstado = 'RECHAZADO';
        const result = await facturacionService.guardarFacturacionOperacion(50, datos, user);
        assert.equal(state.invoiceInserts, 1);
        assert.equal(result.estado, 'RECHAZADO');
        assert.equal(result.certificadoId, null);
        assert.equal(result.operacionId, 50);
    } finally {
        db.connect = originalConnect;
    }
});

test('reintentar la misma operacion_id reutiliza la factura existente', async () => {
    const originalConnect = db.connect;
    const { client, state } = crearCliente();
    db.connect = async () => client;
    try {
        await facturacionService.guardarFacturacionOperacion(50, datos, user);
        const result = await facturacionService.guardarFacturacionOperacion(50, datos, user);
        assert.equal(state.invoiceInserts, 1);
        assert.equal(result.id, 90);
        assert.equal(result.certificadoId, null);
        assert.equal(result.operacionId, 50);
    } finally {
        db.connect = originalConnect;
    }
});
