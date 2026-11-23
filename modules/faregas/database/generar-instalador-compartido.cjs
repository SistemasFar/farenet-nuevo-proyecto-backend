const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const consolidado = join(__dirname, 'faregas_consolidado.sql');
// La variante compartida solo admite la revisión auditada. Revisar el diff
// completo y repetir la prueba de aislamiento antes de actualizar esta huella.
const huellaRevisada = '6cb848bda9a731527c040c00a717b93235845d3ca8ea24130c63fa8dd1f4c084';
const catalogos = [
    'moneda', 'formapago', 'cuentacorriente', 'entidadfinanciera', 'tarjeta',
    'tipocontado', 'persona', 'tipodocumentoidentidad', 'pais', 'departamento',
    'provincia', 'distrito', 'seriedocumentobase'
];

function generarSqlCompartido(base) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(base || '') ||
        ['inspeccion', 'farenet', 'farenet_bkp', 'postgres', 'template0', 'template1'].includes(base)) {
        throw new Error('Indique el nombre exacto de una base compartida autorizada distinta de las bases protegidas.');
    }
    const origen = readFileSync(consolidado, 'utf8').replace(/\r\n/g, '\n');
    if (createHash('sha256').update(origen).digest('hex') !== huellaRevisada) {
        throw new Error('El consolidado cambió. Revise el alcance SQL antes de generar otra variante compartida.');
    }
    const terminador = '\nCOMMIT;\n';
    const fin = origen.indexOf(terminador);
    if (fin < 0) throw new Error('No se encontró el cierre del instalador.');
    let sql = origen.slice(0, fin + terminador.length);
    sql = sql.replace('BEGIN;\n', `BEGIN;

DO $faregas_base_compartida$
BEGIN
    IF current_database() <> '${base}' THEN
        RAISE EXCEPTION 'La conexión no corresponde a la base compartida autorizada';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_extension
        WHERE extname = 'btree_gist'
          AND extnamespace IN ('public'::regnamespace, 'pg_catalog'::regnamespace)
    ) THEN
        RAISE EXCEPTION 'El DBA debe provisionar btree_gist antes de ejecutar el instalador';
    END IF;
END;
$faregas_base_compartida$;
`);
    sql = sql.replace('CREATE EXTENSION IF NOT EXISTS btree_gist;', '-- btree_gist lo provisiona el DBA.');
    sql = sql.replace(/^SET (?=(?:statement_timeout|lock_timeout|client_encoding|standard_conforming_strings|check_function_bodies|xmloption|client_min_messages|row_security|default_tablespace|default_table_access_method)\s*=)/gm, 'SET LOCAL ');
    for (const nombre of catalogos) {
        const bloque = new RegExp(`^CREATE TABLE IF NOT EXISTS public\\.${nombre} \\(\\n[\\s\\S]*?^\\);$`, 'm');
        const ddl = sql.match(bloque)?.[0];
        if (!ddl) throw new Error(`Falta el contrato auditado de ${nombre}`);
        const columnas = ddl.split('\n').slice(1, -1)
            .map((linea) => linea.trim().split(/\s+/, 1)[0])
            .filter((columna) => !['descripcion', 'activo', 'razonsocial'].includes(columna));
        sql = sql.replace(bloque, `-- Validar columnas consumidas sin crear ni alterar el catálogo.\nSELECT ${columnas.join(', ')} FROM public.${nombre} LIMIT 0;`);
    }
    return '-- Variante FAREGAS para base compartida. Requiere catálogos ya provisionados.\n' + sql;
}

if (require.main === module) {
    try {
        const [base, salida] = process.argv.slice(2);
        if (!salida || !salida.endsWith('.sql')) {
            throw new Error('Uso: node generar-instalador-compartido.cjs BASE_AUTORIZADA ARCHIVO_NUEVO.sql');
        }
        writeFileSync(resolve(salida), generarSqlCompartido(base), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { generarSqlCompartido };
