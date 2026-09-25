const test = require('node:test');
const assert = require('node:assert/strict');

const documentoTributarioPolicy = require('../services/faregas-documento-tributario-policy');
const chipsTiposImpacto = require('../services/faregas-chips-tipos-impacto.service');
const descuentosImpacto = require('../services/faregas-descuentos-impacto.service');

const normalizar = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const idList = (rows) => [...new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0))];

/**
 * Store en memoria que replica el grafo real de FKs verificado en la base:
 * sólo responde a las sentencias que emite el servicio.
 */
class FakeGrafo {
    constructor(estado = {}) {
        this.estado = {
            tipos: estado.tipos || [],
            sedes: estado.sedes || [],
            chips: estado.chips || [],
            movimientos: estado.movimientos || [],
            certChip: estado.certChip || [],
            opChip: estado.opChip || [],
            ventas: estado.ventas || [],
            productos: estado.productos || [],
            certificados: estado.certificados || [],
            descuentos: estado.descuentos || [],
            codigos: estado.codigos || [],
            reglas: estado.reglas || [],
            usos: estado.usos || [],
            servicios: estado.servicios || []
        };
        this.log = [];
        this.snapshot = null;
        this.failOn = null;
    }

    async query(sqlCrudo, params = []) {
        const sql = normalizar(sqlCrudo);
        this.log.push({ sql, params: [...params] });
        if (sql === 'BEGIN') { this.snapshot = JSON.parse(JSON.stringify(this.estado)); return { rowCount: 0, rows: [] }; }
        if (sql === 'COMMIT') { this.snapshot = null; return { rowCount: 0, rows: [] }; }
        if (sql === 'ROLLBACK') {
            if (this.snapshot) this.estado = this.snapshot;
            this.snapshot = null;
            return { rowCount: 0, rows: [] };
        }
        if (this.failOn && sql.includes(this.failOn)) throw new Error('FALLO_SIMULADO');
        const e = this.estado;
        const lista = (items) => ({ rowCount: items.length, rows: items.map((i) => ({ ...i })) });

        // ---------- TIPOS DE CHIP (reads) ----------
        if (/^SELECT .*FROM fg_producto_inventariable WHERE id = \$1/.test(sql)) {
            return lista(e.tipos.filter((t) => Number(t.id) === Number(params[0])));
        }
        if (/^SELECT .*FROM fg_producto_inventariable_sede/.test(sql)) {
            return lista(e.sedes.filter((s) => Number(s.producto_inventariable_id) === Number(params[0])));
        }
        if (/^SELECT .*FROM fg_chip\s+WHERE producto_inventariable_id/.test(sql)) {
            return lista(e.chips.filter((c) => Number(c.producto_inventariable_id) === Number(params[0])));
        }
        if (/^SELECT id, chip_id, tipo_movimiento/.test(sql)) {
            return lista(e.movimientos.filter((m) => (params[0] || []).map(Number).includes(Number(m.chip_id))));
        }
        if (/^SELECT certificado_id, chip_id, fecha_asociacion/.test(sql)) {
            return lista(e.certChip.filter((r) => (params[0] || []).map(Number).includes(Number(r.chip_id))));
        }
        if (/^SELECT operacion_detalle_id, chip_id/.test(sql)) {
            return lista(e.opChip.filter((r) => (params[0] || []).map(Number).includes(Number(r.chip_id))));
        }
        if (/^SELECT id, chip_id, producto_inventariable_id FROM fg_venta_detalle/.test(sql)) {
            const chips = (params[0] || []).map(Number);
            return lista(e.ventas.filter((v) => chips.includes(Number(v.chip_id)) || Number(v.producto_inventariable_id) === Number(params[1])));
        }
        if (/^SELECT id, codigo_sku, descripcion FROM fg_producto_facturacion/.test(sql)) {
            return lista(e.productos.filter((p) => Number(p.producto_chip_id) === Number(params[0])));
        }
        if (/^SELECT id, estado, numero_certificado FROM fg_certificado/.test(sql)) {
            return lista(e.certificados.filter((c) => Number(c.producto_chip_id) === Number(params[0])));
        }

        // ---------- TIPOS DE CHIP (escrituras) ----------
        if (/UPDATE fg_certificado SET producto_chip_id = NULL/.test(sql)) {
            const antes = e.certificados.filter((c) => Number(c.producto_chip_id) === Number(params[0])).length;
            e.certificados.forEach((c) => { if (Number(c.producto_chip_id) === Number(params[0])) c.producto_chip_id = null; });
            return { rowCount: antes, rows: [] };
        }
        if (/UPDATE fg_producto_facturacion SET producto_chip_id = NULL/.test(sql)) {
            const antes = e.productos.filter((p) => Number(p.producto_chip_id) === Number(params[0])).length;
            e.productos.forEach((p) => { if (Number(p.producto_chip_id) === Number(params[0])) p.producto_chip_id = null; });
            return { rowCount: antes, rows: [] };
        }
        if (/DELETE FROM fg_certificado_chip/.test(sql)) {
            const antes = e.certChip.length;
            e.certChip = e.certChip.filter((r) => !(params[0] || []).map(Number).includes(Number(r.chip_id)));
            return { rowCount: antes - e.certChip.length, rows: [] };
        }
        if (/DELETE FROM fg_operacion_detalle_chip/.test(sql)) {
            const antes = e.opChip.length;
            e.opChip = e.opChip.filter((r) => !(params[0] || []).map(Number).includes(Number(r.chip_id)));
            return { rowCount: antes - e.opChip.length, rows: [] };
        }
        if (/DELETE FROM fg_chip_movimiento/.test(sql)) {
            const antes = e.movimientos.length;
            e.movimientos = e.movimientos.filter((m) => !(params[0] || []).map(Number).includes(Number(m.chip_id)));
            return { rowCount: antes - e.movimientos.length, rows: [] };
        }
        if (/DELETE FROM fg_chip WHERE producto_inventariable_id/.test(sql)) {
            const antes = e.chips.length;
            e.chips = e.chips.filter((c) => Number(c.producto_inventariable_id) !== Number(params[0]));
            return { rowCount: antes - e.chips.length, rows: [] };
        }
        if (/DELETE FROM fg_producto_inventariable_sede/.test(sql)) {
            const antes = e.sedes.length;
            e.sedes = e.sedes.filter((s) => Number(s.producto_inventariable_id) !== Number(params[0]));
            return { rowCount: antes - e.sedes.length, rows: [] };
        }
        if (/DELETE FROM fg_producto_inventariable WHERE id/.test(sql)) {
            const antes = e.tipos.length;
            e.tipos = e.tipos.filter((t) => Number(t.id) !== Number(params[0]));
            return { rowCount: antes - e.tipos.length, rows: [] };
        }

        // ---------- DESCUENTOS (reads) ----------
        if (/^SELECT .*FROM fg_descuento WHERE id = \$1/.test(sql)) {
            return lista(e.descuentos.filter((d) => Number(d.id) === Number(params[0])));
        }
        if (/^SELECT .*FROM fg_descuento WHERE id=\$1 FOR UPDATE/.test(sql) || /^SELECT .*FROM fg_descuento WHERE id = \$1 FOR UPDATE/.test(sql)) {
            return lista(e.descuentos.filter((d) => Number(d.id) === Number(params[0])));
        }
        if (/^SELECT id, descuento_id, codigo, max_usos/.test(sql)) {
            return lista(e.codigos.filter((c) => Number(c.descuento_id) === Number(params[0])));
        }
        if (/^SELECT DISTINCT s\.id, s\.codigo, s\.nombre/.test(sql)) {
            const ids = [...new Set(e.reglas.filter((r) => Number(r.descuento_id) === Number(params[0])).map((r) => Number(r.servicio_id)))];
            return lista(e.servicios.filter((s) => ids.includes(Number(s.id))));
        }
        if (/^SELECT d\.id, d\.descuento_id/.test(sql)) {
            const objetivo = (params[1] || []).map(Number);
            return lista(e.reglas.filter((r) => (
                Number(r.descuento_id) === Number(params[0])
                || (r.descuento_cliente_id !== null && objetivo.includes(Number(r.descuento_cliente_id)))
            )).map((r) => ({
                ...r,
                servicio_codigo: e.servicios.find((s) => Number(s.id) === Number(r.servicio_id))?.codigo || null,
                servicio_nombre: e.servicios.find((s) => Number(s.id) === Number(r.servicio_id))?.nombre || null
            })));
        }
        if (/^SELECT u\.id, u\.descuento_cliente_id/.test(sql)) {
            return lista(e.usos.filter((u) => (params[0] || []).map(Number).includes(Number(u.descuento_cliente_id))));
        }

        // ---------- DESCUENTOS (escrituras) ----------
        if (/DELETE FROM fg_descuentocomprobante/.test(sql)) {
            const antes = e.usos.length;
            e.usos = e.usos.filter((u) => !(params[0] || []).map(Number).includes(Number(u.descuento_cliente_id)));
            return { rowCount: antes - e.usos.length, rows: [] };
        }
        if (/DELETE FROM fg_descuentodetalle/.test(sql)) {
            const antes = e.reglas.length;
            const codigos = (params[1] || []).map(Number);
            e.reglas = e.reglas.filter((r) => (
                Number(r.descuento_id) !== Number(params[0])
                && !(r.descuento_cliente_id !== null && codigos.includes(Number(r.descuento_cliente_id)))
            ));
            return { rowCount: antes - e.reglas.length, rows: [] };
        }
        if (/DELETE FROM fg_descuentocliente WHERE descuento_id/.test(sql)) {
            const antes = e.codigos.length;
            e.codigos = e.codigos.filter((c) => Number(c.descuento_id) !== Number(params[0]));
            return { rowCount: antes - e.codigos.length, rows: [] };
        }
        if (/DELETE FROM fg_descuento WHERE id/.test(sql)) {
            const antes = e.descuentos.length;
            e.descuentos = e.descuentos.filter((d) => Number(d.id) !== Number(params[0]));
            return { rowCount: antes - e.descuentos.length, rows: [] };
        }

        throw new Error(`Consulta no simulada: ${sql}`);
    }

