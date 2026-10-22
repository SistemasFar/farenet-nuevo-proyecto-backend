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
    let consultaConteo = '';

    authService.getPlantasPorUsuario = async () => [{ key: '201' }];
    db.query = async (sql) => {
        const texto = String(sql);
        if (texto.includes('COUNT(DISTINCT c.id)')) {
            consultaConteo = texto;
            return { rows: [{ count: '1' }] };
        }
        consultaListado = texto;
        return {
            rows: [{
                id: 10,
                tipoCertificadoClave: 'GNV_ANUAL',
                modalidad: 'ANUAL',
                conceptoVehicular: 'Certificado Anual',
                propietarioTipoDocumento: 'DNI',
                propietarioDocumento: '74045612',
                propietarioNombre: 'GRACE',
                facturacionTipoDocumento: 'RUC',
                facturacionDocumento: '10329227621',
                facturacionNombre: 'WILMEN',
            }],
        };
    };

    try {
        const resultado = await certificadosService.obtenerBorradores(
            1,
            10,
            'WILMEN',
            { username: 'prueba', perfil_id: 1, planta_key: '201' },
        );

        assert.match(consultaListado, /t\.clave AS "tipoCertificadoClave"/);
        assert.match(consultaListado, /s\.modalidad/);
        assert.match(consultaListado, /tit\.tipo_documento AS "propietarioTipoDocumento"/);
        assert.match(consultaListado, /f\.tipo_documento_cliente AS "facturacionTipoDocumento"/);
        assert.match(consultaListado, /COALESCE\(f\.nro_documento, ''\) ILIKE/);
        assert.match(consultaListado, /COALESCE\(f\.nombre_razon_social, ''\) ILIKE/);
        assert.match(consultaConteo, /LEFT JOIN fg_facturacion f ON f\.certificado_id = c\.id/);
        assert.equal(resultado.data[0].tipoCertificadoClave, 'GNV_ANUAL');
        assert.equal(resultado.data[0].modalidad, 'ANUAL');
        assert.equal(resultado.data[0].propietarioDocumento, '74045612');
        assert.equal(resultado.data[0].facturacionDocumento, '10329227621');
    } finally {
        db.query = queryOriginal;
        authService.getPlantasPorUsuario = plantasOriginal;
    }
});
