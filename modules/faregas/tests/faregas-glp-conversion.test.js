const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const certificados = require('../services/faregas-certificados.service');

const ejecutarGuardadoGlp = async ({
    combustibleOriginal = 'GASOLINA',
    combustiblePosterior = 'BI-COMBUSTIBLE GLP'
} = {}) => {
    const originalConnect = db.connect;
    const originalAcceso = authService.validarAccesoPlanta;
    let parametrosGuardados = null;

    db.connect = async () => ({
        async query(sql, params = []) {
            const texto = String(sql);
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto)) return { rowCount: 0, rows: [] };
            if (texto.includes('SELECT estado, planta_key, tipo_certificado_clave')) {
                return { rowCount: 1, rows: [{ estado: 'BORRADOR', planta_key: '160', tipo_certificado_clave: 'GLP_ANUAL' }] };
            }
            if (texto.includes("FROM fg_taller_autorizado WHERE sede = 'SURQUILLO'")) {
                return { rowCount: 1, rows: [{ id: 160, razon_social: 'TALLER SURQUILLO', sede: 'SURQUILLO', direccion: 'PRUEBA', codigo_autorizacion: 'GLP-160' }] };
            }
            if (texto.includes('SELECT modalidad FROM fg_certificado_glp')) {
                return { rowCount: 0, rows: [] };
            }
            if (texto.includes('SELECT combustible') && texto.includes('FROM fg_certificado_vehiculo')) {
                return { rowCount: 1, rows: [{ combustible: combustibleOriginal }] };
            }
            if (texto.includes('INSERT INTO fg_certificado_glp')) {
                parametrosGuardados = params;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Consulta inesperada: ${texto}`);
        },
        release() {}
    });
    authService.validarAccesoPlanta = async () => true;

    try {
        await certificados.guardarGLP(801, {
            vigenciaHasta: '2027-10-09',
            expedienteTecnico: 'EXP-1',
            modalidad: 'INICIAL',
            combustiblePosterior,
            pesoNetoPosterior: '1450',
            cargaUtilPosterior: '149'
        }, { username: 'test', perfil_id: 1 });
        return parametrosGuardados;
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalAcceso;
    }
};

test('GLP INICIAL rechaza combustibles equivalentes con distinta puntuación', async () => {
    await assert.rejects(
        ejecutarGuardadoGlp({ combustibleOriginal: 'BI COMBUSTIBLE/GLP' }),
        (error) => error.code === 'GLP_COMBUSTIBLE_SIN_CAMBIO'
    );
});

test('GLP INICIAL permite un combustible original distinto', async () => {
    const parametros = await ejecutarGuardadoGlp({ combustibleOriginal: 'GASOLINA' });
    assert.ok(parametros);
    assert.equal(parametros[8], 'INICIAL');
    assert.equal(parametros[9], 'BI-COMBUSTIBLE GLP');
});