    release() {}
}

const conAmbiente = async (ambiente, fn) => {
    const original = documentoTributarioPolicy.permiteLimpiezaDeDatosDePrueba;
    documentoTributarioPolicy.permiteLimpiezaDeDatosDePrueba = (environment) => (
        ambiente === 'PRODUCCION' ? false : original(environment)
    );
    try {
        return await fn();
    } finally {
        documentoTributarioPolicy.permiteLimpiezaDeDatosDePrueba = original;
    }
};

const tipoBase = { id: 34, codigo: 'EXOCHIP', nombre: 'EXOCHIP', tipo: 'CHIP_SERIALIZADO', activo: true, control_stock: true, producto_facturacion_id: null };
const otroTipo = { id: 1, codigo: 'CHIP', nombre: 'Chip y porta chip', tipo: 'CHIP_SERIALIZADO', activo: true, control_stock: true, producto_facturacion_id: 25 };
const descuentoBase = { id: 5, codigo: 'D_ALIANZA_1', nombre: 'PP', tipo: 'ALIANZA', activo: true, planta_key: null, empresa_aliada_ruc: '12123332131', empresa_aliada_nombre: 'PPK' };
const otroDescuento = { id: 1, codigo: '123', nombre: 'CUPONCITO', tipo: 'CAMPANA', activo: true, planta_key: '201', empresa_aliada_ruc: '123', empresa_aliada_nombre: 'CUPONCITO' };

