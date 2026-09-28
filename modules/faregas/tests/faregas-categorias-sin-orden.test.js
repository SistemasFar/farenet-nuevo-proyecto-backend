/**
 * Retirada del campo "Orden" de Categorías (FAREGAS → Configuración → Catálogo).
 *
 * Contexto: `fg_categoria_servicio.orden` permitia que el usuario definiera a
 * mano el orden de las categorías. Se deja de gestionar, pero la COLUMNA se conserva
 * porque Catálogo, Tarifas y Descuentos ordenan por `c.orden` para agrupar los
 * servicios de cada categoría. Estos tests fijan las dos caras de esa decisión:
 *
 *   - el usuario ya no ve, envía ni define el orden;
 *   - el valor interno sigue existiendo y NO se resetea al editar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
if (USA_BASE_DE_DATOS) {
    require('../../../config/env-loader').loadEnv(true);
}

const db = require('../../../config/database');
const config = require('../services/faregas-config.service');

const fuente = (relativa) => fs.readFileSync(path.join(__dirname, '..', relativa), 'utf8');

const SERVICE = fuente(path.join('services', 'faregas-config.service.js'));
const CONTROLLER = fuente(path.join('controllers', 'faregas-config.controller.js'));

const SIN_COMENTARIOS = (t) => t.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const codigo = (t) => SIN_COMENTARIOS(t);

const USUARIO = 'gibarra';
const IP = '127.0.0.1';
const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';
const CATEGORIAS_REALES = ['GLP', 'GNV', 'CONFORMIDAD', 'COMPLEMENTARIOS'];

/** Bloque fuente de un export, acotado hasta el siguiente `exports.`. */
const bloqueDe = (fuenteTexto, desde) => {
    const inicio = fuenteTexto.indexOf(desde);
    assert.notEqual(inicio, -1, `no se encontro ${desde}`);
    const fin = fuenteTexto.indexOf('\nexports.', inicio + desde.length);
    return fin === -1 ? fuenteTexto.slice(inicio) : fuenteTexto.slice(inicio, fin);
};

const conBase = (fn) => (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
    return fn(t);
};

// ===========================================================================
// 1. El listado ya no expone `orden` y tiene un orden estable
// ===========================================================================

test('1. el listado NO selecciona la columna orden', () => {
    const bloque = bloqueDe(SERVICE, 'exports.getCategorias = async');
    assert.doesNotMatch(codigo(bloque), /c\.orden/,
        'getCategorias no debe devolver `orden` al frontend');
});

test('2. el listado ordena por un criterio estable, no por el id físico', () => {
    const bloque = bloqueDe(SERVICE, 'exports.getCategorias = async');
    assert.match(bloque, /ORDER BY c\.codigo ASC/,
        'debe ordenar por codigo, que es la clave de negocio inmutable');
    assert.doesNotMatch(bloque, /ORDER BY c\.orden/);
    assert.doesNotMatch(bloque, /ORDER BY c\.id/, 'no debe depender del id físico');
});

test('3. el listado sale ordenado de forma predecible', conBase(async () => {
    const lista = await config.getCategorias({});
    const codigos = lista.map((c) => c.codigo);
    assert.deepEqual(codigos, [...codigos].sort(),
        'los códigos deben venir en orden ascendente');
    // Ninguna de las categorías reales se pierde.
    for (const c of CATEGORIAS_REALES) {
        assert.ok(codigos.includes(c), `no se perdió la categoría ${c}`);
    }
}));

// ===========================================================================
// 2. Crear sin `orden`
// ===========================================================================

test('4. crear categoría NO acepta `orden` desde el body', () => {
    const bloque = bloqueDe(CONTROLLER, 'exports.crearCategoria = async');
    assert.doesNotMatch(codigo(bloque), /orden/,
        'el controller no debe leer ni reenviar `orden`');
});

test('5. crear categoría SIN enviar orden funciona y calcula uno interno', conBase(async () => {
    const codigoNuevo = 'TEST_SIN_ORDEN';
    let id;
    try {
        // Sin `orden` en el payload: es exactamente lo que hará el frontend.
        id = await config.crearCategoria(
            { codigo: codigoNuevo, nombre: 'Test sin orden', descripcion: null },
            USUARIO, IP
        );
        const creada = await db.query(
            'SELECT codigo, nombre, orden FROM fg_categoria_servicio WHERE id = $1', [id]);
        assert.equal(creada.rows[0].codigo, codigoNuevo);
        assert.equal(creada.rows[0].nombre, 'Test sin orden');
        // El valor interno sigue existiendo: se calcula, no lo pide el usuario.
        assert.ok(Number.isInteger(creada.rows[0].orden),
            'debe asignar un orden interno numérico');
    } finally {
        if (id) await db.query('DELETE FROM fg_categoria_servicio WHERE id = $1', [id]);
    }
}));

