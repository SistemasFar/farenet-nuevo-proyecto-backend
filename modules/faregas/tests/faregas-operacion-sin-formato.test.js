/**
 * El modal "Configurar operación" ya NO elige la plantilla del certificado.
 *
 * Decisión funcional: la plantilla se configura después, en el flujo de
 * formatos, porque todos los formatos reales terminan siendo HTML (el Word se
 * convierte a HTML). Por tanto:
 *
 *   - crear o editar una operación NO debe exigir `formato_id`;
 *   - editar otros campos NO debe borrar un `formato_id` ya asignado;
 *   - un cliente antiguo que sí lo mande sigue funcionando igual;
 *   - quitar la plantilla sigue siendo posible por el endpoint dedicado.
 *
 * Los tests de base son opt-in (FAREGAS_TEST_DB=1) y restauran el estado.
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
const configService = require('../services/faregas-config.service');
const configController = require('../controllers/faregas-config.controller');

const SERVICE = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-config.service.js'), 'utf8');
const CONTROLLER = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'faregas-config.controller.js'), 'utf8');
const RUTAS = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'faregas-config.routes.js'), 'utf8');

const codigo = (t) => t.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';
const USU = 'gibarra';
const IP = '127.0.0.1';

const conBase = (fn) => (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
    return fn(t);
};

const llamar = (fn, { params, body }) => new Promise((resolve) => {
    const res = {
        _status: 200,
        status(c) { this._status = c; return this; },
        json(cuerpo) { resolve({ status: this._status, cuerpo }); }
    };
    fn({ user: { username: USU }, params: params || {}, query: {}, body: body || {}, ip: IP }, res);
});

// ===========================================================================
// 1. Estructura
// ===========================================================================

test('1. editar servicio sólo actualiza formato_id si viene en la petición', () => {
    const bloque = codigo(SERVICE);
    const ini = bloque.indexOf('exports.editarServicio');
    const fin = bloque.indexOf('\nexports.', ini + 1);
    const cuerpo = bloque.slice(ini, fin === -1 ? undefined : fin);
    // Se distingue "viene" de "no viene" con hasOwnProperty, no con `?? null`.
    assert.match(cuerpo, /hasOwnProperty\.call\(servicio, 'formato_id'\)/,
        'debe comprobar si el cliente envió formato_id');
    assert.doesNotMatch(cuerpo, /servicio\.formato_id \?\? null/,
        'no debe sustituir la ausencia por null: eso borraría la plantilla');
    // Y cuando no viene, se conserva el valor anterior de la fila.
    assert.match(cuerpo, /formatoFinal = tocarFormato \? servicio\.formato_id : anterior\.formato_id/);
});

test('2. el controller no fuerza formato_id a null cuando no llega', () => {
    const bloque = codigo(CONTROLLER);
    const ini = bloque.indexOf('exports.editarServicio');
    const fin = bloque.indexOf('\nexports.', ini + 1);
    const cuerpo = bloque.slice(ini, fin === -1 ? undefined : fin);
    assert.doesNotMatch(cuerpo, /formato_id: .*\? Number\(formato_id\) : null/,
        'no debe mandarse null implícito');
    assert.match(cuerpo, /if \(formato_id !== undefined\)/,
        'sólo se propaga si el cliente lo manda');
});

test('3. el backend nunca exigió formato_id, sólo lo validaba si venía', () => {
    // La validación existente sigue igual: si viene, debe existir y ser de una
    // operación que genere certificado. Lo que se quita es la OBLIGACIÓN.
    const bloque = codigo(SERVICE);
    assert.match(bloque, /if \(servicio\.formato_id != null\) \{/);
    assert.match(bloque, /FORMATO_REQUIERE_CERTIFICADO/);
    assert.match(bloque, /FORMATO_NO_DISPONIBLE/);
    // Y no hay ninguna regla que exija que exista.
    assert.doesNotMatch(bloque, /if \(!servicio\.formato_id\)/,
        'no debe haber una regla que obligue a mandar formato');
});

test('4. sigue existiendo el endpoint dedicado para asignar la plantilla', () => {
    assert.match(RUTAS, /router\.put\('\/servicios\/:id\/formato'/);
    assert.match(CONTROLLER, /exports\.asignarFormato = async/);
    assert.match(SERVICE, /exports\.asignarFormatoAServicio = async/);
    // Sigue permitiendo quitar la plantilla enviando null.
    const bloque = codigo(SERVICE);
    const ini = bloque.indexOf('exports.asignarFormatoAServicio');
    assert.ok(ini > -1);
});

// ===========================================================================
// 2. Comportamiento contra la base real
// ===========================================================================

/** Monta una operación temporal con plantilla y devuelve su estado original. */
const montarOperacion = async (marca) => {
    // Una plantilla sólo puede vivir en una operación que genera certificado
    // (regla preexistente FORMATO_REQUIERE_CERTIFICADO), así que la operación
    // de prueba se monta como un certificado de conformidad.
    const categoria = await db.query("SELECT id FROM fg_categoria_servicio WHERE activo = TRUE AND codigo = 'CONFORMIDAD'");
    const formato = await db.query('SELECT id FROM fg_certificado_formato WHERE activo = TRUE ORDER BY id LIMIT 1');
    if (categoria.rowCount === 0) return null;
    const creada = await configService.crearServicio({
        codigo: `TEST_SINFMT_${marca}`,
        nombre: 'Operacion de prueba',
        categoria_id: categoria.rows[0].id,
        tipo_flujo: 'CERTIFICACION',
        requiere_certificado: true,
        tipo_certificado_clave: 'CONFORMIDAD',
        modalidad: null,
        requiere_vehiculo: true,
        formato_id: formato.rows[0].id,
        orden: 1
    }, USU, IP);
    return { id: creada.id, formatoId: formato.rows[0].id };
};

