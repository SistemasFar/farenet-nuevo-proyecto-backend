const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = require('../../../config/database');
const configService = require('../services/faregas-config.service');
const productosService = require('../services/faregas-productos.service');
const productosImpactoService = require('../services/faregas-productos-impacto.service');
const tarifasService = require('../services/faregas-tarifas.service');

const normalizar = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const clonar = (valor) => valor === undefined ? undefined : JSON.parse(JSON.stringify(valor));

const productoBase = {
    id: 25,
    codigo_sku: '0021',
    descripcion: 'CERTIFICACIÓN ANUAL DE GLP',
    activo: true
};

const snapshotBase = {
    codigo_sku_snapshot: '0021',
    descripcion_snapshot: 'CERTIFICACIÓN ANUAL DE GLP',
    unidad_snapshot: 'NIU',
    afectacion_igv_snapshot: '10',
    valor_unitario: '60.00',
    precio_unitario: '60.00',
    base_imponible: '50.85',
    igv: '9.15',
    importe_total: '60.00'
};

const crearDetalle = (id, operacion_id, producto_id, extra = {}) => ({
    id,
    operacion_id,
    producto_id,
    tipo_item: 'PRODUCTO',
    ...snapshotBase,
    ...extra
});

class FakeProductoStore {
    constructor({
        producto = productoBase,
        tarifas = [],
        detalles = [],
        certificados = [],
        productoSede = [],
        inventariables = [],
        inventariablesSede = [],
        servicios = [],
        mixtas = [],
        impacto = null
    } = {}) {
        this.state = {
            producto: producto ? clonar(producto) : null,
            tarifas: clonar(tarifas),
            detalles: clonar(detalles),
            certificados: clonar(certificados),
            productoSede: clonar(productoSede),
            inventariables: clonar(inventariables),
            inventariablesSede: clonar(inventariablesSede),
            servicios: clonar(servicios),
            mixtas: clonar(mixtas)
        };
        this.log = [];
        this.impacto = clonar(impacto);
        this.failOn = null;
        this.snapshot = null;
    }

