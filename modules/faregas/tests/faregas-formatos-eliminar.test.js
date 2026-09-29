/**
 * Eliminación de formatos de certificado.
 *
 * Antes sólo existía `DELETE /formatos/:id/versiones/:versionId`: los formatos
 * no protegidos sin uso quedaban atrapados. Se añade `DELETE /formatos/:id` con
 * las validaciones en el BACKEND, para que una llamada directa no pueda borrar
 * un formato protegido ni uno en uso.
 *
 * Las reglas siguen el modelo que ya establece la base de datos:
 *   - `fg_certificado_formato.formato_padre_id`  -> ON DELETE NO ACTION
 *   - `fg_certificado_formato_version.formato_id` -> ON DELETE CASCADE
 *   - `fg_servicio.formato_id`                     -> ON DELETE NO ACTION
 *
 * Los tests de base son opt-in (FAREGAS_TEST_DB=1) y limpian en `finally`.
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
const { faregasFormatosService: formatosService } = require('../services/faregas-formatos.service');

const SERVICE = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-formatos.service.js'), 'utf8');
const RUTAS = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'faregas-formatos.routes.js'), 'utf8');

const codigo = (t) => t.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';
const conBase = (fn) => (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
    return fn(t);
};

const bloqueDe = (texto, desde) => {
    const ini = texto.indexOf(desde);
    assert.notEqual(ini, -1, `no se encontro ${desde}`);
    const fin = texto.indexOf('\n  guardarBorradorVersion', ini);
    return texto.slice(ini, fin === -1 ? undefined : fin);
};

/** Crea un formato dinámico sin uso, sin hijos y sin versiones. */
const crearFormatoLibre = async (marca) => {
    const r = await db.query(
        `INSERT INTO fg_certificado_formato (nombre, codigo, motor, es_protegido, activo, formato_padre_id)
         VALUES ($1, $2, 'HTML_DINAMICO', false, true, NULL) RETURNING id`,
        [`Formato de prueba ${marca}`, `TEST_FMT_${marca}`]);
    return r.rows[0].id;
};

// ===========================================================================
// 1. Estructura: la seguridad vive en el backend
// ===========================================================================

/** El handler completo de `DELETE /:id`, hasta el cierre de la ruta. */
const HANDLER_DELETE = () => {
    const m = /router\.delete\('\/:\id', verificarToken[\s\S]*?\n\}\);/.exec(RUTAS);
    assert.ok(m, 'no se encontró el handler DELETE /:id');
    return m[0];
};

test('1. existe DELETE /:id y exige permiso de administrar formatos', () => {
    const handler = HANDLER_DELETE();
    assert.match(handler, /verificarToken/);
    assert.match(handler, /requireAdministrarFormatos/);
    assert.match(handler, /faregasFormatosService\.eliminar\(req\.params\.id\)/);
    // Se declara antes que el borrado de versiones, que es más específico.
    assert.ok(RUTAS.indexOf("router.delete('/:id',") < RUTAS.indexOf("router.delete('/:id/versiones/:versionId'"));
});

test('2. la ruta devuelve 400 con el mensaje del service, no un error de FK', () => {
    const handler = HANDLER_DELETE();
    assert.match(handler, /res\.status\(400\)\.json\(\{ message: error\.message \}\)/);
    assert.match(handler, /Formato eliminado correctamente\./);
});

test('3. el service valida en orden: protegido, operaciones, variantes, certificados', () => {
    const bloque = codigo(bloqueDe(SERVICE, '  eliminar: async (id) => {'));
    const iProtegido = bloque.indexOf('es_protegido');
    const iOperaciones = bloque.indexOf('FROM fg_servicio WHERE formato_id');
    const iHijos = bloque.indexOf('formato_padre_id = $1');
    const iCertificados = bloque.indexOf('formato_version_id');
    assert.ok(iProtegido > -1, 'debe rechazar los protegidos');
    assert.ok(iOperaciones > -1, 'debe rechazar los que están en uso');
    assert.ok(iHijos > -1, 'debe revisar las variantes hijas');
    assert.ok(iCertificados > -1, 'debe revisar certificados que usan su plantilla');
    // El orden importa: lo primero que se evalúa es la protección.
    assert.ok(iProtegido < iOperaciones && iOperaciones < iHijos && iHijos < iCertificados);
});