// ===========================================================================
// TIPOS DE CHIP
// ===========================================================================

test('chips 1. tipo sin chips ni configuraciones: se elimina', async () => {
    const store = new FakeGrafo({ tipos: [tipoBase, otroTipo] });
    const impacto = await chipsTiposImpacto.calcularImpactoEnTransaccion(store, 34, tipoBase);
    assert.equal(impacto.eliminable, true);
    assert.equal(impacto.chips.length, 0);
    assert.equal(impacto.configuracionesSede.length, 0);

    const resumen = await conAmbiente('DEMO', () => chipsTiposImpacto.eliminarTipoConDependencias(store, impacto));
    assert.equal(resumen.tipoEliminado, 1);
    assert.equal(store.estado.tipos.length, 1);
    assert.equal(store.estado.tipos[0].codigo, 'CHIP');
});

test('chips 2. tipo con configuración por sede: configuración + tipo eliminados', async () => {
    const store = new FakeGrafo({
        tipos: [tipoBase, otroTipo],
        sedes: [{ id: 90, producto_inventariable_id: 34, planta_key: '190', precio: 10, activo: true }],
        sedesOtro: [{ id: 91, producto_inventariable_id: 1, planta_key: '190', precio: 20, activo: true }]
    });
    const impacto = await chipsTiposImpacto.calcularImpactoEnTransaccion(store, 34, tipoBase);
    assert.equal(impacto.configuracionesSede.length, 1);

    const resumen = await conAmbiente('DEMO', () => chipsTiposImpacto.eliminarTipoConDependencias(store, impacto));
    assert.equal(resumen.configuracionesSedeEliminadas, 1);
    assert.equal(store.estado.sedes.filter((s) => Number(s.producto_inventariable_id) === 34).length, 0);
    assert.equal(store.estado.tipos.length, 1);
});