    crearCliente() {
        const store = this;
        return {
            async query(sqlCrudo, params = []) {
                const sql = normalizar(sqlCrudo);
                store.log.push({ sql, params: clonar(params) });

                if (sql === 'BEGIN') {
                    store.snapshot = clonar(store.state);
                    return { rowCount: 0, rows: [] };
                }
                if (sql === 'COMMIT') {
                    store.snapshot = null;
                    return { rowCount: 0, rows: [] };
                }
                if (sql === 'ROLLBACK') {
                    if (store.snapshot) store.state = store.snapshot;
                    store.snapshot = null;
                    return { rowCount: 0, rows: [] };
                }
                if (store.failOn && sql.includes(store.failOn)) {
                    throw new Error(`FALLO_SIMULADO:${store.failOn}`);
                }

                if (/SELECT \* FROM fg_producto_facturacion WHERE id = \$1 FOR UPDATE/.test(sql)) {
                    return store.state.producto
                        ? { rowCount: 1, rows: [clonar(store.state.producto)] }
                        : { rowCount: 0, rows: [] };
                }

                if (/SELECT t\.id, t\.servicio_id, t\.activo,/.test(sql)
                    && /FROM fg_tarifa t/.test(sql)
                    && /producto_facturacion_id = \$1/.test(sql)) {
                    const rows = store.state.tarifas
                        .filter((tarifa) => Number(tarifa.producto_facturacion_id) === Number(params[0]))
                        .map((tarifa) => ({
                            id: tarifa.id,
                            servicio_id: tarifa.servicio_id,
                            activo: tarifa.activo,
                            tiene_historial: store.state.detalles.some((detalle) => Number(detalle.tarifa_id) === Number(tarifa.id))
                        }));
                    return { rowCount: rows.length, rows };
                }

                if (/SELECT t\.id, t\.servicio_id, t\.activo, t\.producto_facturacion_id,/.test(sql)
                    && /COALESCE\(pis\.producto_facturacion_id, pi\.producto_facturacion_id\) = \$1/.test(sql)) {
                    const rows = store.state.tarifas
                        .filter((tarifa) => tarifa.chip_dependiente === true)
                        .map((tarifa) => ({
                            id: tarifa.id,
                            servicio_id: tarifa.servicio_id,
                            activo: tarifa.activo,
                            producto_facturacion_id: tarifa.producto_facturacion_id,
                            tiene_historial: store.state.detalles.some((detalle) => Number(detalle.tarifa_id) === Number(tarifa.id))
                        }));
                    return { rowCount: rows.length, rows };
                }

                if (/SELECT od\.id, od\.operacion_id, od\.tipo_item,/.test(sql)
                    && /FROM fg_operacion_detalle od/.test(sql)
                    && /producto_facturacion_id = \$1/.test(sql)) {
                    const rows = store.state.detalles
                        .filter((detalle) => Number(detalle.producto_facturacion_id) === Number(params[0]))
                        .map((detalle) => ({ ...detalle }));
                    return { rowCount: rows.length, rows };
                }

                if (/SELECT od\.id, od\.operacion_id, od\.tipo_item,/.test(sql)
                    && /FROM fg_operacion_detalle od/.test(sql)
                    && /tarifa_id = ANY/.test(sql)) {
                    const targetIds = new Set((params[0] || []).map(Number));
                    const rows = store.state.detalles
                        .filter((detalle) => targetIds.has(Number(detalle.tarifa_id)))
                        .map((detalle) => ({ ...detalle }));
                    return { rowCount: rows.length, rows };
                }

                if (/SELECT id FROM fg_operacion_comercial WHERE id = ANY/.test(sql)) {
                    return { rowCount: (params[0] || []).length, rows: (params[0] || []).map((id) => ({ id })) };
                }

                if (/SELECT od\.operacion_id,/.test(sql) && /array_agg\(DISTINCT od\.producto_facturacion_id\)/.test(sql)) {
                    return { rowCount: store.state.mixtas.length, rows: clonar(store.state.mixtas) };
                }

                if (/SELECT c\.id, c\.estado,/.test(sql) && /FROM fg_certificado c/.test(sql)) {
                    const rows = store.state.certificados
                        .filter((certificado) => Number(certificado.producto_facturacion_certificado_id) === Number(params[0])
                            || Number(certificado.producto_facturacion_chip_id) === Number(params[0]))
                        .map((certificado) => ({
                            id: certificado.id,
                            estado: certificado.estado,
                            producto_facturacion_certificado_id: certificado.producto_facturacion_certificado_id,
                            producto_facturacion_chip_id: certificado.producto_facturacion_chip_id,
                            snapshot_completo: certificado.snapshot_completo === true
                        }));
                    return { rowCount: rows.length, rows };
                }

                if (/SELECT id FROM fg_producto_sede/.test(sql)) {
                    const rows = store.state.productoSede.filter((row) => Number(row.producto_facturacion_id) === Number(params[0]));
                    return { rowCount: rows.length, rows: clonar(rows) };
                }
                if (/SELECT id FROM fg_producto_inventariable_sede/.test(sql)) {
                    const rows = store.state.inventariablesSede.filter((row) => Number(row.producto_facturacion_id) === Number(params[0]));
                    return { rowCount: rows.length, rows: clonar(rows) };
                }
                if (/SELECT id FROM fg_producto_inventariable WHERE/.test(sql)) {
                    const rows = store.state.inventariables.filter((row) => Number(row.producto_facturacion_id) === Number(params[0]));
                    return { rowCount: rows.length, rows: clonar(rows) };
                }

                if (/UPDATE fg_operacion_detalle/.test(sql)) {
                    const targetProductId = Number(params[0]);
                    const targetTarifaIds = new Set((params[1] || []).map(Number));
                    const targetIds = new Set((params[2] || []).map(Number));
                    const affected = store.state.detalles.filter((detalle) => targetIds.has(Number(detalle.id)));
                    affected.forEach((detalle) => {
                        if (Number(detalle.producto_facturacion_id) === targetProductId) {
                            detalle.producto_facturacion_id = null;
                        }
                        if (targetTarifaIds.has(Number(detalle.tarifa_id))) {
                            detalle.tarifa_id = null;
                        }
                    });
                    return { rowCount: affected.length, rows: [] };
                }

                if (/UPDATE fg_certificado/.test(sql)) {
                    const targetId = Number(params[0]);
                    const targetIds = new Set((params[1] || []).map(Number));
                    const affected = store.state.certificados.filter((certificado) => targetIds.has(Number(certificado.id)));
                    affected.forEach((certificado) => {
                        if (Number(certificado.producto_facturacion_certificado_id) === targetId) {
                            certificado.producto_facturacion_certificado_id = null;
                        }
                        if (Number(certificado.producto_facturacion_chip_id) === targetId) {
                            certificado.producto_facturacion_chip_id = null;
                        }
                    });
                    return { rowCount: affected.length, rows: [] };
                }

                if (/DELETE FROM fg_tarifa WHERE id = ANY/.test(sql)) {
                    const targetIds = new Set((params[0] || []).map(Number));
                    const before = store.state.tarifas.length;
                    store.state.tarifas = store.state.tarifas.filter((tarifa) => !targetIds.has(Number(tarifa.id)));
                    return { rowCount: before - store.state.tarifas.length, rows: [] };
                }
                if (/UPDATE fg_tarifa/.test(sql)) {
                    const targetIds = new Set((params[0] || []).map(Number));
                    const affected = store.state.tarifas.filter((tarifa) => targetIds.has(Number(tarifa.id)));
                    affected.forEach((tarifa) => {
                        tarifa.producto_facturacion_id = null;
                        tarifa.activo = false;
                    });
                    return { rowCount: affected.length, rows: [] };
                }

                if (/DELETE FROM fg_producto_sede WHERE id = ANY/.test(sql)) {
                    const targetIds = new Set((params[0] || []).map(Number));
                    const before = store.state.productoSede.length;
                    store.state.productoSede = store.state.productoSede.filter((row) => !targetIds.has(Number(row.id)));
                    return { rowCount: before - store.state.productoSede.length, rows: [] };
                }
                if (/UPDATE fg_producto_inventariable_sede/.test(sql)) {
                    const targetIds = new Set((params[0] || []).map(Number));
                    const affected = store.state.inventariablesSede.filter((row) => targetIds.has(Number(row.id)));
                    affected.forEach((row) => { row.producto_facturacion_id = null; });
                    return { rowCount: affected.length, rows: [] };
                }
                if (/UPDATE fg_producto_inventariable/.test(sql)) {
                    const targetIds = new Set((params[0] || []).map(Number));
                    const affected = store.state.inventariables.filter((row) => targetIds.has(Number(row.id)));
                    affected.forEach((row) => { row.producto_facturacion_id = null; });
                    return { rowCount: affected.length, rows: [] };
                }

                if (/UPDATE fg_servicio s/.test(sql)) {
                    const targetIds = new Set((params[0] || []).map(Number));
                    const affected = store.state.servicios.filter((servicio) => {
                        if (!targetIds.has(Number(servicio.id)) || !servicio.activo) return false;
                        return !store.state.tarifas.some((tarifa) => Number(tarifa.servicio_id) === Number(servicio.id) && tarifa.activo);
                    });
                    affected.forEach((servicio) => { servicio.activo = false; });
                    return { rowCount: affected.length, rows: [] };
                }

                if (/DELETE FROM fg_producto_facturacion WHERE id = \$1/.test(sql)) {
                    if (!store.state.producto || Number(store.state.producto.id) !== Number(params[0])) {
                        return { rowCount: 0, rows: [] };
                    }
                    store.state.producto = null;
                    return { rowCount: 1, rows: [] };
                }

                throw new Error(`Consulta no simulada: ${sql}`);
            },
            release() {}
        };
    }
}

