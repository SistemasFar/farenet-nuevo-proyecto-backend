const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = require('../../../config/database');
const impactoService = require('../services/faregas-productos-impacto.service');

const normalizar = (sql) => String(sql).replace(/\s+/g, ' ').trim();

const impactoBaek = () => ({
    operacionesMixtas: [
        { id: 187, detalles: [{ id: 115 }, { id: 116 }] },
        { id: 200, detalles: [{ id: 129 }, { id: 130 }] }
    ],
    certificadosMixtos: [{ id: 302 }, { id: 320 }],
    certificadosAEliminar: [302, 320],
    facturaciones: [],
    ordenesPago: [
        { id: 197, operacion_id: 187, certificado_id: 302 },
        { id: 210, operacion_id: 200, certificado_id: 320 }
    ],
    pagos: [
        { id: 1207, orden_pago_id: 197 },
        { id: 1225, orden_pago_id: 210 }
    ],
    otrosProductos: [{ id: 25, codigo_sku: 'CHIP + PORTA CHIP - SURCO' }]
});

class FakeCleanupClient {
    constructor() {
        this.operaciones = new Map([187, 200].map((id) => [id, { id }]));
        this.detalles = new Map([115, 116, 129, 130].map((id) => [id, { id }]));
        this.certificados = new Map([302, 320].map((id) => [id, { id }]));
        this.ordenes = new Map([197, 210].map((id) => [id, { id }]));
        this.pagos = new Map([1207, 1225].map((id) => [id, { id }]));
        this.certificadoHijos = new Map([302, 320].map((id) => [id, { id }]));
        this.chips = new Map([[1, {
            id: 1,
            estado: 'RESERVADO',
            operacion_reserva_id: 187,
            reservado_en: new Date('2026-01-01')
        }]]);
        this.movimientos = new Map([[5, {
            id: 5,
            operacion_comercial_id: 187,
            certificado_id: 302
        }]]);
        this.catalogo = new Map([[25, { id: 25, codigo_sku: 'CHIP + PORTA CHIP - SURCO' }]]);
        this.log = [];
        this.failOn = null;
    }

