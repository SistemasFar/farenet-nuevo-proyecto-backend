const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ruta = join(__dirname, '../database/faregas_consolidado.sql');

function leerSeccionSql(numero) {
    const instalacion = readFileSync(ruta, 'utf8').split(/^COMMIT;\r?$/m, 1)[0];
    const secciones = instalacion.split(/^-- ==== migrations\//m).slice(1);
    const seccion = secciones.find((bloque) => bloque.startsWith(`${numero}_`));
    if (!seccion) throw new Error(`No se encontró la migración ${numero} en ${ruta}`);
    return seccion.slice(seccion.indexOf('\n') + 1).trimEnd();
}

module.exports = leerSeccionSql;