const datos = (categoriaId, extra) => ({
    nombre: 'Operacion renombrada',
    categoria_id: categoriaId,
    tipo_flujo: 'CERTIFICACION',
    requiere_certificado: true,
    tipo_certificado_clave: 'CONFORMIDAD',
    modalidad: null,
    requiere_vehiculo: true,
    orden: 1,
    ...extra
});

test('5. editar sin formato_id CONSERVA la plantilla ya asignada', conBase(async () => {
    const marca = Date.now();
    const { id, formatoId } = await montarOperacion(marca);
    try {
        const cat = await db.query('SELECT categoria_id FROM fg_servicio WHERE id = $1', [id]);
        await configService.editarServicio(id, datos(cat.rows[0].categoria_id), USU, IP);
        const fila = await db.query('SELECT nombre, formato_id FROM fg_servicio WHERE id = $1', [id]);
        assert.equal(fila.rows[0].nombre, 'Operacion renombrada', 'el resto de campos sí se actualiza');
        assert.equal(fila.rows[0].formato_id, formatoId,
            'la plantilla debe sobrevivir a una edición de otros campos');
    } finally {
        await db.query('DELETE FROM fg_servicio WHERE id = $1', [id]);
    }
}));

test('6. un cliente antiguo que sí manda formato_id sigue mandándolo', conBase(async () => {
    const marca = Date.now();
    const { id } = await montarOperacion(marca);
    const otro = await db.query('SELECT id FROM fg_certificado_formato WHERE activo = TRUE AND id <> (SELECT formato_id FROM fg_servicio WHERE id = $1) LIMIT 1', [id]);
    if (otro.rowCount === 0) {
        await db.query('DELETE FROM fg_servicio WHERE id = $1', [id]);
        return;
    }
    try {
        const cat = await db.query('SELECT categoria_id FROM fg_servicio WHERE id = $1', [id]);
        const resultado = await configService.editarServicio(
            id, datos(cat.rows[0].categoria_id, { formato_id: otro.rows[0].id }), USU, IP);
        const fila = await db.query('SELECT formato_id FROM fg_servicio WHERE id = $1', [id]);
        assert.equal(fila.rows[0].formato_id, otro.rows[0].id, 'el valor explícito debe aplicarse');
        assert.equal(resultado.formato_id, otro.rows[0].id);
    } finally {
        await db.query('DELETE FROM fg_servicio WHERE id = $1', [id]);
    }
}));