test('4. los mensajes de error son legibles y enumeran lo que bloquea', () => {
    const bloque = codigo(bloqueDe(SERVICE, '  eliminar: async (id) => {'));
    assert.match(bloque, /no puede eliminarse porque está marcado como protegido/);
    assert.match(bloque, /no puede eliminarse porque está asignado a las operaciones/);
    assert.match(bloque, /no puede eliminarse porque tiene variantes que dependen de él/);
    assert.match(bloque, /no puede eliminarse porque \$\{certificados\.rows\[0\]\.total\} certificado/);
    // Se listan los códigos concretos, no un "violación de FK".
    assert.match(bloque, /map\(\(r\) => `- \$\{r\.codigo\}`\)/);
    assert.doesNotMatch(bloque, /violates foreign key|23503/);
});

test('5. las versiones caen en cascada explícitamente y en una transacción', () => {
    const bloque = codigo(bloqueDe(SERVICE, '  eliminar: async (id) => {'));
    assert.match(bloque, /BEGIN/);
    assert.match(bloque, /DELETE FROM fg_certificado_formato_version WHERE formato_id = \$1/);
    assert.match(bloque, /DELETE FROM fg_certificado_formato WHERE id = \$1 RETURNING/);
    assert.match(bloque, /COMMIT/);
    assert.match(bloque, /ROLLBACK/);
});

// ===========================================================================
// 2. Comportamiento contra la base real
// ===========================================================================

test('6. elimina un formato no protegido y sin uso', conBase(async () => {
    const marca = Date.now();
    const id = await crearFormatoLibre(marca);
    try {
        const r = await formatosService.eliminar(id);
        assert.equal(r.id, id);
        assert.equal(r.codigo, `TEST_FMT_${marca}`);
        const fila = await db.query('SELECT id FROM fg_certificado_formato WHERE id = $1', [id]);
        assert.equal(fila.rowCount, 0, 'el formato debe desaparecer');
    } finally {
        await db.query('DELETE FROM fg_certificado_formato WHERE id = $1', [id]);
    }
}));

test('7. sus versiones caen en cascada y no quedan huérfanas', conBase(async () => {
    const marca = Date.now();
    const id = await crearFormatoLibre(marca);
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><main data-faregas-editable-slot></main></body></html>';
    await db.query(
        `INSERT INTO fg_certificado_formato_version (formato_id, version, archivo_ruta, configuracion, estado, motor)
         VALUES ($1, 1, 'HTML', $2, 'BORRADOR', 'HTML_DINAMICO')`, [id, JSON.stringify({ html })]);
    try {
        const r = await formatosService.eliminar(id);
        assert.equal(r.versionesEliminadas, 1, 'debe eliminar su versión');
        const versiones = await db.query('SELECT id FROM fg_certificado_formato_version WHERE formato_id = $1', [id]);
        assert.equal(versiones.rowCount, 0);
        // Y en toda la tabla no queda ninguna versión sin formato.
        const huerfanas = await db.query(`
            SELECT COUNT(*)::int n FROM fg_certificado_formato_version v
            LEFT JOIN fg_certificado_formato f ON f.id = v.formato_id WHERE f.id IS NULL`);
        assert.equal(huerfanas.rows[0].n, 0, 'no debe quedar ninguna versión huérfana');
    } finally {
        await db.query('DELETE FROM fg_certificado_formato_version WHERE formato_id = $1', [id]);
        await db.query('DELETE FROM fg_certificado_formato WHERE id = $1', [id]);
    }
}));

test('8. NO elimina un formato protegido', conBase(async () => {
    const protegido = await db.query(
        'SELECT id, codigo FROM fg_certificado_formato WHERE es_protegido = TRUE ORDER BY id LIMIT 1');
    if (protegido.rowCount === 0) return;
    await assert.rejects(
        () => formatosService.eliminar(protegido.rows[0].id),
        (e) => /protegido/.test(e.message),
        'un formato protegido nunca debe eliminarse'
    );
    const fila = await db.query('SELECT id FROM fg_certificado_formato WHERE id = $1', [protegido.rows[0].id]);
    assert.equal(fila.rowCount, 1, 'el protegido sigue existiendo');
}));

