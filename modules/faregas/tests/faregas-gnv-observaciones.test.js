const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// La suite corre con NODE_ENV=test y el cargador de entorno omite el .env, así
// que las pruebas que necesitan base viva son opt-in (FAREGAS_TEST_DB=1).
const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
if (USA_BASE_DE_DATOS) {
    require('../../../config/env-loader').loadEnv(true);
}

const db = require('../../../config/database');
const service = require('../services/faregas-certificados.service');

const MIGRACION = path.join(__dirname, '..', 'database', 'migrations', '20260928_faregas_gnv_observaciones.sql');
const SERVICE = path.join(__dirname, '..', 'services', 'faregas-certificados.service.js');
const TEMPLATE = path.join(__dirname, '..', 'templates', 'gnv-anual.template.js');

const sqlMigracion = fs.readFileSync(MIGRACION, 'utf8');
const fuenteService = fs.readFileSync(SERVICE, 'utf8');
const fuenteTemplate = fs.readFileSync(TEMPLATE, 'utf8');
const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';

const USUARIO = { username: 'gibarra', perfil_id: 'SISTEMAS', planta_key: '201', ip_direccion: '127.0.0.1' };

// ===========================================================================
// 1. La migración y el servicio soportan el campo
// ===========================================================================

test('1. la migración agrega la columna observaciones de forma idempotente', () => {
    assert.match(sqlMigracion, /ALTER TABLE fg_certificado_gnv/i);
    assert.match(sqlMigracion, /ADD COLUMN IF NOT EXISTS observaciones/i);
    assert.match(sqlMigracion, /BEGIN;[\s\S]*COMMIT;/);
});

test('2. guardarGNV persiste observaciones en el INSERT y en el UPDATE', () => {
    assert.match(fuenteService, /combustible_posterior, peso_neto_posterior, observaciones/i);
    assert.match(fuenteService, /observaciones = EXCLUDED\.observaciones/i);
    assert.match(fuenteService, /observacionesGnv/);
});

