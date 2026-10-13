const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const certificadosService = require('../services/faregas-certificados.service');

test('el panel entrega tipo y modalidad reales para construir el nombre del certificado', async () => {
    const queryOriginal = db.query;
    const plantasOriginal = authService.getPlantasPorUsuario;
    let consultaListado = '';

    authService.getPlantasPorUsuario = async () => [{ key: '201' }];
    db.query = async (sql) => {
        const texto = String(sql);
        if (texto.includes('COUNT(DISTINCT c.id)')) {
            return { rows: [{ count: '1' }] };
        }
        consultaListado = texto;
        return {
            rows: [{
                id: 10,
                tipoCertificadoClave: 'GNV_ANUAL',
                modalidad: 'ANUAL',
                conceptoVehicular: 'Certificado Anual',
            }],
        };
    };

    try {
        const resultado = await certificadosService.obtenerBorradores(
            1,
            10,
            '',
            { username: 'prueba', perfil_id: 1, planta_key: '201' },
        );

        assert.match(consultaListado, /t\.clave AS "tipoCertificadoClave"/);
        assert.match(consultaListado, /s\.modalidad/);
        assert.equal(resultado.data[0].tipoCertificadoClave, 'GNV_ANUAL');
        assert.equal(resultado.data[0].modalidad, 'ANUAL');
    } finally {
        db.query = queryOriginal;
        authService.getPlantasPorUsuario = plantasOriginal;
    }
});
