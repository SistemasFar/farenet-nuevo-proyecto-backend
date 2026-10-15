const db = require('../../../config/database');

const EMPRESA_FAREGAS_KEY = 'FAREGAS';
const DIRECCION_HISTORICA_FAREGAS = 'JR. ALBERTO SECADA NRO. 315, PROV. CONST. DEL CALLAO, CALLAO';

function normalizarTexto(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function esDireccionCorporativaFaregas(value) {
    const direccion = normalizarTexto(value).toUpperCase();
    return direccion.includes('ALBERTO SECADA')
        && direccion.includes('315')
        && direccion.includes('CALLAO');
}

/**
 * Obtiene la identidad corporativa usada únicamente por la representación
 * impresa FAREGAS. No altera ni sustituye el emisor fiscal persistido por
 * NubeFact en fg_facturacion.
 */
async function obtenerIdentidadCorporativaFaregas(queryable = db) {
    const result = await queryable.query(
        `SELECT nombre, ruc, direccion
         FROM fg_empresa
         WHERE key = $1 AND activo = TRUE
         LIMIT 1`,
        [EMPRESA_FAREGAS_KEY]
    );

    if (result.rowCount === 0) {
        throw new Error('CONFIGURACION_REPRESENTACION_FAREGAS_NO_ENCONTRADA');
    }

    const empresa = result.rows[0];
    const razonSocial = normalizarTexto(empresa.nombre);
    const ruc = normalizarTexto(empresa.ruc);
    if (!razonSocial || !/^\d{11}$/.test(ruc)) {
        throw new Error('CONFIGURACION_REPRESENTACION_FAREGAS_INVALIDA');
    }

    const direccionConfigurada = normalizarTexto(process.env.FAREGAS_REPRESENTACION_DIRECCION);
    const direccionEmpresa = normalizarTexto(empresa.direccion);
    const direccion = direccionConfigurada
        || (esDireccionCorporativaFaregas(direccionEmpresa) ? direccionEmpresa : DIRECCION_HISTORICA_FAREGAS);

    return { razonSocial, ruc, direccion };
}

module.exports = {
    DIRECCION_HISTORICA_FAREGAS,
    esDireccionCorporativaFaregas,
    obtenerIdentidadCorporativaFaregas
};
