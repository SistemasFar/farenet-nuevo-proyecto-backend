const db = require('../../../config/database');

const cacheColumnas = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minuto de caché para reflejar migraciones sin saturar

/**
 * Comprueba de forma segura y no bloqueante si una columna existe en una tabla de PostgreSQL.
 * No genera errores de transacción ni aborta bloques BEGIN/COMMIT.
 *
 * @param {string} tabla Nombre de la tabla (ej. 'fg_certificado', 'fg_facturacion')
 * @param {string} columna Nombre de la columna (ej. 'fecha_hora_emision')
 * @param {object} [executor] Pool o cliente de base de datos (por defecto db)
 * @returns {Promise<boolean>} true si la columna existe, false en caso contrario
 */
async function tieneColumna(tabla, columna, executor = null) {
    const key = `${tabla}.${columna}`;
    const ahora = Date.now();
    const item = cacheColumnas.get(key);
    if (item && (ahora - item.timestamp) < CACHE_TTL_MS) {
        return item.existe;
    }

    try {
        const queryText = `
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = $1 AND column_name = $2
            LIMIT 1
        `;
        // Preferir db sobre un client transaccional para no mezclar comandos con la transacción en curso
        const queryable = (executor && typeof executor.query === 'function') ? executor : db;
        const res = await queryable.query(queryText, [tabla, columna]);
        const existe = res && res.rowCount > 0;
        cacheColumnas.set(key, { existe, timestamp: ahora });
        return existe;
    } catch (err) {
        // En caso de error, asumir de forma segura que la columna no existe
        return false;
    }
}

function _limpiarCacheColumnas() {
    cacheColumnas.clear();
}

function _forzarColumnaCache(tabla, columna, existe) {
    cacheColumnas.set(`${tabla}.${columna}`, { existe, timestamp: Date.now() });
}

module.exports = {
    tieneColumna,
    _limpiarCacheColumnas,
    _forzarColumnaCache
};