test('chips 3. tipo con chips de prueba: chips + movimientos + asignaciones + tipo eliminados', async () => {
    const store = new FakeGrafo({
        tipos: [tipoBase, otroTipo],
        chips: [
            { id: 501, producto_inventariable_id: 34, numero_chip: 'EXO-1', planta_actual_key: '190', estado: 'DISPONIBLE' },
            { id: 502, producto_inventariable_id: 34, numero_chip: 'EXO-2', planta_actual_key: '190', estado: 'RESERVADO' },
            { id: 601, producto_inventariable_id: 1, numero_chip: 'CHIP-1', planta_actual_key: '190', estado: 'DISPONIBLE' }
        ],
        movimientos: [
            { id: 701, chip_id: 501, tipo_movimiento: 'INGRESO' },
            { id: 702, chip_id: 502, tipo_movimiento: 'RESERVA' },
            { id: 703, chip_id: 601, tipo_movimiento: 'INGRESO' }
        ],
        opChip: [{ operacion_detalle_id: 900, chip_id: 502 }],
        certChip: [{ certificado_id: 800, chip_id: 501 }]
    });
    const impacto = await chipsTiposImpacto.calcularImpactoEnTransaccion(store, 34, tipoBase);
    assert.equal(impacto.chips.length, 2);
    assert.equal(impacto.movimientos.length, 2);
    assert.equal(impacto.asignacionesOperacion.length, 1);
    assert.equal(impacto.asignacionesCertificado.length, 1);

    const resumen = await conAmbiente('DEMO', () => chipsTiposImpacto.eliminarTipoConDependencias(store, impacto));
    assert.equal(resumen.chipsEliminados, 2);
    assert.equal(resumen.movimientosEliminados, 2);
    assert.equal(resumen.asignacionesOperacionEliminadas, 1);
    assert.equal(resumen.asignacionesCertificadoEliminadas, 1);
    assert.equal(resumen.tipoEliminado, 1);

    // 5. el otro tipo y sus chips siguen intactos
    assert.equal(store.estado.tipos.length, 1);
    assert.equal(store.estado.chips.length, 1);
    assert.equal(store.estado.chips[0].numero_chip, 'CHIP-1');
    assert.equal(store.estado.movimientos.length, 1);
    assert.equal(store.estado.movimientos[0].chip_id, 601);
});

