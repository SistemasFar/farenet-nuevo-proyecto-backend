const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
if (USA_BASE_DE_DATOS) {
    require('../../../config/env-loader').loadEnv(true);
}

const db = require('../../../config/database');
const service = require('../services/faregas-certificados.service');

const TEMPLATE_INICIAL = path.join(__dirname, '..', 'templates', 'gnv-inicial.template.js');
const SERVICE = path.join(__dirname, '..', 'services', 'faregas-certificados.service.js');
const MIGRACION_GNV = path.join(__dirname, '..', 'database', 'migrations', '20260928_faregas_gnv_observaciones.sql');

const fuenteTemplate = fs.readFileSync(TEMPLATE_INICIAL, 'utf8');
const fuenteService = fs.readFileSync(SERVICE, 'utf8');
const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';
const USUARIO = { username: 'gibarra', perfil_id: 'SISTEMAS', planta_key: '201', ip_direccion: '127.0.0.1' };

// ===========================================================================
// 1. La plantilla y la base ya soportaban el dato
// ===========================================================================

test('1. la plantilla GNV INICIAL lee las columnas posteriores del certificado', () => {
    assert.match(fuenteTemplate, /gnv\.combustible_posterior/);
    assert.match(fuenteTemplate, /gnv\.peso_neto_posterior/);
});