const ejecutarConStore = async (store, accion) => {
    const originales = {
        connect: db.connect,
        registrarAuditoria: configService.registrarAuditoria,
        calcularImpacto: productosImpactoService.calcularImpactoEnTransaccion,
        eliminarConjunto: productosImpactoService.eliminarOperacionesMixtas
    };
    db.connect = async () => store.crearCliente();
    configService.registrarAuditoria = async () => {};
    productosImpactoService.calcularImpactoEnTransaccion = async () => clonar(store.impacto || {
        requiereConfirmacionConjunto: false,
        operacionesMixtas: [],
        otrosProductos: []
    });
    productosImpactoService.eliminarOperacionesMixtas = async () => {
        if (typeof store.eliminarConjunto === 'function') return store.eliminarConjunto();
        return {
            operacionesEliminadas: 0,
            detallesEliminados: 0,
            facturacionesEliminadas: 0,
            ordenesPagoEliminadas: 0,
            pagosEliminados: 0,
            certificadosEliminados: 0,
            otrosProductosPreservados: []
        };
    };
    try {
        return await accion();
    } finally {
        db.connect = originales.connect;
        configService.registrarAuditoria = originales.registrarAuditoria;
        productosImpactoService.calcularImpactoEnTransaccion = originales.calcularImpacto;
        productosImpactoService.eliminarOperacionesMixtas = originales.eliminarConjunto;
    }
};

