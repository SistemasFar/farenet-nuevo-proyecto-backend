const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = require('../../../config/database');
const configService = require('../services/faregas-config.service');
const categoriasImpactoService = require('../services/faregas-categorias-impacto.service');

const normalizar = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const clonar = (valor) => valor === undefined ? undefined : JSON.parse(JSON.stringify(valor));

class FakeCategoriaStore {
    constructor({ categorias = [], productos = [] } = {}) {
        this.state = {
            categorias: clonar(categorias),
            productos: clonar(productos)
        };
        this.log = [];
        this.snapshot = null;
        this.failOn = null;
    }

    crearCliente() {
        const store = this;
        return {
            async query(sqlCrudo, params = []) {
                const sql = normalizar(sqlCrudo);
                store.log.push({ sql, params: [...params] });
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
                    throw new Error('FALLO_SIMULADO');
                }

                if (/SELECT \* FROM fg_categoria_servicio WHERE id = \$1 FOR UPDATE/.test(sql)) {
                    const row = store.state.categorias.find((categoria) => Number(categoria.id) === Number(params[0]));
                    return { rowCount: row ? 1 : 0, rows: row ? [clonar(row)] : [] };
                }
                if (/UPDATE fg_producto_facturacion/.test(sql)) {
                    store.state.productos.forEach((producto) => {
                        if (Number(producto.categoria_id) === Number(params[0])) producto.categoria_id = null;
                    });
                    return { rowCount: 1, rows: [] };
                }
                if (/DELETE FROM fg_categoria_servicio WHERE id = \$1/.test(sql)) {
                    const before = store.state.categorias.length;
                    store.state.categorias = store.state.categorias.filter(
                        (categoria) => Number(categoria.id) !== Number(params[0])
                    );
                    return { rowCount: before - store.state.categorias.length, rows: [] };
                }
                throw new Error(`Consulta no simulada: ${sql}`);
            },
            release() {}
        };
    }
}

const impactoVacio = (overrides = {}) => ({
    categoria: { id: 7, codigo: 'TEST_CAT', nombre: 'TEST_CAT' },
    requiereConfirmacion: false,
    eliminable: true,
    servicios: [],
    tarifas: [],
    reglasConfiguracion: [],
    operaciones: [],
    operacionesBloqueadas: [],
    certificados: [],
    certificadosAEliminar: [],
    certificadosPreservados: [],
    facturaciones: [],
    ordenesPago: [],
    pagos: [],
    formatos: [],
    productos: [],
    productosPreservados: [],
    ...overrides
});

const ejecutarConStore = async (store, impacto, accion, { fallarLimpieza = false } = {}) => {
    const originales = {
        connect: db.connect,
        registrarAuditoria: configService.registrarAuditoria,
        calcular: categoriasImpactoService.calcularImpactoEnTransaccion,
        eliminar: categoriasImpactoService.eliminarServiciosYDependencias
    };
    const llamadas = { limpieza: [] };
    db.connect = async () => store.crearCliente();
    configService.registrarAuditoria = async () => {};
    categoriasImpactoService.calcularImpactoEnTransaccion = async () => impacto;
    categoriasImpactoService.eliminarServiciosYDependencias = async (client, recibido) => {
        llamadas.limpieza.push(recibido);
        if (fallarLimpieza) throw new Error('FALLO_A_MITAD');
        return {
            serviciosEliminados: recibido.servicios.length,
            tarifasEliminadas: recibido.tarifas.length,
            reglasEliminadas: recibido.reglasConfiguracion.length,
            operacionesEliminadas: 0,
            certificadosEliminados: 0,
            detalle: {}
        };
    };
    try {
        return { resultado: await accion(), llamadas };
    } finally {
        db.connect = originales.connect;
        configService.registrarAuditoria = originales.registrarAuditoria;
        categoriasImpactoService.calcularImpactoEnTransaccion = originales.calcular;
        categoriasImpactoService.eliminarServiciosYDependencias = originales.eliminar;
    }
};

const categoriaBase = { id: 7, codigo: 'TEST_CAT', nombre: 'TEST_CAT', descripcion: null, activo: true, orden: 0 };
const confirmar = { confirmarTodo: true };