test('2. la plantilla escapa ambos valores', () => {
    const lineas = fuenteTemplate.split('\n').filter((l) => l.includes('_posterior'));
    assert.ok(lineas.length >= 2);
    lineas.forEach((linea) => {
        assert.match(linea, /escapeHtml\(/, 'el valor posterior debe ir escapado');
    });
});

test('3. guardarGNV ya tenía las columnas posteriores en INSERT y UPDATE', () => {
    assert.match(fuenteService, /combustible_posterior, peso_neto_posterior/i);
    assert.match(fuenteService, /combustible_posterior = EXCLUDED\.combustible_posterior/);
    assert.match(fuenteService, /peso_neto_posterior = EXCLUDED\.peso_neto_posterior/);
});

test('4. no se creó una migración para estas columnas: ya existían', () => {
    // La migración de esta tarea sólo agrega `observaciones`; las posteriores
    // son preexistentes del modelo.
    const sql = fs.readFileSync(MIGRACION_GNV, 'utf8');
    assert.doesNotMatch(sql, /peso_neto_posterior|combustible_posterior/);
});

// ===========================================================================
// 2. Persistencia real GNV INICIAL
// ===========================================================================

const conBorradorInicial = async (accion) => {
    if (!USA_BASE_DE_DATOS) return { disponible: false };
    let cert;
    try {
        const r = await db.query(
            `SELECT g.certificado_id FROM fg_certificado_gnv g
             JOIN fg_certificado c ON c.id = g.certificado_id
             WHERE g.modalidad = 'INICIAL' AND c.estado = 'BORRADOR'
             ORDER BY c.id DESC LIMIT 1`
        );
        if (r.rowCount === 0) return { disponible: false };
        cert = r.rows[0].certificado_id;
    } catch (error) {
        return { disponible: false };
    }

    const gn = (await db.query(
        'SELECT combustible_posterior, peso_neto_posterior, observaciones FROM fg_certificado_gnv WHERE certificado_id = $1', [cert]
    )).rows[0];
    const vh = (await db.query(
        'SELECT peso_neto FROM fg_certificado_vehiculo WHERE certificado_id = $1', [cert]
    )).rows[0] || {};

    try {
        return { disponible: true, resultado: await accion(cert) };
    } finally {
        await db.query(
            `UPDATE fg_certificado_gnv
             SET combustible_posterior = $1, peso_neto_posterior = $2, observaciones = $3
             WHERE certificado_id = $4`,
            [gn.combustible_posterior, gn.peso_neto_posterior, gn.observaciones, cert]
        );
    }
};

const fila = (html, etiqueta) => {
    const m = html.match(new RegExp(`${etiqueta}</td>\\s*<td[^>]*>([^<]*)<`));
    return m ? m[1].trim() : null;
};

test('5. guarda el peso y el combustible de después, y los imprime en el certificado', async (t) => {
    const { disponible, resultado } = await conBorradorInicial(async (cert) => {
        await service.guardarGNV(cert, {
            modalidad: 'INICIAL',
            combustiblePosterior: 'DUAL GNV',
            pesoNetoPosterior: '12222',
        }, USUARIO);

        const gn = (await db.query(
            'SELECT combustible_posterior, peso_neto_posterior FROM fg_certificado_gnv WHERE certificado_id = $1', [cert]
        )).rows[0];
        const html = String((await service.obtenerPrevisualizacion(cert, USUARIO)).html);

        return {
            persistidoCombustible: gn.combustible_posterior,
            persistidoPeso: String(gn.peso_neto_posterior),
            impresoCombustible: fila(html, 'COMBUSTIBLE'),
            impresoPeso: fila(html, 'PESO NETO \\(Kg\\.\\)'),
        };
    });

    if (!disponible) return t.skip(SIN_BASE);

    assert.equal(resultado.persistidoCombustible, 'DUAL GNV');
    assert.match(resultado.persistidoPeso, /^12222/);
    assert.equal(resultado.impresoCombustible, 'DUAL GNV', 'el certificado imprime el valor de después');
    assert.match(resultado.impresoPeso, /^12222/);
});

test('6. el peso original del vehículo NO se sustituye', async (t) => {
    const { disponible, resultado } = await conBorradorInicial(async (cert) => {
        const antes = (await db.query(
            'SELECT peso_neto FROM fg_certificado_vehiculo WHERE certificado_id = $1', [cert]
        )).rows[0];

        await service.guardarGNV(cert, { modalidad: 'INICIAL', pesoNetoPosterior: '12222' }, USUARIO);

        const despues = (await db.query(
            'SELECT peso_neto FROM fg_certificado_vehiculo WHERE certificado_id = $1', [cert]
        )).rows[0];
        const gnv = (await db.query(
            'SELECT peso_neto_posterior FROM fg_certificado_gnv WHERE certificado_id = $1', [cert]
        )).rows[0];

        return {
            originalIgual: String(antes.peso_neto) === String(despues.peso_neto),
            original: String(antes.peso_neto),
            posterior: String(gnv.peso_neto_posterior),
        };
    });

    if (!disponible) return t.skip(SIN_BASE);

    assert.equal(resultado.originalIgual, true, 'el peso original queda intacto');
    assert.match(resultado.posterior, /^12222/);
});

test('7. original y posterior conviven como valores distintos', async (t) => {
    const { disponible, resultado } = await conBorradorInicial(async (cert) => {
        const original = (await db.query(
            'SELECT peso_neto FROM fg_certificado_vehiculo WHERE certificado_id = $1', [cert]
        )).rows[0];
        if (original.peso_neto === null) return { sinOriginal: true };

        await service.guardarGNV(cert, { modalidad: 'INICIAL', pesoNetoPosterior: '12222' }, USUARIO);
        const html = String((await service.obtenerPrevisualizacion(cert, USUARIO)).html);

        return {
            original: String(original.peso_neto),
            printedOriginal: String(original.peso_neto).replace(/\.00+$/, ''),
            printedPosterior: fila(html, 'PESO NETO \\(Kg\\.\\)'),
            originalEnDoc: html.includes(String(original.peso_neto)),
        };
    });

    if (!disponible) return t.skip(SIN_BASE);
    if (resultado.sinOriginal) return t.skip('el borrador no tiene peso original cargado');

    assert.equal(resultado.originalEnDoc, true, 'el peso original sigue visible en el documento');
    assert.notEqual(resultado.printedPosterior, resultado.original, 'el posterior no reemplaza al original');
});

test('8. vacío se guarda como NULL y la plantilla cae a su marcador', async (t) => {
    const { disponible, resultado } = await conBorradorInicial(async (cert) => {
        await service.guardarGNV(cert, { modalidad: 'INICIAL', pesoNetoPosterior: '' }, USUARIO);
        const gn = (await db.query(
            'SELECT peso_neto_posterior FROM fg_certificado_gnv WHERE certificado_id = $1', [cert]
        )).rows[0];
        const html = String((await service.obtenerPrevisualizacion(cert, USUARIO)).html);
        return { persistido: gn.peso_neto_posterior, impreso: fila(html, 'PESO NETO \\(Kg\\.\\)') };
    });

    if (!disponible) return t.skip(SIN_BASE);

    assert.equal(resultado.persistido, null);
    assert.equal(resultado.impreso, '-', 'sin dato, el certificado imprime el guion de siempre');
});

test('9. el valor sobrevive a una segunda lectura independiente', async (t) => {
    const { disponible, resultado } = await conBorradorInicial(async (cert) => {
        await service.guardarGNV(cert, { modalidad: 'INICIAL', pesoNetoPosterior: '12222' }, USUARIO);
        const segunda = await service.obtenerGNV(cert, USUARIO);
        return String(segunda.gnv.peso_neto_posterior);
    });

    if (!disponible) return t.skip(SIN_BASE);
    assert.match(resultado, /^12222/);
});

test('10. cambiar a ANUAL no arrastra los valores posteriores', async (t) => {
    const { disponible, resultado } = await conBorradorInicial(async (cert) => {
        await service.guardarGNV(cert, { modalidad: 'INICIAL', pesoNetoPosterior: '12222' }, USUARIO);
        await service.guardarGNV(cert, { modalidad: 'ANUAL' }, USUARIO);
        const gn = (await db.query(
            'SELECT modalidad, peso_neto_posterior FROM fg_certificado_gnv WHERE certificado_id = $1', [cert]
        )).rows[0];
        return gn;
    });

    if (!disponible) return t.skip(SIN_BASE);

    assert.equal(resultado.modalidad, 'ANUAL');
    assert.equal(resultado.peso_neto_posterior, null, 'la conversión no aplica a ANUAL');
});

test.after(() => db.end());