test('chips 4. producto fiscal vinculado se conserva y sólo se desvincula', async () => {
    const store = new FakeGrafo({
        tipos: [tipoBase, otroTipo],
        productos: [{ id: 25, codigo_sku: 'CHIP-PORTA', descripcion: 'CHIP + PORTA CHIP', producto_chip_id: 34 }],
        certificados: [{ id: 300, estado: 'EMITIDO', numero_certificado: 'X-1', producto_chip_id: 34 }]
    });
    const impacto = await chipsTiposImpacto.calcularImpactoEnTransaccion(store, 34, tipoBase);
    assert.equal(impacto.productosFiscalesPreservados.length, 1);
    assert.equal(impacto.certificadosPreservados.length, 1);

    const resumen = await conAmbiente('DEMO', () => chipsTiposImpacto.eliminarTipoConDependencias(store, impacto));
    assert.equal(resumen.productosFiscalesDesvinculados, 1);
    assert.equal(resumen.certificadosDesvinculados, 1);
    assert.equal(store.estado.productos.length, 1, 'el producto fiscal NO se borra');
    assert.equal(store.estado.productos[0].producto_chip_id, null);
    assert.equal(store.estado.certificados.length, 1, 'el certificado NO se borra');
    assert.ok(!store.log.some(({ sql }) => /DELETE FROM fg_producto_facturacion/.test(sql)));
    assert.ok(!store.log.some(({ sql }) => /DELETE FROM fg_certificado WHERE/.test(sql)));
});

test('chips 5. otro tipo de chip permanece intacto', async () => {
    const store = new FakeGrafo({
        tipos: [tipoBase, otroTipo],
        sedes: [
            { id: 90, producto_inventariable_id: 34, planta_key: '190', precio: 10, activo: true },
            { id: 91, producto_inventariable_id: 1, planta_key: '190', precio: 20, activo: true }
        ]
    });
    const impacto = await chipsTiposImpacto.calcularImpactoEnTransaccion(store, 34, tipoBase);
    await conAmbiente('DEMO', () => chipsTiposImpacto.eliminarTipoConDependencias(store, impacto));

    assert.equal(store.estado.tipos.length, 1);
    assert.equal(store.estado.tipos[0].codigo, 'CHIP');
    assert.equal(store.estado.sedes.length, 1);
    assert.equal(store.estado.sedes[0].producto_inventariable_id, 1);
});

test('chips: un chip con venta real bloquea la limpieza', async () => {
    const store = new FakeGrafo({
        tipos: [tipoBase, otroTipo],
        chips: [{ id: 501, producto_inventariable_id: 34, numero_chip: 'EXO-1', planta_actual_key: '190', estado: 'VENDIDO' }],
        ventas: [{ id: 1, venta_id: 10, chip_id: 501, producto_inventariable_id: 34 }]
    });
    const impacto = await chipsTiposImpacto.calcularImpactoEnTransaccion(store, 34, tipoBase);
    assert.equal(impacto.eliminable, false);
    assert.deepEqual(impacto.bloqueos.map((b) => b.motivo), ['CHIP_CON_VENTAS']);

    await assert.rejects(
        () => conAmbiente('DEMO', () => chipsTiposImpacto.eliminarTipoConDependencias(store, impacto)),
        (error) => error.message === 'TIPO_CHIP_BLOQUEADO'
    );
    assert.equal(store.estado.tipos.length, 2);
});

test('chips: PRODUCCION bloquea la limpieza de tipos', async () => {
    const store = new FakeGrafo({ tipos: [tipoBase, otroTipo] });
    await assert.rejects(
        () => conAmbiente('PRODUCCION', async () => {
            const impacto = await chipsTiposImpacto.calcularImpactoEnTransaccion(store, 34, tipoBase);
            assert.equal(impacto.ambiente, 'DEMO');
            assert.equal(impacto.limpiezaHabilitada, false);
            assert.equal(impacto.eliminable, false);
            return chipsTiposImpacto.eliminarTipoConDependencias(store, impacto);
        }),
        (error) => error.message === 'AMBIENTE_PRODUCCION'
    );
    assert.equal(store.estado.tipos.length, 2);
});

