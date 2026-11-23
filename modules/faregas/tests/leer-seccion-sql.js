const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ruta = join(__dirname, '../database/faregas_consolidado.sql');

function leerSeccionSql(numero) {
    const [instalacion, apendice] = readFileSync(ruta, 'utf8').split(/^COMMIT;\r?$/m);
    const secciones = instalacion.split(/^-- ==== migrations\//m).slice(1);
    const seccion = secciones.find((bloque) => bloque.startsWith(`${numero}_`));
    if (seccion) return seccion.slice(seccion.indexOf('\n') + 1).trimEnd();

    const historica = apendice?.split(/^-- ==== /m)
        .find((bloque) => bloque.startsWith(`migrations/${numero}_`));
    if (!historica) throw new Error(`No se encontró la migración ${numero} en ${ruta}`);
    return historica.split(/\r?\n/).slice(2)
        .map((linea) => linea.replace(/^-- ?/, '')).join('\n').trimEnd();
}

module.exports = leerSeccionSql;
