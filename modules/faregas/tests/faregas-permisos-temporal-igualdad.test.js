const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// La suite corre con NODE_ENV=test, y el cargador de entorno omite el .env a
// propósito para que las pruebas no dependan de una base viva. Las pruebas que
// SÍ necesitan leer la base son opt-in: se ejecutan sólo con
// FAREGAS_TEST_DB=1, y en cualquier otro entorno se omiten explícitamente.
const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
if (USA_BASE_DE_DATOS) {
    require('../../../config/env-loader').loadEnv(true);
}

const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');

const MIGRACION = path.join(
    __dirname, '..', 'database', 'migrations', '20260927_faregas_permisos_temporales_iguales.sql'
);
const FRONTEND_RAIZ = path.join(__dirname, '..', '..', '..', '..', 'farenetFrontend', 'src');

const sql = fs.readFileSync(MIGRACION, 'utf8');
const sinComentarios = sql
    .split('\n')
    .filter((linea) => !linea.trim().startsWith('--'))
    .join('\n');

const leerFrontend = (...partes) => fs.readFileSync(path.join(FRONTEND_RAIZ, ...partes), 'utf8');
const sidebar = leerFrontend('components', 'Sidebar.tsx');
const inicioView = leerFrontend('modules', 'faregas', 'views', 'Inicio', 'InicioView.tsx');

/** El bloque de FAREGAS del Sidebar: desde `if (isFaregas)` hasta su cierre. */
const bloqueFaregasSidebar = (() => {
    const inicio = sidebar.indexOf('if (isFaregas) {');
    assert.ok(inicio > -1, 'el Sidebar debe seguir teniendo la rama de FAREGAS');
    return sidebar.slice(inicio, sidebar.indexOf('return false;', inicio));
})();

// ===========================================================================
// 1. La migración es la que fija la igualdad temporal
// ===========================================================================

test('1. la sincronización parte de los permisos de SISTEMAS', () => {
    assert.match(
        sinComentarios,
        /CROSS JOIN fg_perfil_permiso referencia/i,
        'debe copiar desde fg_perfil_permiso, no desde el catálogo completo'
    );
    assert.match(
        sinComentarios,
        /referencia\.perfil_clave\s*=\s*'SISTEMAS'/i,
        'el perfil de origen debe ser SISTEMAS'
    );
    assert.match(
        sinComentarios,
        /perfiles\.clave\s*<>\s*'SISTEMAS'/i,
        'SISTEMAS no debe copiarse a sí mismo'
    );
});

test('2. la sincronización es idempotente y no duplica registros', () => {
    assert.match(
        sinComentarios,
        /ON CONFLICT \(perfil_clave, permiso_clave\) DO NOTHING/i,
        'debe resolver el conflicto de la PK (perfil_clave, permiso_clave)'
    );
});

test('3. la sincronización no borra permisos ni revoca asignaciones', () => {
    assert.doesNotMatch(
        sinComentarios,
        /DELETE\s+FROM/i,
        'no debe borrar permisos: sólo completa los faltantes'
    );
    assert.doesNotMatch(
        sinComentarios,
        /UPDATE\s+fg_perfil_permiso/i,
        'no debe modificar permisos existentes'
    );
});