// ===========================================================================
// DESCUENTOS
// ===========================================================================

const escenarioDescuento = (extra = {}) => new FakeGrafo({
    descuentos: [descuentoBase, otroDescuento],
    servicios: [
        { id: 1, codigo: 'GLP_ANUAL', nombre: 'GLP Anual' },
        { id: 2, codigo: 'GLP_INICIAL', nombre: 'GLP Inicial' }
    ],
    ...extra
});

test('descuentos 1. descuento sin dependencias: eliminado', async () => {
    const store = escenarioDescuento();
    const impacto = await descuentosImpacto.calcularImpactoEnTransaccion(store, 5, descuentoBase);
    assert.equal(impacto.eliminable, true);
    assert.equal(impacto.codigos.length, 0);
    assert.equal(impacto.configuraciones.length, 0);
    assert.equal(impacto.usos.length, 0);

    const resumen = await conAmbiente('DEMO', () => descuentosImpacto.eliminarDescuentoConDependencias(store, impacto));
    assert.equal(resumen.descuentoEliminado, 1);
    assert.equal(store.estado.descuentos.length, 1);
    assert.equal(store.estado.descuentos[0].codigo, '123');
});

test('descuentos 2. descuento con códigos: códigos + descuento eliminados', async () => {
    const store = escenarioDescuento({
        codigos: [
            { id: 10, descuento_id: 5, codigo: 'PP-1', max_usos: 5, usos_realizados: 1, activo: true, planta_key: null },
            { id: 11, descuento_id: 5, codigo: 'PP-2', max_usos: 5, usos_realizados: 0, activo: true, planta_key: null },
            { id: 20, descuento_id: 1, codigo: 'CUP-1', max_usos: 9, usos_realizados: 0, activo: true, planta_key: '201' }
        ]
    });
    const impacto = await descuentosImpacto.calcularImpactoEnTransaccion(store, 5, descuentoBase);
    assert.equal(impacto.codigos.length, 2);

    const resumen = await conAmbiente('DEMO', () => descuentosImpacto.eliminarDescuentoConDependencias(store, impacto));
    assert.equal(resumen.codigosEliminados, 2);
    assert.equal(store.estado.codigos.length, 1);
    assert.equal(store.estado.codigos[0].codigo, 'CUP-1');
});

test('descuentos 3. descuento con servicios configurados: relación eliminada, servicios permanecen', async () => {
    const store = escenarioDescuento({
        reglas: [
            { id: 64, descuento_id: 5, descuento_cliente_id: null, servicio_id: 1, planta_key: '201', tipo_calculo: 'PORCENTAJE', valor: 10, activo: true },
            { id: 65, descuento_id: 5, descuento_cliente_id: null, servicio_id: 2, planta_key: '201', tipo_calculo: 'PORCENTAJE', valor: 10, activo: true }
        ]
    });
    const impacto = await descuentosImpacto.calcularImpactoEnTransaccion(store, 5, descuentoBase);
    assert.equal(impacto.configuraciones.length, 2);
    assert.deepEqual(impacto.serviciosPreservados.map((s) => s.codigo), ['GLP_ANUAL', 'GLP_INICIAL']);

    const resumen = await conAmbiente('DEMO', () => descuentosImpacto.eliminarDescuentoConDependencias(store, impacto));
    assert.equal(resumen.configuracionesEliminadas, 2);
    assert.equal(resumen.serviciosPreservados, 2);
    assert.equal(store.estado.reglas.length, 0, 'la relación descuento-servicio desaparece');
    assert.equal(store.estado.servicios.length, 2, 'los servicios NO se borran');
    assert.ok(!store.log.some(({ sql }) => /DELETE FROM fg_servicio/.test(sql)));
});

