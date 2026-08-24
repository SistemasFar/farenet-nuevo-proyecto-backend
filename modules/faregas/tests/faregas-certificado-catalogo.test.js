const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const tarifasService = require('../services/faregas-tarifas.service');
const certificadosService = require('../services/faregas-certificados.service');

test.after(() => db.end());

test('crear borrador conserva el contrato tarifaCodigo y deriva el tipo desde el catálogo oficial', async () => {
    const queryOriginal = db.query;
    const tarifaOriginal = tarifasService.obtenerTarifaOperativaPorCodigo;
    const consultas = [];

    tarifasService.obtenerTarifaOperativaPorCodigo = async (plantaKey, codigo) => {
        assert.equal(plantaKey, '201');
        assert.equal(codigo, 'GLP_ANUAL');
        return { tipo_flujo: 'CERTIFICACION', tipo_certificado_clave: 'GLP_ANUAL', precio: 60 };
    };
    db.query = async (sql, params) => {
        consultas.push({ sql, params });
        if (/SELECT activo FROM fg_tipo_certificado/i.test(sql)) {
            return { rowCount: 1, rows: [{ activo: true }] };
        }
        if (/INSERT INTO fg_certificado/i.test(sql)) {
            return { rowCount: 1, rows: [{ id: 987, estado: 'BORRADOR' }] };
        }
        throw new Error(`Consulta inesperada en la prueba: ${sql}`);
    };

    try {
        const borrador = await certificadosService.crearBorrador(
            { tarifaCodigo: 'GLP_ANUAL', observaciones: '' },
            { username: 'OPERADOR_TEST', perfil_id: 'OPERADOR', planta_key: '201' }
        );
        assert.deepEqual(borrador, { id: 987, estado: 'BORRADOR' });
        const insert = consultas.find((item) => /INSERT INTO fg_certificado/i.test(item.sql));
        assert.equal(insert.params[0], 'GLP_ANUAL');
        assert.equal(insert.params[1], 'GLP_ANUAL');
        assert.equal(insert.params[3], '201');
    } finally {
        db.query = queryOriginal;
        tarifasService.obtenerTarifaOperativaPorCodigo = tarifaOriginal;
    }
});

test('crear borrador rechaza directamente un servicio complementario', async () => {
    const queryOriginal = db.query;
    const tarifaOriginal = tarifasService.obtenerTarifaOperativaPorCodigo;
    let escribioCertificado = false;

    tarifasService.obtenerTarifaOperativaPorCodigo = async () => ({
        tipo_flujo: 'SERVICIO_COMPLEMENTARIO',
        tipo_certificado_clave: null,
        precio: 25
    });
    db.query = async (sql) => {
        if (/INSERT INTO fg_certificado/i.test(sql)) escribioCertificado = true;
        throw new Error(`Consulta inesperada: ${sql}`);
    };

    try {
        await assert.rejects(
            certificadosService.crearBorrador(
                { tarifaCodigo: 'TEST_COMPLEMENTARIO' },
                { username: 'OPERADOR_TEST', perfil_id: 'OPERADOR', planta_key: '201' }
            ),
            /SERVICIO_NO_CERTIFICACION/
        );
        assert.equal(escribioCertificado, false);
    } finally {
        db.query = queryOriginal;
        tarifasService.obtenerTarifaOperativaPorCodigo = tarifaOriginal;
    }
});
