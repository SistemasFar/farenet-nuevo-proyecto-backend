const db = require('../../../config/database');

// Esta cuenta pertenece exclusivamente al flujo FAREGAS. El identificador
// usa un namespace propio para no colisionar con las cuentas legacy FARENET.
const CUENTA_FAREGAS = Object.freeze({
    key: 'FG_BBVA_00020564',
    entidadFinancieraKey: '6',
    entidad: 'BBVA CONTINENTAL',
    numero: '0011-0397-0100020564',
    numeroCorto: '0100020564',
    cci: '011-397-000100020564-79',
    monedaKey: 'sol',
    empresaKey: 'FAREGAS'
});

const obtenerMaestrosPago = async (queryable = db) => {
    const [formasPago, tarjetas, entidad, cuenta] = await Promise.all([
        queryable.query('SELECT key, nombre FROM formapago ORDER BY nombre ASC'),
        queryable.query('SELECT key, nombre FROM tarjeta ORDER BY nombre ASC'),
        queryable.query(
            'SELECT key, nombre FROM entidadfinanciera WHERE key = $1',
            [CUENTA_FAREGAS.entidadFinancieraKey]
        ),
        queryable.query(
            `SELECT key, nroctacorriente AS nombre, entidadfinanciera_key
             FROM cuentacorriente
             WHERE key = $1
               AND entidadfinanciera_key = $2
               AND nroctacorriente = $3
               AND empresa_key = $4
             LIMIT 1`,
            [
                CUENTA_FAREGAS.key,
                CUENTA_FAREGAS.entidadFinancieraKey,
                CUENTA_FAREGAS.numero,
                CUENTA_FAREGAS.empresaKey
            ]
        )
    ]);

    if (entidad.rowCount === 0 || cuenta.rowCount === 0) {
        throw new Error('CUENTA_FAREGAS_NO_CONFIGURADA');
    }

    return {
        formasPago: formasPago.rows,
        tarjetas: tarjetas.rows,
        entidadesFinancieras: entidad.rows,
        cuentasCorrientes: cuenta.rows,
        cuentaFaregas: {
            numero: CUENTA_FAREGAS.numeroCorto,
            numeroCompleto: CUENTA_FAREGAS.numero,
            cci: CUENTA_FAREGAS.cci,
            entidad: CUENTA_FAREGAS.entidad
        }
    };
};

const validarCuentaFaregas = async (queryable, cuentaCorrienteKey, entidadFinancieraKey) => {
    if (
        String(cuentaCorrienteKey || '') !== CUENTA_FAREGAS.key
        || String(entidadFinancieraKey || '') !== CUENTA_FAREGAS.entidadFinancieraKey
    ) {
        throw new Error('CUENTA_BANCARIA_INVALIDA');
    }

    const cuenta = await queryable.query(
        `SELECT 1
         FROM cuentacorriente
         WHERE key = $1
           AND entidadfinanciera_key = $2
           AND nroctacorriente = $3
           AND empresa_key = $4
         LIMIT 1`,
        [
            CUENTA_FAREGAS.key,
            CUENTA_FAREGAS.entidadFinancieraKey,
            CUENTA_FAREGAS.numero,
            CUENTA_FAREGAS.empresaKey
        ]
    );
    if (cuenta.rowCount === 0) throw new Error('CUENTA_BANCARIA_INVALIDA');
};

module.exports = {
    CUENTA_FAREGAS,
    obtenerMaestrosPago,
    validarCuentaFaregas
};