const detalleSeguro = (extra = {}) => ({
    ...crearDetalle(1, 10, 25),
    producto_facturacion_id: 25,
    tarifa_id: 50,
    ...extra
});

test('elimina un producto sin vínculos y devuelve el resumen', async () => {
    const store = new FakeProductoStore();
    const resultado = await ejecutarConStore(store, () => productosService.eliminar(25, 'TEST', '127.0.0.1'));

    assert.equal(resultado.productoEliminado.codigo_sku, '0021');
    assert.equal(resultado.tarifasEliminadas, 0);
    assert.equal(store.state.producto, null);
    assert.ok(store.log.some(({ sql }) => sql === 'COMMIT'));
});

test('elimina una tarifa sin historial y desactiva el servicio exclusivo', async () => {
    const store = new FakeProductoStore({
        tarifas: [{ id: 50, servicio_id: 7, producto_facturacion_id: 25, activo: true }],
        servicios: [{ id: 7, activo: true }]
    });
    const resultado = await ejecutarConStore(store, () => productosService.eliminar(25, 'TEST', '127.0.0.1'));

    assert.equal(resultado.tarifasEliminadas, 1);
    assert.equal(resultado.serviciosDesactivados, 1);
    assert.equal(store.state.tarifas.length, 0);
    assert.equal(store.state.servicios[0].activo, false);
});

test('elimina mappings por sede y desvincula chips sin borrar el tipo físico', async () => {
    const store = new FakeProductoStore({
        tarifas: [{ id: 60, servicio_id: 8, producto_facturacion_id: 99, chip_dependiente: true, activo: true }],
        servicios: [{ id: 8, activo: true }],
        productoSede: [{ id: 3, producto_facturacion_id: 25 }],
        inventariables: [{ id: 8, producto_facturacion_id: 25, codigo: 'CHIP' }],
        inventariablesSede: [{ id: 9, producto_inventariable_id: 8, producto_facturacion_id: 25 }]
    });
    const resultado = await ejecutarConStore(store, () => productosService.eliminar(25, 'TEST', '127.0.0.1'));

    assert.equal(resultado.tarifasEliminadas, 1);
    assert.equal(resultado.mappingsEliminados, 1);
    assert.equal(resultado.mappingsDesvinculados, 2);
    assert.equal(store.state.tarifas.length, 0);
    assert.equal(store.state.servicios[0].activo, false);
    assert.equal(store.state.inventariables[0].codigo, 'CHIP');
    assert.equal(store.state.inventariables[0].producto_facturacion_id, null);
    assert.equal(store.state.inventariablesSede[0].producto_facturacion_id, null);
});

test('conserva el servicio compartido con otra tarifa activa', async () => {
    const store = new FakeProductoStore({
        tarifas: [
            { id: 50, servicio_id: 7, producto_facturacion_id: 25, activo: true },
            { id: 51, servicio_id: 7, producto_facturacion_id: 99, activo: true }
        ],
        servicios: [{ id: 7, activo: true }]
    });
    const resultado = await ejecutarConStore(store, () => productosService.eliminar(25, 'TEST', '127.0.0.1'));

    assert.equal(resultado.serviciosDesactivados, 0);
    assert.equal(store.state.servicios[0].activo, true);
    assert.equal(store.state.tarifas[0].producto_facturacion_id, 99);
});