test('descuentos 4. descuento con empresa: la empresa/planta permanece', async () => {
    const store = escenarioDescuento();
    const impacto = await descuentosImpacto.calcularImpactoEnTransaccion(store, 5, descuentoBase);
    await conAmbiente('DEMO', () => descuentosImpacto.eliminarDescuentoConDependencias(store, impacto));
    assert.equal(impacto.descuento.empresa_aliada_nombre, 'PPK');
    assert.ok(!store.log.some(({ sql }) => /DELETE FROM fg_planta|DELETE FROM fg_empresa/.test(sql)));
});

test('descuentos 5. descuento con usos: sólo se borra el uso, el certificado se conserva', async () => {
    const store = escenarioDescuento({
        codigos: [{ id: 10, descuento_id: 5, codigo: 'PP-1', max_usos: 5, usos_realizados: 2, activo: true, planta_key: null }],
        usos: [
            { id: 30, descuento_cliente_id: 10, certificado_id: 252, facturacion_id: 60, orden_pago_id: 70, estado: 'APLICADO' },
            { id: 31, descuento_cliente_id: 10, certificado_id: 253, facturacion_id: 61, orden_pago_id: 71, estado: 'APLICADO' }
        ]
    });
    const impacto = await descuentosImpacto.calcularImpactoEnTransaccion(store, 5, descuentoBase);
    assert.equal(impacto.usos.length, 2);
    assert.deepEqual(impacto.certificadosPreservados, [252, 253]);

    const resumen = await conAmbiente('DEMO', () => descuentosImpacto.eliminarDescuentoConDependencias(store, impacto));
    assert.equal(resumen.usosEliminados, 2);
    assert.equal(store.estado.usos.length, 0);
    assert.ok(!store.log.some(({ sql }) => /DELETE FROM fg_certificado|DELETE FROM fg_operacion_comercial|DELETE FROM fg_facturacion|DELETE FROM fg_orden_pago/.test(sql)));
});

test('descuentos 6. otro descuento permanece intacto', async () => {
    const store = escenarioDescuento({
        codigos: [
            { id: 10, descuento_id: 5, codigo: 'PP-1', max_usos: 5, usos_realizados: 0, activo: true, planta_key: null },
            { id: 20, descuento_id: 1, codigo: 'CUP-1', max_usos: 9, usos_realizados: 3, activo: true, planta_key: '201' }
        ],
        reglas: [
            { id: 64, descuento_id: 5, descuento_cliente_id: null, servicio_id: 1, planta_key: '201', tipo_calculo: 'PORCENTAJE', valor: 10, activo: true },
            { id: 90, descuento_id: 1, descuento_cliente_id: null, servicio_id: 1, planta_key: '201', tipo_calculo: 'PORCENTAJE', valor: 50, activo: true }
        ]
    });
    const impacto = await descuentosImpacto.calcularImpactoEnTransaccion(store, 5, descuentoBase);
    await conAmbiente('DEMO', () => descuentosImpacto.eliminarDescuentoConDependencias(store, impacto));

    assert.equal(store.estado.descuentos.length, 1);
    assert.equal(store.estado.descuentos[0].codigo, '123');
    assert.equal(store.estado.codigos.length, 1);
    assert.equal(store.estado.codigos[0].codigo, 'CUP-1');
    assert.equal(store.estado.reglas.length, 1);
    assert.equal(store.estado.reglas[0].descuento_id, 1);
});

// ===========================================================================
// TRANSACCIONALIDAD
// ===========================================================================