test('6. la nueva categoría queda al final del grupo interno', () => {
    const bloque = codigo(bloqueDe(SERVICE, 'exports.crearCategoria = async'));
    assert.match(bloque, /COALESCE\(MAX\(orden\), 0\) \+ 10/,
        'el orden interno se deriva del máximo, para que la nueva quede al final');
    assert.doesNotMatch(bloque, /\$4/, 'no debe haber un cuarto parámetro para el orden');
});

test('7. si el cliente manda `orden`, se ignora', conBase(async () => {
    const codigoNuevo = 'TEST_ORDEN_IGNORADO';
    let id;
    try {
        // Aunque un cliente antiguo siga mandando el campo, no debe ganar.
        id = await config.crearCategoria(
            { codigo: codigoNuevo, nombre: 'Test orden ignorado', descripcion: null, orden: 1 },
            USUARIO, IP
        );
        const creada = await db.query('SELECT orden FROM fg_categoria_servicio WHERE id = $1', [id]);
        assert.notEqual(creada.rows[0].orden, 1, 'el valor enviado por el cliente debe descartarse');
    } finally {
        if (id) await db.query('DELETE FROM fg_categoria_servicio WHERE id = $1', [id]);
    }
}));

// ===========================================================================
// 3. Editar sin `orden` — el riesgo real: resetearlo a 0
// ===========================================================================

test('8. editar NO toca la columna orden', () => {
    const bloque = codigo(bloqueDe(SERVICE, 'exports.editarCategoria = async'));
    const set = /SET[\s\S]*?WHERE/.exec(bloque);
    assert.ok(set, 'no se encontró el SET del UPDATE');
    assert.doesNotMatch(set[0], /orden/,
        'el UPDATE no debe asignar `orden`: si lo hiciera, editar sin el campo lo pondría en 0');
});

test('9. editar sin `orden` conserva el valor interno', conBase(async () => {
    const codigoNuevo = 'TEST_EDITAR_ORDEN';
    let id;
    let ordenOriginal;
    try {
        id = await config.crearCategoria(
            { codigo: codigoNuevo, nombre: 'Test editar', descripcion: null }, USUARIO, IP);
        const antes = await db.query('SELECT orden FROM fg_categoria_servicio WHERE id = $1', [id]);
        ordenOriginal = antes.rows[0].orden;

        await config.editarCategoria(id, { nombre: 'Test editar renombrado', descripcion: 'd' }, USUARIO, IP);
        const despues = await db.query(
            'SELECT nombre, descripcion, orden FROM fg_categoria_servicio WHERE id = $1', [id]);
        assert.equal(despues.rows[0].nombre, 'Test editar renombrado');
        assert.equal(despues.rows[0].descripcion, 'd');
        assert.equal(despues.rows[0].orden, ordenOriginal,
            'editar sin `orden` no debe alterar el valor interno');
    } finally {
        if (id) await db.query('DELETE FROM fg_categoria_servicio WHERE id = $1', [id]);
    }
}));

test('10. el controller de editar tampoco acepta `orden`', () => {
    const bloque = codigo(bloqueDe(CONTROLLER, 'exports.editarCategoria = async'));
    assert.doesNotMatch(bloque, /orden/);
});

// ===========================================================================
// 4. La columna se conserva porque otras pantallas dependen de ella
// ===========================================================================

test('11. el servicio sigue manteniendo la columna poblada', () => {
    // Catálogo, Tarifas y Descuentos ordenan por `c.orden` para agrupar.
    const bloque = codigo(bloqueDe(SERVICE, 'exports.crearCategoria = async'));
    assert.match(bloque, /INSERT INTO fg_categoria_servicio/);
    assert.match(bloque, /COALESCE\(MAX\(orden\), 0\)/);
});