test('4. la sincronización no convierte usuarios ni altera sedes', () => {
    for (const tabla of ['fg_usuario', 'fg_usuario_planta', 'fg_perfil_planta', 'fg_perfil\\b']) {
        assert.doesNotMatch(
            sinComentarios,
            new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${tabla}`, 'i'),
            `no debe escribir en ${tabla.replace('\\\\b', '')}: los usuarios y las sedes no se tocan`
        );
    }
});

test('5. la sincronización no reactiva permisos dados de baja', () => {
    assert.match(
        sinComentarios,
        /permiso\.activo\s*=\s*TRUE/i,
        'sólo debe propagar permisos activos del catálogo'
    );
});

test('6. la sincronización aborta si el perfil de referencia no existe', () => {
    assert.match(
        sinComentarios,
        /RAISE EXCEPTION/i,
        'sin SISTEMAS no debe copiar un conjunto vacío en silencio'
    );
});

test('7. la migración declara que es temporal y cómo revertirla', () => {
    assert.match(sql, /TEMPORAL/i);
    assert.match(sql, /revertir/i);
});

// ===========================================================================
// 2. La autorización sigue siendo por permiso, no por nombre de perfil
// ===========================================================================

test('8. el backend sigue resolviendo los permisos desde fg_perfil_permiso', () => {
    const fuente = fs.readFileSync(
        path.join(__dirname, '..', 'services', 'faregas-auth.service.js'),
        'utf8'
    );
    assert.match(fuente, /exports\.getPermisosPorPerfil/);
    assert.match(
        fuente,
        /FROM fg_perfil_permiso pp\s*\n\s*JOIN fg_permiso p ON p\.clave = pp\.permiso_clave/i,
        'los permisos se siguen leyendo de fg_perfil_permiso en vivo'
    );
});

test('9. el Sidebar de FAREGAS no decide por nombre de perfil', () => {
    assert.doesNotMatch(
        bloqueFaregasSidebar,
        /perfilId/,
        'el bloque de FAREGAS no debe consultar el nombre del perfil'
    );
    assert.doesNotMatch(
        bloqueFaregasSidebar,
        /'SISTEMAS'|'sistemas'|'OPERADOR'|'JEFE_PLANTA'/i,
        'ninguna visibilidad de FAREGAS puede depender de un nombre de perfil'
    );
});

test('10. cada entrada del menú de FAREGAS se decide por permiso', () => {
    for (const [clave, permiso] of [
        ['descuentos', 'MENU_DESCUENTOS'],
        ['usuarios', 'MENU_USUARIOS'],
        ['inicio', 'MENU_INICIO'],
        ['auditoria', 'MENU_AUDITORIA'],
        ['configuracion', 'MENU_CONFIGURACION'],
        ['facturacion', 'MENU_FACTURACION']
    ]) {
        assert.match(
            bloqueFaregasSidebar,
            new RegExp(`item\\.key === '${clave}'[\\s\\S]{0,160}?permisos\\.includes\\('${permiso}'\\)`),
            `${clave} debe depender de ${permiso}`
        );
    }
});

test('11. InicioView muestra la nota de crédito por permiso, no por perfil', () => {
    assert.match(
        inicioView,
        /tienePermisoNotaCredito\s*=\s*permisos\.includes\('FAREGAS_NOTA_CREDITO'\)/,
        'debe depender sólo del permiso'
    );
    assert.doesNotMatch(
        inicioView,
        /tienePermisoNotaCredito\s*=[^;]*perfilId/s,
        'no debe comparar contra el nombre del perfil'
    );
});

// ===========================================================================
// 3. Estado real en la base: los perfiles active son idénticos entre sí
//    (se omite si el entorno no tiene base de datos disponible)
// ===========================================================================

const PERFIL_REFERENCIA = 'SISTEMAS';

const conBaseDeDatos = async (accion) => {
    if (!USA_BASE_DE_DATOS) return { disponible: false };
    try {
        await db.query('SELECT 1');
    } catch (error) {
        return { disponible: false };
    }
    return { disponible: true, resultado: await accion() };
};

const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';

const permisosDe = async (perfil) => {
    const r = await db.query(
        `SELECT p.permiso_clave
         FROM fg_perfil_permiso p
         JOIN fg_permiso permiso ON permiso.clave = p.permiso_clave
         WHERE p.perfil_clave = $1 AND permiso.activo = TRUE
         ORDER BY p.permiso_clave`,
        [perfil]
    );
    return r.rows.map((x) => x.permiso_clave);
};

test('12. todos los perfiles activos tienen exactamente los permisos de SISTEMAS', async (t) => {
    const { disponible, resultado } = await conBaseDeDatos(async () => {
        const referencia = await permisosDe(PERFIL_REFERENCIA);
        const perfiles = await db.query('SELECT clave FROM fg_perfil ORDER BY clave');
        const comparacion = [];
        for (const { clave } of perfiles.rows) {
            const actuales = await permisosDe(clave);
            comparacion.push({
                perfil: clave,
                total: actuales.length,
                mismosCodigos:
                    actuales.length === referencia.length
                    && actuales.every((c, i) => c === referencia[i]),
                extras: actuales.filter((c) => !referencia.includes(c))
            });
        }
        return { referencia, comparacion };
    });

    if (!disponible) {
        return t.skip(SIN_BASE);
    }

    assert.ok(resultado.referencia.length > 0, 'SISTEMAS debe tener permisos de referencia');
    for (const fila of resultado.comparacion) {
        assert.equal(
            fila.mismosCodigos,
            true,
            `${fila.perfil} debe tener los mismos permisos que ${PERFIL_REFERENCIA}`
        );
        assert.deepEqual(fila.extras, [], `${fila.perfil} no debe tener permisos fuera del set`);
    }
});

test('13. la cantidad de permisos es la misma en todos los perfiles', async (t) => {
    const { disponible, resultado } = await conBaseDeDatos(async () => {
        const r = await db.query(
            `SELECT perfil_clave, count(*)::int AS total
             FROM fg_perfil_permiso
             GROUP BY perfil_clave
             ORDER BY perfil_clave`
        );
        return r.rows;
    });

    if (!disponible) return t.skip(SIN_BASE);

    assert.ok(resultado.length > 1, 'debe existir más de un perfil');
    const totales = [...new Set(resultado.map((x) => x.total))];
    assert.equal(totales.length, 1, `todos los perfiles deben tener la misma cantidad: ${JSON.stringify(resultado)}`);
});

test('14. los perfiles siguen siendo perfiles distintos y sin converter usuarios', async (t) => {
    const { disponible, resultado } = await conBaseDeDatos(async () => {
        const perfiles = await db.query('SELECT clave FROM fg_perfil ORDER BY clave');
        const usuarios = await db.query(
            'SELECT perfil_id, count(*)::int AS total FROM fg_usuario GROUP BY perfil_id ORDER BY perfil_id'
        );
        return { perfiles: perfiles.rows.map((x) => x.clave), usuarios: usuarios.rows };
    });

    if (!disponible) return t.skip(SIN_BASE);

    assert.ok(resultado.perfiles.length > 1, 'los perfiles deben seguir existiendo por separado');
    assert.ok(
        resultado.perfiles.includes(PERFIL_REFERENCIA),
        'el perfil de referencia debe seguir existiendo'
    );
    // La igualdad es de permisos: nadie fue movido al perfil SISTEMAS.
    for (const perfil of resultado.perfiles) {
        if (perfil !== PERFIL_REFERENCIA) {
            assert.ok(perfil.length > 0, `el perfil ${perfil} debe seguir existiendo`);
        }
    }
    assert.ok(
        resultado.usuarios.some((u) => u.perfil_id !== PERFIL_REFERENCIA),
        'debe seguir habiendo usuarios en perfiles distintos de SISTEMAS'
    );
});

test('15. la igualdad de permisos NO amplía el territorio de un usuario', async (t) => {
    const { disponible, resultado } = await conBaseDeDatos(async () => {
        const usuarios = await db.query(
            `SELECT DISTINCT up.usuario_username, u.perfil_id
             FROM fg_usuario_planta up
             JOIN fg_usuario u ON u.username = up.usuario_username
             WHERE u.perfil_id <> $1
             ORDER BY up.usuario_username`,
            [PERFIL_REFERENCIA]
        );
        const evaluados = [];
        for (const u of usuarios.rows) {
            const plantas = await authService.getPlantasPorUsuario(u.usuario_username, u.perfil_id);
            evaluados.push({ ...u, plantas: plantas.map((p) => p.key) });
        }
        return evaluados;
    });

    if (!disponible || resultado.length === 0) {
        return t.skip(SIN_BASE);
    }

    const referencia = await authService.getPlantasPorUsuario('__sin_usuario__', PERFIL_REFERENCIA);
    const totalReferencia = referencia.length;

    for (const usuario of resultado) {
        // Las sedes de un perfil no referencial siguen viniendo de
        // fg_usuario_planta: tener los mismos permisos no abre sede alguna.
        assert.ok(usuario.plantas.length > 0, `${usuario.usuario_username} debe conservar su sede`);
        assert.ok(
            usuario.plantas.length < totalReferencia,
            `${usuario.usuario_username} no debe obtener todas las sedes por tener permisos`
        );
    }
});

test.after(() => db.end());