test('3. la previsualización alimenta la plantilla con el dato persistido', () => {
    // La plantilla lee cabecera.observaciones; el service debe inyectarla desde
    // la fila de fg_certificado_gnv, no desde el navegador.
    assert.match(fuenteTemplate, /cert\.observaciones/);
    assert.match(fuenteService, /cabecera:\s*\{\s*\.\.\.cabeceraComun,\s*observaciones:\s*gnv\.observaciones/);
});

test('4. la plantilla escapa el valor (no inserta HTML arbitrario)', () => {
    const linea = fuenteTemplate.split('\n').find((l) => l.includes('OBSERVACIONES:') && l.includes('escapeHtml'));
    assert.ok(linea, 'la sección de observaciones debe usar escapeHtml');
    assert.match(linea, /escapeHtml\(cert\.observaciones/);
});

// ===========================================================================
// 2. Persistencia real: guardar -> leer -> previsualizar
// ===========================================================================

const conBorradorGnv = async (accion) => {
    if (!USA_BASE_DE_DATOS) return { disponible: false };
    let cert;
    try {
        const r = await db.query(
            `SELECT c.id FROM fg_certificado c
             JOIN fg_certificado_gnv g ON g.certificado_id = c.id
             WHERE c.tipo_certificado_clave = 'GNV_ANUAL' AND c.estado = 'BORRADOR'
             ORDER BY c.id DESC LIMIT 1`
        );
        if (r.rowCount === 0) return { disponible: false };
        cert = r.rows[0].id;
    } catch (error) {
        return { disponible: false };
    }

    const antes = (await db.query(
        'SELECT observaciones FROM fg_certificado_gnv WHERE certificado_id = $1', [cert]
    )).rows[0].observaciones;

    try {
        return { disponible: true, resultado: await accion(cert) };
    } finally {
        // Siempre se restaura el valor original: la prueba no deja rastro.
        await db.query('UPDATE fg_certificado_gnv SET observaciones = $1 WHERE certificado_id = $2', [antes, cert]);
    }
};

test('5. guarda, lee de nuevo y renderiza la observación', async (t) => {
    const { disponible, resultado } = await conBorradorGnv(async (cert) => {
        await service.guardarGNV(cert, { modalidad: 'ANUAL', observaciones: 'FFFF' }, USUARIO);

        const leido = await service.obtenerGNV(cert, USUARIO);
        const preview = await service.obtenerPrevisualizacion(cert, USUARIO);
        const match = preview.html.match(/<strong>OBSERVACIONES:<\/strong>\s*([^<]*)/);

        return {
            persistido: (await db.query(
                'SELECT observaciones FROM fg_certificado_gnv WHERE certificado_id = $1', [cert]
            )).rows[0].observaciones,
            desdeServicio: leido.gnv.observaciones,
            renderizado: match ? match[1].trim() : null,
            contiene: preview.html.includes('FFFF'),
        };
    });

    if (!disponible) return t.skip(SIN_BASE);

    assert.equal(resultado.persistido, 'FFFF', 'queda persistido en la tabla');
    assert.equal(resultado.desdeServicio, 'FFFF', 'se lee de vuelta por el service');
    assert.equal(resultado.renderizado, 'FFFF', 'la previsualización lo imprime');
    assert.equal(resultado.contiene, true);
});

test('6. el valor sobrevive a una segunda lectura (no depende del estado original)', async (t) => {
    const { disponible, resultado } = await conBorradorGnv(async (cert) => {
        await service.guardarGNV(cert, { modalidad: 'ANUAL', observaciones: 'OBSERVACION DE PRUEBA' }, USUARIO);
        // Segunda lectura completamente independiente de la primera.
        const segunda = await service.obtenerGNV(cert, USUARIO);
        return segunda.gnv.observaciones;
    });

    if (!disponible) return t.skip(SIN_BASE);
    assert.equal(resultado, 'OBSERVACION DE PRUEBA');
});

test('7. cadena vacía se guarda como NULL y la plantilla cae al placeholder', async (t) => {
    const { disponible, resultado } = await conBorradorGnv(async (cert) => {
        await service.guardarGNV(cert, { modalidad: 'ANUAL', observaciones: '   ' }, USUARIO);
        const persistido = (await db.query(
            'SELECT observaciones FROM fg_certificado_gnv WHERE certificado_id = $1', [cert]
        )).rows[0].observaciones;
        const preview = await service.obtenerPrevisualizacion(cert, USUARIO);
        const match = preview.html.match(/<strong>OBSERVACIONES:<\/strong>\s*([^<]*)/);
        return { persistido, renderizado: match ? match[1].trim() : '' };
    });

    if (!disponible) return t.skip(SIN_BASE);

    assert.equal(resultado.persistido, null, 'espacios en blanco se guardan como NULL');
    assert.notEqual(resultado.renderizado, '', 'el placeholder se sigue imprimiendo');
});

test('8. el backend recorta al límite de 250 caracteres', async (t) => {
    const { disponible, resultado } = await conBorradorGnv(async (cert) => {
        await service.guardarGNV(cert, { modalidad: 'ANUAL', observaciones: 'X'.repeat(300) }, USUARIO);
        return (await db.query(
            'SELECT length(observaciones) AS len FROM fg_certificado_gnv WHERE certificado_id = $1', [cert]
        )).rows[0].len;
    });

    if (!disponible) return t.skip(SIN_BASE);
    assert.equal(resultado, 250);
});

test('9. el HTML se escapa: un script no se imprime crudo', async (t) => {
    const { disponible, resultado } = await conBorradorGnv(async (cert) => {
        await service.guardarGNV(cert, { modalidad: 'ANUAL', observaciones: '<script>alert(1)</script>' }, USUARIO);
        const preview = await service.obtenerPrevisualizacion(cert, USUARIO);
        return { crudo: preview.html.includes('<script>'), escapado: preview.html.includes('&lt;script&gt;') };
    });

    if (!disponible) return t.skip(SIN_BASE);

    assert.equal(resultado.crudo, false, 'no debe quedar HTML ejecutable');
    assert.equal(resultado.escapado, true, 'debe quedar el texto escapado');
});

test('10. guardar no destruye los demás datos GNV', async (t) => {
    const { disponible, resultado } = await conBorradorGnv(async (cert) => {
        const antes = (await db.query(
            'SELECT taller_autorizado_id, vigencia_hasta, modalidad, numero_chip FROM fg_certificado_gnv WHERE certificado_id = $1',
            [cert]
        )).rows[0];

        await service.guardarGNV(cert, { modalidad: 'ANUAL', observaciones: 'FFFF' }, USUARIO);

        const despues = (await db.query(
            'SELECT taller_autorizado_id, vigencia_hasta, modalidad, numero_chip FROM fg_certificado_gnv WHERE certificado_id = $1',
            [cert]
        )).rows[0];

        return { antes, despues };
    });

    if (!disponible) return t.skip(SIN_BASE);

    assert.deepEqual(resultado.despues, resultado.antes, 'el resto de columnas GNV queda intacto');
});

test('11. la columna existe y es opcional', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
    const r = await db.query(
        `SELECT column_name, data_type, character_maximum_length, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'fg_certificado_gnv' AND column_name = 'observaciones'`
    );

    if (r.rowCount === 0) return t.skip('la migración todavía no se aplicó en esta base');

    assert.equal(r.rows[0].is_nullable, 'YES', 'debe ser opcional');
    assert.equal(Number(r.rows[0].character_maximum_length), 250);
});

test.after(() => db.end());