test('desvincula una operación exclusiva conservando sus snapshots', async () => {
    const store = new FakeProductoStore({
        tarifas: [{ id: 50, servicio_id: 7, producto_facturacion_id: 25, activo: true }],
        detalles: [detalleSeguro()],
        servicios: [{ id: 7, activo: true }]
    });
    const resultado = await ejecutarConStore(store, () => productosService.eliminar(25, 'TEST', '127.0.0.1'));

    assert.equal(resultado.operacionesDesvinculadas, 1);
    assert.equal(resultado.tarifasEliminadas, 1);
    assert.equal(resultado.tarifasDesvinculadas, 0);
    assert.equal(store.state.detalles[0].producto_facturacion_id, null);
    assert.equal(store.state.detalles[0].tarifa_id, null);
    assert.equal(store.state.detalles[0].descripcion_snapshot, 'CERTIFICACIÓN ANUAL DE GLP');
    assert.equal(store.state.tarifas.length, 0);
});

test('exige confirmar el conjunto cuando existe una operación mixta', async () => {
    const store = new FakeProductoStore({
        tarifas: [{ id: 50, servicio_id: 7, producto_facturacion_id: 25, activo: true }],
        detalles: [detalleSeguro()],
        mixtas: [{ operacion_id: 10, productos: [99] }],
        servicios: [{ id: 7, activo: true }],
        impacto: {
            requiereConfirmacionConjunto: true,
            operacionesMixtas: [{ id: 10, detalles: [{ id: 1 }], productos: [{ id: 25 }, { id: 99 }] }],
            otrosProductos: [{ id: 99, codigo_sku: 'X', descripcion: 'PRODUCTO X' }]
        }
    });

    await assert.rejects(
        () => ejecutarConStore(store, () => productosService.eliminar(25, 'TEST', '127.0.0.1')),
        (error) => error.message === 'CONFIRMAR_IMPACTO'
    );
    assert.equal(store.state.producto.id, 25);
    assert.equal(store.state.tarifas[0].producto_facturacion_id, 25);
    assert.ok(store.log.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(!store.log.some(({ sql }) => sql === 'COMMIT'));
});

test('elimina el conjunto mixto confirmado y conserva el otro producto en el catálogo', async () => {
    const store = new FakeProductoStore({
        tarifas: [{ id: 50, servicio_id: 7, producto_facturacion_id: 25, activo: true }],
        detalles: [detalleSeguro()],
        servicios: [{ id: 7, activo: true }],
        impacto: {
            requiereConfirmacionConjunto: true,
            operacionesMixtas: [{ id: 10, detalles: [{ id: 1 }], productos: [{ id: 25 }, { id: 99 }] }],
            otrosProductos: [{ id: 99, codigo_sku: 'X', descripcion: 'PRODUCTO X' }]
        }
    });
    store.eliminarConjunto = () => {
        store.state.detalles = [];
        return {
            operacionesEliminadas: 1,
            detallesEliminados: 1,
            facturacionesEliminadas: 0,
            ordenesPagoEliminadas: 0,
            pagosEliminados: 0,
            certificadosEliminados: 0,
            otrosProductosPreservados: [99]
        };
    };

    const resultado = await ejecutarConStore(store, () => productosService.eliminar(
        25, 'TEST', '127.0.0.1', { confirmarConjunto: true }
    ));

    assert.equal(resultado.conjuntoPrueba.operacionesEliminadas, 1);
    assert.deepEqual(resultado.conjuntoPrueba.otrosProductosPreservados, [99]);
    assert.equal(store.state.producto, null);
    assert.equal(store.state.tarifas.length, 0);
    assert.ok(store.log.some(({ sql }) => sql === 'COMMIT'));
});

test('desvincula certificados sólo con snapshot completo para históricos emitidos', async () => {
    const store = new FakeProductoStore({
        certificados: [
            { id: 80, estado: 'BORRADOR', producto_facturacion_certificado_id: 25, producto_facturacion_chip_id: 25 },
            { id: 81, estado: 'EMITIDO', producto_facturacion_certificado_id: 25, producto_facturacion_chip_id: null, snapshot_completo: true }
        ]
    });
    const resultado = await ejecutarConStore(store, () => productosService.eliminar(25, 'TEST', '127.0.0.1'));

    assert.equal(resultado.certificadosDesvinculados, 2);
    assert.equal(store.state.certificados[0].producto_facturacion_certificado_id, null);
    assert.equal(store.state.certificados[1].producto_facturacion_certificado_id, null);
});

test('bloquea un certificado emitido sin snapshot y no modifica nada', async () => {
    const store = new FakeProductoStore({
        certificados: [
            { id: 81, estado: 'EMITIDO', producto_facturacion_certificado_id: 25, producto_facturacion_chip_id: null, snapshot_completo: false }
        ]
    });
    await assert.rejects(
        () => ejecutarConStore(store, () => productosService.eliminar(25, 'TEST', '127.0.0.1')),
        (error) => error.message === 'CERTIFICADO_SIN_SNAPSHOT'
    );
    assert.equal(store.state.producto.id, 25);
    assert.ok(store.log.some(({ sql }) => sql === 'ROLLBACK'));
});

test('hace rollback completo si falla una escritura intermedia', async () => {
    const store = new FakeProductoStore({
        tarifas: [{ id: 50, servicio_id: 7, producto_facturacion_id: 25, activo: true }],
        detalles: [detalleSeguro()],
        servicios: [{ id: 7, activo: true }]
    });
    store.failOn = 'DELETE FROM fg_tarifa';

    await assert.rejects(() => ejecutarConStore(store, () => productosService.eliminar(25, 'TEST', '127.0.0.1')));
    assert.equal(store.state.producto.id, 25);
    assert.equal(store.state.tarifas[0].producto_facturacion_id, 25);
    assert.ok(store.log.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(!store.log.some(({ sql }) => sql === 'COMMIT'));
});

test('responde de forma controlada cuando el producto no existe', async () => {
    const store = new FakeProductoStore({ producto: null });
    await assert.rejects(
        () => ejecutarConStore(store, () => productosService.eliminar(25, 'TEST', '127.0.0.1')),
        (error) => error.message === 'PRODUCTO_NO_ENCONTRADO'
    );
    assert.ok(store.log.some(({ sql }) => sql === 'ROLLBACK'));
});

test('el listado de productos no devuelve el SKU después de eliminarlo', async () => {
    const store = new FakeProductoStore();
    await ejecutarConStore(store, () => productosService.eliminar(25, 'TEST', '127.0.0.1'));

    const originalQuery = db.query;
    db.query = async (sql) => {
        assert.match(sql, /FROM fg_producto_facturacion p/);
        return { rows: store.state.producto ? [store.state.producto] : [] };
    };
    try {
        const productos = await productosService.listar();
        assert.deepEqual(productos, []);
    } finally {
        db.query = originalQuery;
    }
});

test('mantiene el permiso existente de configuración de productos', () => {
    const fuente = fs.readFileSync(require.resolve('../routes/faregas-config.routes'), 'utf8');
    assert.match(fuente, /requireConfigProductosPerm/);
    assert.match(fuente, /router\.get\('\/productos\/:id\/impacto', requireConfigProductosPerm, productosController\.obtenerImpacto\)/);
    assert.match(fuente, /router\.delete\('\/productos\/:id', requireConfigProductosPerm, productosController\.eliminar\)/);
});

test('el catálogo de Nuevo Certificado no devuelve la tarjeta después de desactivar su tarifa', async () => {
    const queryable = {
        async query(sql) {
            if (/FROM fg_planta/.test(sql)) {
                return { rowCount: 1, rows: [{ key: '201', nombre: 'PRINCIPAL' }] };
            }
            assert.match(sql, /t\.activo = TRUE/);
            // Simula el GET después de la limpieza: la tarifa ya no está activa.
            return { rowCount: 0, rows: [] };
        }
    };

    const catalogo = await tarifasService.obtenerCatalogoPorPlanta('201', queryable);
    assert.deepEqual(catalogo.categorias, []);
});