    async query(sqlCrudo, params = []) {
        const sql = normalizar(sqlCrudo);
        this.log.push({ sql, params: [...params] });
        if (this.failOn && sql.includes(this.failOn)) throw new Error('FALLO_SIMULADO');

        if (/SELECT id FROM fg_operacion_comercial WHERE/.test(sql)) {
            return { rowCount: params[0].length, rows: params[0].map((id) => ({ id })) };
        }
        if (/SELECT id FROM fg_certificado WHERE/.test(sql)) {
            return { rowCount: params[0].length, rows: params[0].map((id) => ({ id })) };
        }
        if (/SELECT id FROM fg_chip WHERE/.test(sql)) {
            return { rowCount: this.chips.size, rows: [...this.chips.values()] };
        }
        if (/SELECT id FROM fg_chip_movimiento/.test(sql)) {
            return { rowCount: this.movimientos.size, rows: [...this.movimientos.values()] };
        }
        if (/SELECT id FROM fg_facturacion WHERE/.test(sql) || /SELECT id FROM fg_orden_pago WHERE/.test(sql)) {
            return { rowCount: params[0].length, rows: params[0].map((id) => ({ id })) };
        }
        if (/SELECT id FROM fg_credito/.test(sql) || /SELECT id FROM fg_debito/.test(sql) || /SELECT id FROM fg_documento_anulacion/.test(sql)) {
            return { rowCount: 0, rows: [] };
        }
        if (/DELETE FROM fg_documento_electronico_operacion/.test(sql)) return { rowCount: 0, rows: [] };
        if (/DELETE FROM fg_documento_anulacion/.test(sql)) return { rowCount: 0, rows: [] };
        if (/SELECT descuento_cliente_id, estado FROM fg_descuentocomprobante/.test(sql)) return { rowCount: 0, rows: [] };
        if (/UPDATE fg_descuentocliente/.test(sql)) return { rowCount: 0, rows: [] };
        if (/DELETE FROM fg_descuentocomprobante/.test(sql)) return { rowCount: 0, rows: [] };
        if (/DELETE FROM fg_facturacion_intento/.test(sql) || /DELETE FROM fg_facturacion_cuota/.test(sql)) return { rowCount: 0, rows: [] };
        if (/DELETE FROM fg_credito/.test(sql) || /DELETE FROM fg_debito/.test(sql) || /DELETE FROM fg_facturacion WHERE/.test(sql)) return { rowCount: 0, rows: [] };
        if (/DELETE FROM fg_pago/.test(sql)) {
            const before = this.pagos.size;
            (params[0] || []).forEach((id) => this.pagos.delete(Number(id)));
            return { rowCount: before - this.pagos.size, rows: [] };
        }
        if (/DELETE FROM fg_orden_pago/.test(sql)) {
            const before = this.ordenes.size;
            (params[0] || []).forEach((id) => this.ordenes.delete(Number(id)));
            return { rowCount: before - this.ordenes.size, rows: [] };
        }
        if (/UPDATE fg_chip SET/.test(sql)) {
            (params[0] || []).forEach((operacionId) => {
                for (const chip of this.chips.values()) {
                    if (Number(chip.operacion_reserva_id) !== Number(operacionId)) continue;
                    chip.operacion_reserva_id = null;
                    if (chip.estado === 'RESERVADO') {
                        chip.estado = 'DISPONIBLE';
                        chip.reservado_en = null;
                    }
                }
            });
            return { rowCount: 1, rows: [] };
        }
        if (/UPDATE fg_chip_movimiento/.test(sql)) {
            const [operaciones, certificados] = params;
            for (const movimiento of this.movimientos.values()) {
                if ((operaciones || []).map(Number).includes(Number(movimiento.operacion_comercial_id))) movimiento.operacion_comercial_id = null;
                if ((certificados || []).map(Number).includes(Number(movimiento.certificado_id))) movimiento.certificado_id = null;
            }
            return { rowCount: this.movimientos.size, rows: [] };
        }
        if (/DELETE FROM fg_certificado_/.test(sql)) {
            (params[0] || []).forEach((id) => this.certificadoHijos.delete(Number(id)));
            return { rowCount: 0, rows: [] };
        }
        if (/UPDATE fg_vehiculo/.test(sql)) return { rowCount: 0, rows: [] };
        if (/DELETE FROM fg_operacion_detalle_chip/.test(sql)) return { rowCount: 0, rows: [] };
        if (/DELETE FROM fg_operacion_detalle WHERE/.test(sql)) {
            const before = this.detalles.size;
            (params[0] || []).forEach((id) => this.detalles.delete(Number(id)));
            return { rowCount: before - this.detalles.size, rows: [] };
        }
        if (/DELETE FROM fg_operacion_comercial WHERE/.test(sql)) {
            const before = this.operaciones.size;
            (params[0] || []).forEach((id) => this.operaciones.delete(Number(id)));
            return { rowCount: before - this.operaciones.size, rows: [] };
        }
        if (/DELETE FROM fg_certificado WHERE/.test(sql)) {
            const before = this.certificados.size;
            (params[0] || []).forEach((id) => this.certificados.delete(Number(id)));
            return { rowCount: before - this.certificados.size, rows: [] };
        }

        throw new Error(`Consulta no simulada: ${sql}`);
    }

    release() {}
}