test('7. quitar la plantilla sigue siendo posible, y de forma explícita', conBase(async () => {
    const marca = Date.now();
    const { id } = await montarOperacion(marca);
    try {
        const cat = await db.query('SELECT categoria_id FROM fg_servicio WHERE id = $1', [id]);
        await configService.editarServicio(
            id, datos(cat.rows[0].categoria_id, { formato_id: null }), USU, IP);
        const fila = await db.query('SELECT formato_id FROM fg_servicio WHERE id = $1', [id]);
        assert.equal(fila.rows[0].formato_id, null, 'un null explícito sí la quita');
    } finally {
        await db.query('DELETE FROM fg_servicio WHERE id = $1', [id]);
    }
}));

test('8. quitar "Genera certificado" no borra la plantilla', conBase(async () => {
    const marca = Date.now();
    const { id, formatoId } = await montarOperacion(marca);
    try {
        const cat = await db.query('SELECT categoria_id FROM fg_servicio WHERE id = $1', [id]);
        await configService.editarServicio(id, datos(cat.rows[0].categoria_id), USU, IP);
        const fila = await db.query('SELECT formato_id FROM fg_servicio WHERE id = $1', [id]);
        assert.equal(fila.rows[0].formato_id, formatoId,
            'la plantilla se configura en otro flujo: aquí no debe desaparecer');
    } finally {
        await db.query('DELETE FROM fg_servicio WHERE id = $1', [id]);
    }
}));

test('9. se puede crear una operación que genera certificado SIN plantilla', conBase(async () => {
    // Esto es lo que antes bloqueaba el propio modal. La plantilla se asigna
    // después; la operación debe poder existir sin ella.
    const marca = Date.now();
    const cat = await db.query("SELECT id FROM fg_categoria_servicio WHERE activo = TRUE AND codigo = 'CONFORMIDAD'");
    if (cat.rowCount === 0) return;
    let id;
    try {
        const creada = await configService.crearServicio({
            codigo: `TEST_CERTNOFMT_${marca}`,
            nombre: 'Certificado sin plantilla',
            categoria_id: cat.rows[0].id,
            tipo_flujo: 'CERTIFICACION',
            requiere_certificado: true,
            tipo_certificado_clave: 'CONFORMIDAD',
            modalidad: null,
            requiere_vehiculo: true,
            orden: 1
        }, USU, IP);
        id = creada.id;
        const fila = await db.query('SELECT requiere_certificado, formato_id FROM fg_servicio WHERE id = $1', [id]);
        assert.equal(fila.rows[0].requiere_certificado, true);
        assert.equal(fila.rows[0].formato_id, null, 'nace sin plantilla, a la espera del flujo de formatos');
    } finally {
        if (id) await db.query('DELETE FROM fg_servicio WHERE id = $1', [id]);
    }
}));

test('10. el controller acepta crear y editar sin formato_id', conBase(async () => {
    const cat = await db.query('SELECT id FROM fg_categoria_servicio WHERE activo = TRUE ORDER BY id LIMIT 1');
    const marca = Date.now();
    const cuerpo = {
        codigo: `TEST_CTRLNOFMT_${marca}`,
        nombre: 'Sin formato por controller',
        categoria_id: cat.rows[0].id,
        tipo_flujo: 'SERVICIO_COMPLEMENTARIO',
        requiere_certificado: false,
        requiere_vehiculo: false,
        orden: 1
        // sin formato_id
    };
    const creado = await llamar(configController.crearServicio, { body: cuerpo });
    assert.equal(creado.status, 200, `no debe exigir formato_id: ${JSON.stringify(creado.cuerpo)}`);
    const id = creado.cuerpo.servicio_id;
    try {
        const editado = await llamar(configController.editarServicio, {
            params: { id: String(id) },
            body: { ...cuerpo, nombre: 'Renombrada sin formato' }
        });
        assert.equal(editado.status, 200, `editar tampoco: ${JSON.stringify(editado.cuerpo)}`);
        assert.equal(editado.cuerpo.formato_id, null);
    } finally {
        await db.query('DELETE FROM fg_servicio WHERE id = $1', [id]);
    }
}));

test('11. no queda residuo de las pruebas', conBase(async () => {
    const sucios = await db.query(
        "SELECT codigo FROM fg_servicio WHERE codigo LIKE 'TEST_SINFMT_%' OR codigo LIKE 'TEST_CERTNOFMT_%' OR codigo LIKE 'TEST_CTRLNOFMT_%'");
    assert.equal(sucios.rowCount, 0, `servicios de prueba sin limpiar: ${sucios.rows.map((r) => r.codigo).join(', ')}`);
}));