test('1. categoría sin servicios: borra en una sola transacción', async () => {
    const store = new FakeCategoriaStore({ categorias: [categoriaBase] });
    const { resultado } = await ejecutarConStore(store, impactoVacio(), () => configService.eliminarCategoria(7, 'TEST', '127.0.0.1'));

    assert.equal(resultado.categoriaEliminada.codigo, 'TEST_CAT');
    assert.equal(resultado.productosDesvinculados, 0);
    assert.equal(resultado.serviciosEliminados, 0);
    assert.equal(store.state.categorias.length, 0);
    assert.ok(store.log.some(({ sql }) => sql === 'COMMIT'));
    assert.ok(!store.log.some(({ sql }) => sql === 'ROLLBACK'));
});

test('2. categoría con un servicio: exige confirmación antes de tocar nada', async () => {
    const store = new FakeCategoriaStore({ categorias: [categoriaBase] });
    const impacto = impactoVacio({
        requiereConfirmacion: true,
        servicios: [{ id: 9, codigo: 'SVC', nombre: 'Servicio' }]
    });

    await assert.rejects(
        () => ejecutarConStore(store, impacto, () => configService.eliminarCategoria(7, 'TEST', '127.0.0.1')),
        (error) => error.message === 'CONFIRMAR_IMPACTO_CATEGORIA' && error.detalles.impacto === impacto
    );
    assert.equal(store.state.categorias.length, 1);
    assert.ok(store.log.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(!store.log.some(({ sql }) => /DELETE FROM/.test(sql)));
});

test('3. categoría con un servicio confirmado: servicio + configuración + categoría eliminados', async () => {
    const store = new FakeCategoriaStore({ categorias: [categoriaBase] });
    const impacto = impactoVacio({
        requiereConfirmacion: true,
        servicios: [{ id: 9, codigo: 'SVC', nombre: 'Servicio' }],
        tarifas: [{ id: 20, servicio_id: 9, planta_key: '190', codigo: 'SVC' }],
        reglasConfiguracion: [{ id: 30, servicio_id: 9, planta_key: '190' }]
    });

    const { resultado, llamadas } = await ejecutarConStore(
        store, impacto, () => configService.eliminarCategoria(7, 'TEST', '127.0.0.1', confirmar)
    );

    assert.equal(llamadas.limpieza.length, 1);
    assert.equal(resultado.serviciosEliminados, 1);
    assert.equal(resultado.tarifasEliminadas, 1);
    assert.equal(resultado.reglasEliminadas, 1);
    assert.equal(store.state.categorias.length, 0);
    assert.ok(store.log.some(({ sql }) => sql === 'COMMIT'));
});

test('4. categoría con varios servicios: todos sus servicios se limpian juntos', async () => {
    const store = new FakeCategoriaStore({ categorias: [categoriaBase] });
    const impacto = impactoVacio({
        requiereConfirmacion: true,
        servicios: [
            { id: 9, codigo: 'A', nombre: 'A' },
            { id: 10, codigo: 'B', nombre: 'B' },
            { id: 11, codigo: 'C', nombre: 'C' }
        ],
        tarifas: [
            { id: 20, servicio_id: 9, planta_key: '190', codigo: 'A' },
            { id: 21, servicio_id: 10, planta_key: '190', codigo: 'B' }
        ],
        reglasConfiguracion: [
            { id: 30, servicio_id: 9, planta_key: '190' },
            { id: 31, servicio_id: 11, planta_key: '201' }
        ]
    });

    const { resultado, llamadas } = await ejecutarConStore(
        store, impacto, () => configService.eliminarCategoria(7, 'TEST', '127.0.0.1', confirmar)
    );

    assert.equal(llamadas.limpieza[0].servicios.length, 3);
    assert.equal(resultado.serviciosEliminados, 3);
    assert.equal(resultado.tarifasEliminadas, 2);
    assert.equal(resultado.reglasEliminadas, 2);
    assert.equal(store.state.categorias.length, 0);
});

test('6. producto fiscal vinculado se conserva y queda sin categoría', async () => {
    const store = new FakeCategoriaStore({
        categorias: [categoriaBase],
        productos: [
            { id: 1, codigo_sku: 'AAA', descripcion: 'Producto A', categoria_id: 7 },
            { id: 2, codigo_sku: 'BBB', descripcion: 'Producto B', categoria_id: 7 }
        ]
    });
    const impacto = impactoVacio({
        requiereConfirmacion: true,
        servicios: [{ id: 9, codigo: 'SVC', nombre: 'Servicio' }],
        productos: [
            { id: 1, codigo_sku: 'AAA', descripcion: 'Producto A' },
            { id: 2, codigo_sku: 'BBB', descripcion: 'Producto B' }
        ],
        productosPreservados: [1, 2]
    });

    const { resultado } = await ejecutarConStore(
        store, impacto, () => configService.eliminarCategoria(7, 'TEST', '127.0.0.1', confirmar)
    );

    assert.equal(resultado.productosDesvinculados, 2);
    assert.equal(resultado.serviciosEliminados, 1);
    assert.equal(store.state.productos.length, 2);
    assert.ok(store.state.productos.every((producto) => producto.categoria_id === null));
    assert.ok(!store.log.some(({ sql }) => /DELETE FROM fg_producto_facturacion/.test(sql)));
});

test('9. fallo durante la limpieza de servicios: ROLLBACK completo', async () => {
    const store = new FakeCategoriaStore({
        categorias: [categoriaBase],
        productos: [{ id: 1, codigo_sku: 'AAA', descripcion: 'Producto A', categoria_id: 7 }]
    });
    const impacto = impactoVacio({
        requiereConfirmacion: true,
        servicios: [{ id: 9, codigo: 'SVC', nombre: 'Servicio' }],
        productos: [{ id: 1, codigo_sku: 'AAA', descripcion: 'Producto A' }]
    });

    await assert.rejects(
        () => ejecutarConStore(
            store,
            impacto,
            () => configService.eliminarCategoria(7, 'TEST', '127.0.0.1', confirmar),
            { fallarLimpieza: true }
        ),
        (error) => error.message === 'FALLO_A_MITAD'
    );

    assert.equal(store.state.categorias.length, 1);
    assert.equal(store.state.productos[0].categoria_id, 7);
    assert.ok(store.log.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(!store.log.some(({ sql }) => sql === 'COMMIT'));
    assert.ok(!store.log.some(({ sql }) => /DELETE FROM fg_categoria_servicio/.test(sql)));
    assert.ok(!store.log.some(({ sql }) => /UPDATE fg_producto_facturacion/.test(sql)));
});

test('error controlado cuando la categoría no existe', async () => {
    const store = new FakeCategoriaStore({ categorias: [] });
    await assert.rejects(
        () => ejecutarConStore(store, impactoVacio(), () => configService.eliminarCategoria(7, 'TEST', '127.0.0.1')),
        (error) => error.message === 'CATEGORIA_NO_ENCONTRADA'
    );
    assert.ok(store.log.some(({ sql }) => sql === 'ROLLBACK'));
});

test('el flujo usa la misma papelera: no se agregan rutas ni permisos nuevos', () => {
    const rutas = fs.readFileSync(require.resolve('../routes/faregas-config.routes'), 'utf8');
    assert.match(rutas, /router\.delete\('\/categorias\/:id', requireConfigCategoriasPerm, configController\.eliminarCategoria\)/);
    assert.match(rutas, /router\.get\('\/categorias\/:id\/impacto', requireConfigCategoriasPerm, configController\.obtenerImpactoCategoria\)/);
    const borrados = [...rutas.matchAll(/router\.delete\('\/categorias\/:id'/g)];
    assert.equal(borrados.length, 1);
});

test('la limpieza de categorías no toca correlativos, series ni productos', () => {
    const fuente = fs.readFileSync(require.resolve('../services/faregas-categorias-impacto.service'), 'utf8');
    assert.doesNotMatch(fuente, /fg_correlativo_certificado|fg_serie_comprobante|fg_secuencia/);
    assert.doesNotMatch(fuente, /DELETE FROM fg_producto_facturacion/);
    assert.doesNotMatch(fuente, /DROP CONSTRAINT|ADD CONSTRAINT|ALTER TABLE/i);
    assert.doesNotMatch(fuente, /DELETE FROM fg_certificado_formato|UPDATE fg_certificado_formato|DELETE FROM fg_certificado_formato_version/);
});

test('el listado de categorías ya no devuelve la categoría eliminada', async () => {
    const store = new FakeCategoriaStore({ categorias: [categoriaBase] });
    await ejecutarConStore(store, impactoVacio(), () => configService.eliminarCategoria(7, 'TEST', '127.0.0.1'));

    const originalQuery = db.query;
    db.query = async (sql) => {
        assert.match(sql, /FROM fg_categoria_servicio c/);
        return { rows: store.state.categorias };
    };
    try {
        const categorias = await configService.getCategorias();
        assert.equal(categorias.length, 0);
    } finally {
        db.query = originalQuery;
    }
});