test('hard-delete del conjunto mixto elimina operaciones, detalles, pagos y certificados', async () => {
    const client = new FakeCleanupClient();
    const resumen = await impactoService.eliminarOperacionesMixtas(client, impactoBaek());

    assert.equal(resumen.operacionesEliminadas, 2);
    assert.equal(resumen.detallesEliminados, 4);
    assert.equal(resumen.ordenesPagoEliminadas, 2);
    assert.equal(resumen.pagosEliminados, 2);
    assert.equal(resumen.certificadosEliminados, 2);
    assert.deepEqual(resumen.otrosProductosPreservados, [25]);
    assert.equal(client.operaciones.size, 0);
    assert.equal(client.detalles.size, 0);
    assert.equal(client.ordenes.size, 0);
    assert.equal(client.pagos.size, 0);
    assert.equal(client.certificados.size, 0);
    assert.equal(client.catalogo.get(25).codigo_sku, 'CHIP + PORTA CHIP - SURCO');
    assert.equal(client.chips.get(1).estado, 'DISPONIBLE');
    assert.equal(client.chips.get(1).operacion_reserva_id, null);
    assert.equal(client.movimientos.get(5).operacion_comercial_id, null);
    assert.equal(client.movimientos.get(5).certificado_id, null);
});

test('el preview es read-only y hace rollback explícito', () => {
    const fuente = fs.readFileSync(require.resolve('../services/faregas-productos-impacto.service'), 'utf8');
    const inicio = fuente.indexOf('const preview = async');
    const fin = fuente.indexOf('const eliminarOperacionesMixtas', inicio);
    const bloque = fuente.slice(inicio, fin);
    assert.match(bloque, /await client\.query\('ROLLBACK'\)/);
    assert.doesNotMatch(bloque, /DELETE FROM|UPDATE /);
    assert.doesNotMatch(fuente, /fg_correlativo_certificado|fg_serie_comprobante/);
});

test('una factura fiscalmente protegida bloquea el hard-delete antes de escribir', async () => {
    const client = new FakeCleanupClient();
    const impacto = impactoBaek();
    impacto.facturaciones = [{
        id: 900,
        operacion_id: 187,
        estado: 'ACEPTADO',
        nro_comprobante: 'F001-0001',
        aceptada_sunat: true
    }];

    await assert.rejects(
        () => impactoService.eliminarOperacionesMixtas(client, impacto),
        (error) => error.message === 'FACTURACION_PROTEGIDA'
    );
    assert.equal(client.operaciones.size, 2);
    assert.equal(client.certificados.size, 2);
    assert.ok(!client.log.some(({ sql }) => /DELETE FROM/.test(sql)));
});

test('preview de producto usa la misma consulta read-only y no consume correlativos', async () => {
    const originalConnect = db.connect;
    const consultas = [];
    const client = {
        async query(sql, params = []) {
            consultas.push(normalizar(sql));
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
            if (/SELECT id, codigo_sku/.test(sql)) return { rowCount: 1, rows: [{ id: 25, codigo_sku: '0021', descripcion: 'BAEK' }] };
            if (/FROM fg_tarifa t/.test(sql)) return { rowCount: 0, rows: [] };
            if (/WITH target_ops/.test(sql)) return { rowCount: 0, rows: [] };
            if (/FROM fg_certificado c/.test(sql)) return { rowCount: 0, rows: [] };
            if (/FROM fg_producto_sede/.test(sql) || /FROM fg_producto_inventariable WHERE/.test(sql) || /FROM fg_producto_inventariable_sede/.test(sql)) return { rowCount: 0, rows: [] };
            if (/FROM fg_servicio s/.test(sql)) return { rowCount: 0, rows: [] };
            if (/FROM fg_chip WHERE/.test(sql) || /FROM fg_chip_movimiento/.test(sql)) return { rowCount: 0, rows: [] };
            throw new Error(`Consulta no simulada: ${normalizar(sql)}`);
        },
        release() {}
    };
    db.connect = async () => client;
    try {
        const impacto = await impactoService.preview(25);
        assert.equal(impacto.requiereConfirmacionConjunto, false);
        assert.ok(consultas.includes('ROLLBACK'));
        assert.ok(!consultas.some((sql) => sql.startsWith('DELETE FROM') || sql.startsWith('UPDATE ')));
    } finally {
        db.connect = originalConnect;
    }
});