test('12. NO se eliminó el ordenamiento por categoría de otras pantallas', () => {
    // Invariante real: la categoría sigue participando en el orden de los
    // servicios. No se exige que vaya SIEMPRE primero, porque el catálogo
    // ordena `s.orden, c.orden` (servicio y luego categoría) mientras que
    // tarifas y descuentos usan `c.orden, s.orden`: ambas reglas son válidas.
    const clausulas = (texto) => [...codigo(texto).matchAll(/ORDER BY([^;`]+)/g)]
        .map((m) => m[1])
        .filter((c) => /\bs\.orden\b/.test(c));

    const archivos = [
        ['catalogo', SERVICE],
        ['tarifas', fuente(path.join('services', 'faregas-tarifas.service.js'))],
        ['tarifas-admin', fuente(path.join('services', 'faregas-tarifas-admin.service.js'))],
        ['descuentos', fuente(path.join('services', 'faregas-descuentos.service.js'))]
    ];
    for (const [nombre, texto] of archivos) {
        const porServicio = clausulas(texto);
        assert.ok(porServicio.length > 0, `${nombre} deberia tener ORDER BY por servicio`);
        for (const c of porServicio) {
            assert.match(c, /\bc\.orden\b/,
                `${nombre}: al ordenar por servicio debe seguir pesando la categoria, se vio: ${c.trim()}`);
        }
    }
});

test('13. no se tocó el esquema: no hay DROP COLUMN ni ALTER TABLE', () => {
    const todo = SERVICE + CONTROLLER;
    assert.doesNotMatch(todo, /DROP\s+COLUMN/i);
    assert.doesNotMatch(todo, /ALTER\s+TABLE/i);
});

// ===========================================================================
// 5. Las categorías existentes no se tocan
// ===========================================================================

test('14. las categorías reales conservan sus datos', conBase(async () => {
    const filas = await db.query(
        'SELECT codigo, nombre, descripcion, activo, orden FROM fg_categoria_servicio ORDER BY codigo');
    for (const c of CATEGORIAS_REALES) {
        const fila = filas.rows.find((r) => r.codigo === c);
        assert.ok(fila, `sigue existiendo ${c}`);
        assert.ok(fila.nombre, `${c} conserva su nombre`);
    }
    // El orden interno histórico se respeta: es lo que usan Catálogo y Tarifas.
    const ordenes = filas.rows.filter((r) => CATEGORIAS_REALES.includes(r.codigo)).map((r) => r.orden);
    assert.ok(ordenes.every((o) => Number(o) > 0),
        'las categorías existentes conservan su orden interno original');
}));

test('15. no se rompen los servicios vinculados', conBase(async () => {
    const vinculos = await db.query(`
        SELECT c.codigo, COUNT(s.id)::int AS servicios
        FROM fg_categoria_servicio c
        LEFT JOIN fg_servicio s ON s.categoria_id = c.id
        WHERE c.codigo = ANY($1::varchar[])
        GROUP BY c.codigo ORDER BY c.codigo
    `, [CATEGORIAS_REALES]);
    const total = vinculos.rows.reduce((a, r) => a + r.servicios, 0);
    assert.ok(total > 0, 'las categorías reales siguen teniendo servicios vinculados');
}));

// ===========================================================================
// 6. Activar/desactivar y eliminar conservan sus reglas
// ===========================================================================

test('16. activar y desactivar siguen funcionando', conBase(async () => {
    const codigoNuevo = 'TEST_ACTIVO';
    let id;
    try {
        id = await config.crearCategoria(
            { codigo: codigoNuevo, nombre: 'Test activo', descripcion: null }, USUARIO, IP);
        await config.cambiarEstadoCategoria(id, false, USUARIO, IP);
        let fila = await db.query('SELECT activo, orden FROM fg_categoria_servicio WHERE id = $1', [id]);
        assert.equal(fila.rows[0].activo, false);
        assert.ok(Number.isInteger(fila.rows[0].orden), 'desactivar no debe tocar el orden interno');

        await config.cambiarEstadoCategoria(id, true, USUARIO, IP);
        fila = await db.query('SELECT activo FROM fg_categoria_servicio WHERE id = $1', [id]);
        assert.equal(fila.rows[0].activo, true);
    } finally {
        if (id) await db.query('DELETE FROM fg_categoria_servicio WHERE id = $1', [id]);
    }
}));

test('17. eliminar conserva las reglas actuales', conBase(async () => {
    const codigoNuevo = 'TEST_ELIMINAR';
    let id;
    try {
        id = await config.crearCategoria(
            { codigo: codigoNuevo, nombre: 'Test eliminar', descripcion: null }, USUARIO, IP);
        await config.eliminarCategoria(id, USUARIO, IP);
        const fila = await db.query('SELECT id FROM fg_categoria_servicio WHERE id = $1', [id]);
        assert.equal(fila.rowCount, 0, 'la categoría debe quedar eliminada');
    } finally {
        if (id) await db.query('DELETE FROM fg_categoria_servicio WHERE id = $1', [id]);
    }
}));

test('18. el listado de solo activas sigue funcionando', conBase(async () => {
    const todas = await config.getCategorias({});
    const activas = await config.getCategorias({ soloActivas: true });
    assert.ok(activas.length <= todas.length);
    assert.ok(activas.every((c) => c.activo === true));
}));