test('9. NO elimina un formato asignado a una operación, y nombra la operación', conBase(async () => {
    const enUso = await db.query(`
        SELECT f.id, f.codigo AS formato, s.codigo AS operacion
        FROM fg_certificado_formato f
        JOIN fg_servicio s ON s.formato_id = f.id
        WHERE f.es_protegido = FALSE
        ORDER BY f.id LIMIT 1`);
    if (enUso.rowCount === 0) return;
    await assert.rejects(
        () => formatosService.eliminar(enUso.rows[0].id),
        (e) => {
            assert.match(e.message, /no puede eliminarse porque está asignado a las operaciones/);
            assert.ok(e.message.includes(enUso.rows[0].operacion),
                'el mensaje debe nombrar la operación que lo bloquea');
            return true;
        }
    );
    const fila = await db.query('SELECT id FROM fg_certificado_formato WHERE id = $1', [enUso.rows[0].id]);
    assert.equal(fila.rowCount, 1, 'el formato en uso sigue existiendo');
}));

test('10. NO elimina un formato con variantes hijas, y las nombra', conBase(async () => {
    const conHijos = await db.query(`
        SELECT f.id, h.codigo AS hijo
        FROM fg_certificado_formato f
        JOIN fg_certificado_formato h ON h.formato_padre_id = f.id
        WHERE f.es_protegido = FALSE
        ORDER BY f.id LIMIT 1`);
    if (conHijos.rowCount === 0) return;
    await assert.rejects(
        () => formatosService.eliminar(conHijos.rows[0].id),
        (e) => {
            assert.match(e.message, /tiene variantes que dependen de él/);
            assert.ok(e.message.includes(conHijos.rows[0].hijo));
            return true;
        }
    );
}));

test('11. NO elimina un formato cuya plantilla usa un certificado emitido', conBase(async () => {
    const marca = Date.now();
    const id = await crearFormatoLibre(marca);
    let versionId = null;
    let certificadoId = null;
    try {
        const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><main data-faregas-editable-slot></main></body></html>';
        const v = await db.query(
            `INSERT INTO fg_certificado_formato_version (formato_id, version, archivo_ruta, configuracion, estado, motor)
             VALUES ($1, 1, 'HTML', $2, 'VIGENTE', 'HTML_DINAMICO') RETURNING id`,
            [id, JSON.stringify({ html })]);
        versionId = v.rows[0].id;

        // `fg_certificado.planta_key` es NOT NULL: se usa una sede real.
        const planta = await db.query('SELECT key FROM fg_planta WHERE activo = TRUE ORDER BY key LIMIT 1');
        const cert = await db.query(
            `INSERT INTO fg_certificado
                (tipo_certificado_clave, numero_certificado, cliente_id, planta_key, fecha_emision,
                 estado, usuario_creacion, formato_version_id, precio_certificado, importe_total)
             VALUES ('CONFORMIDAD', $1, NULL, $2, CURRENT_DATE, 'EMITIDO', 'gibarra', $3, 1, 1)
             RETURNING id`, [`TEST-${marca}`, planta.rows[0].key, versionId]);
        certificadoId = cert.rows[0].id;

        await assert.rejects(
            () => formatosService.eliminar(id),
            (e) => /certificado\(s\) emitidos/.test(e.message),
            'no se debe borrar la plantilla de un certificado ya emitido'
        );
        const fila = await db.query('SELECT id FROM fg_certificado_formato WHERE id = $1', [id]);
        assert.equal(fila.rowCount, 1);
    } finally {
        if (certificadoId) await db.query('DELETE FROM fg_certificado WHERE id = $1', [certificadoId]);
        await db.query('DELETE FROM fg_certificado_formato_version WHERE formato_id = $1', [id]);
        await db.query('DELETE FROM fg_certificado_formato WHERE id = $1', [id]);
    }
}));

test('12. no deja operaciones apuntando a un formato inexistente', conBase(async () => {
    const huerfanas = await db.query(`
        SELECT COUNT(*)::int n
        FROM fg_servicio s
        LEFT JOIN fg_certificado_formato f ON f.id = s.formato_id
        WHERE s.formato_id IS NOT NULL AND f.id IS NULL`);
    assert.equal(huerfanas.rows[0].n, 0, 'ninguna operación debe quedar con un formato inexistente');
}));

test('13. no queda residuo de las pruebas', conBase(async () => {
    const sucios = await db.query("SELECT codigo FROM fg_certificado_formato WHERE codigo LIKE 'TEST_FMT_%'");
    assert.equal(sucios.rowCount, 0, `formatos de prueba sin limpiar: ${sucios.rows.map((r) => r.codigo).join(', ')}`);
}));
