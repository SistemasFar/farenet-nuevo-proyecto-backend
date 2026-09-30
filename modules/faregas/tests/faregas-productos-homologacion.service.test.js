const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const configService = require('../services/faregas-config.service');
const productosService = require('../services/faregas-productos.service');

const normalizar = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const clonar = (valor) => JSON.parse(JSON.stringify(valor));

class FakeHomologacionStore {
    constructor({ productos, categorias }) {
        this.productos = clonar(productos);
        this.categorias = clonar(categorias);
        this.log = [];
        this.auditorias = [];
        this.snapshot = null;
    }

    cliente() {
        const store = this;
        return {
            async query(sqlCrudo, params = []) {
                const sql = normalizar(sqlCrudo);
                store.log.push({ sql, params: clonar(params) });

                if (sql === 'BEGIN') {
                    store.snapshot = clonar(store.productos);
                    return { rowCount: 0, rows: [] };
                }
                if (sql === 'COMMIT') {
                    store.snapshot = null;
                    return { rowCount: 0, rows: [] };
                }
                if (sql === 'ROLLBACK') {
                    if (store.snapshot) store.productos = store.snapshot;
                    store.snapshot = null;
                    return { rowCount: 0, rows: [] };
                }
                if (sql.startsWith('SELECT id, codigo, nombre FROM fg_categoria_servicio')) {
                    const rows = store.categorias.filter((categoria) =>
                        Number(categoria.id) === Number(params[0]) && categoria.activo === true
                    );
                    return { rowCount: rows.length, rows: clonar(rows) };
                }
                if (sql.startsWith('SELECT * FROM fg_producto_facturacion WHERE id = ANY')) {
                    const ids = new Set(params[0].map(Number));
                    const rows = store.productos
                        .filter((producto) => ids.has(Number(producto.id)))
                        .sort((a, b) => Number(a.id) - Number(b.id));
                    return { rowCount: rows.length, rows: clonar(rows) };
                }
                if (sql.startsWith('UPDATE fg_producto_facturacion SET categoria_id = $1')) {
                    const [categoriaId, productoId, categoriaAnterior] = params;
                    const producto = store.productos.find((fila) => Number(fila.id) === Number(productoId));
                    const coincide = producto
                        && (producto.categoria_id === categoriaAnterior
                            || (producto.categoria_id == null && categoriaAnterior == null));
                    if (!coincide) return { rowCount: 0, rows: [] };
                    producto.categoria_id = categoriaId;
                    return { rowCount: 1, rows: [] };
                }
                throw new Error(`Consulta no simulada: ${sql}`);
            },
            release() {}
        };
    }
}

const ejecutarConStore = async (store, accion) => {
    const connectOriginal = db.connect;
    const auditoriaOriginal = configService.registrarAuditoria;
    db.connect = async () => store.cliente();
    configService.registrarAuditoria = async (_client, auditoria) => {
        store.auditorias.push(clonar(auditoria));
    };
    try {
        return await accion();
    } finally {
        db.connect = connectOriginal;
        configService.registrarAuditoria = auditoriaOriginal;
    }
};

const categorias = [
    { id: 1, codigo: 'GLP', nombre: 'GLP', activo: true },
    { id: 2, codigo: 'GNV', nombre: 'GNV', activo: true },
    { id: 3, codigo: 'INACTIVA', nombre: 'Inactiva', activo: false }
];

const productos = [
    { id: 10, codigo_sku: 'GLP-1', descripcion: 'Certificado GLP', categoria_id: null, activo: true, precio_unitario: '80.00' },
    { id: 11, codigo_sku: 'GNV-1', descripcion: 'Certificado GNV', categoria_id: 2, activo: true, precio_unitario: '90.00' },
    { id: 12, codigo_sku: 'GLP-2', descripcion: 'Certificado GLP 2', categoria_id: null, activo: true, precio_unitario: '100.00' }
];

test('homologa solo categoria_id, omite coincidencias y audita cada cambio', async () => {
    const store = new FakeHomologacionStore({ productos, categorias });
    const resultado = await ejecutarConStore(store, () => productosService.actualizarCategoriasMasivas(
        [
            { producto_id: 10, categoria_id: 1 },
            { producto_id: 11, categoria_id: 2 },
            { producto_id: 12, categoria_id: 1 }
        ],
        'TEST',
        null,
        { esperadosActualizar: 2, esperadosYaCorrectos: 1 }
    ));

    assert.equal(resultado.actualizados, 2);
    assert.equal(resultado.ya_correctos, 1);
    assert.equal(resultado.auditorias, 2);
    assert.equal(store.auditorias.length, 2);
    assert.deepEqual(store.productos.map(({ categoria_id }) => categoria_id), [1, 2, 1]);
    assert.deepEqual(store.productos.map(({ precio_unitario }) => precio_unitario), ['80.00', '90.00', '100.00']);

    const updates = store.log.filter(({ sql }) => sql.startsWith('UPDATE fg_producto_facturacion'));
    assert.equal(updates.length, 2);
    assert.ok(updates.every(({ sql }) =>
        sql === 'UPDATE fg_producto_facturacion SET categoria_id = $1 WHERE id = $2 AND categoria_id IS NOT DISTINCT FROM $3::integer'
    ));
    assert.ok(store.log.some(({ sql }) => sql === 'COMMIT'));
});

test('revierte el lote si la categoría destino no está activa', async () => {
    const store = new FakeHomologacionStore({ productos, categorias });

    await assert.rejects(
        ejecutarConStore(store, () => productosService.actualizarCategoriasMasivas(
            [{ producto_id: 10, categoria_id: 3 }],
            'TEST',
            null,
            { esperadosActualizar: 1, esperadosYaCorrectos: 0 }
        )),
        /CATEGORIA_NO_DISPONIBLE/
    );

    assert.equal(store.productos[0].categoria_id, null);
    assert.equal(store.auditorias.length, 0);
    assert.ok(store.log.some(({ sql }) => sql === 'ROLLBACK'));
});

test('bloquea expresamente el SKU 1111112', async () => {
    const store = new FakeHomologacionStore({
        categorias,
        productos: [{ id: 99, codigo_sku: '1111112', descripcion: 'PRUEBA', categoria_id: null, activo: true }]
    });

    await assert.rejects(
        ejecutarConStore(store, () => productosService.actualizarCategoriasMasivas(
            [{ producto_id: 99, categoria_id: 1 }],
            'TEST',
            null,
            { esperadosActualizar: 1, esperadosYaCorrectos: 0 }
        )),
        /HOMOLOGACION_PRODUCTO_PRUEBA_BLOQUEADO/
    );

    assert.equal(store.productos[0].categoria_id, null);
    assert.ok(store.log.some(({ sql }) => sql === 'ROLLBACK'));
});