test('chips 6. fallo intermedio: ROLLBACK completo', async () => {
    const store = new FakeGrafo({
        tipos: [tipoBase, otroTipo],
        chips: [{ id: 501, producto_inventariable_id: 34, numero_chip: 'EXO-1', planta_actual_key: '190', estado: 'DISPONIBLE' }],
        movimientos: [{ id: 701, chip_id: 501, tipo_movimiento: 'INGRESO' }]
    });
    await store.query('BEGIN');
    const impacto = await chipsTiposImpacto.calcularImpactoEnTransaccion(store, 34, tipoBase);
    store.failOn = 'DELETE FROM fg_chip_movimiento';

    await assert.rejects(
        () => conAmbiente('DEMO', () => chipsTiposImpacto.eliminarTipoConDependencias(store, impacto)),
        (error) => error.message === 'FALLO_SIMULADO'
    );
    await store.query('ROLLBACK');

    assert.equal(store.estado.tipos.length, 2);
    assert.equal(store.estado.chips.length, 1);
    assert.equal(store.estado.movimientos.length, 1);
});

test('descuentos 7. fallo intermedio: ROLLBACK completo', async () => {
    const store = escenarioDescuento({
        codigos: [{ id: 10, descuento_id: 5, codigo: 'PP-1', max_usos: 5, usos_realizados: 0, activo: true, planta_key: null }],
        usos: [{ id: 30, descuento_cliente_id: 10, certificado_id: 252, facturacion_id: 60, orden_pago_id: 70, estado: 'APLICADO' }],
        reglas: [{ id: 64, descuento_id: 5, descuento_cliente_id: null, servicio_id: 1, planta_key: '201', tipo_calculo: 'PORCENTAJE', valor: 10, activo: true }]
    });
    await store.query('BEGIN');
    const impacto = await descuentosImpacto.calcularImpactoEnTransaccion(store, 5, descuentoBase);
    store.failOn = 'DELETE FROM fg_descuentocliente';

    await assert.rejects(
        () => conAmbiente('DEMO', () => descuentosImpacto.eliminarDescuentoConDependencias(store, impacto)),
        (error) => error.message === 'FALLO_SIMULADO'
    );
    await store.query('ROLLBACK');

    assert.equal(store.estado.descuentos.length, 2);
    assert.equal(store.estado.codigos.length, 1);
    assert.equal(store.estado.usos.length, 1);
    assert.equal(store.estado.reglas.length, 1);
});

test('PRODUCCION bloquea la limpieza de campañas', async () => {
    const store = escenarioDescuento();
    await assert.rejects(
        () => conAmbiente('PRODUCCION', async () => {
            const impacto = await descuentosImpacto.calcularImpactoEnTransaccion(store, 5, descuentoBase);
            assert.equal(impacto.limpiezaHabilitada, false);
            assert.equal(impacto.eliminable, false);
            return descuentosImpacto.eliminarDescuentoConDependencias(store, impacto);
        }),
        (error) => error.message === 'AMBIENTE_PRODUCCION' && error.statusCode === 409
    );
    assert.equal(store.estado.descuentos.length, 2);
});

test('la autorización de entorno nunca viene del frontend', () => {
    const chips = require('fs').readFileSync(require.resolve('../services/faregas-chips-tipos-impacto.service'), 'utf8');
    const descuentos = require('fs').readFileSync(require.resolve('../services/faregas-descuentos-impacto.service'), 'utf8');
    for (const fuente of [chips, descuentos]) {
        assert.match(fuente, /permiteLimpiezaDeDatosDePrueba/);
        assert.doesNotMatch(fuente, /req\.(body|query|params)/);
        assert.doesNotMatch(fuente, /demo\s*===|ambiente\s*===\s*req/);
    }
    const rutas = require('fs').readFileSync(require.resolve('../routes/faregas-chips.routes'), 'utf8');
    assert.match(rutas, /router\.delete\('\/productos\/:id',permiso\('CHIPS_CONFIGURAR'\)/);
    const rutasDesc = require('fs').readFileSync(require.resolve('../routes/faregas-descuentos.routes'), 'utf8');
    assert.match(rutasDesc, /router\.delete\('\/:id', requireAdministrar/);
});

test('idList deduplica y filtra identificadores inválidos', () => {
    assert.deepEqual(idList([{ id: '3' }, { id: 3 }, { id: null }]), [3]);
});
