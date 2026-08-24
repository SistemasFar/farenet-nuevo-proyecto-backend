const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const tarifasService = require('../services/faregas-tarifas.service');
const certificadosService = require('../services/faregas-certificados.service');

test.after(() => db.end());

test('crear borrador conserva el contrato tarifaCodigo y deriva el tipo desde el catálogo oficial', async () => {
    const queryOriginal = db.query;
    const connectOriginal = db.connect;
    const tarifaOriginal = tarifasService.obtenerTarifaOperativaPorCodigo;
    const consultas = [];

    tarifasService.obtenerTarifaOperativaPorCodigo = async (plantaKey, codigo) => {
        assert.equal(plantaKey, '201');
        assert.equal(codigo, 'GLP_ANUAL');
        return { tipo_flujo: 'CERTIFICACION', tipo_certificado_clave: 'GLP_ANUAL', precio: 60 };
    };
    const queryMock = async (sql, params) => {
        consultas.push({ sql, params });
        if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(String(sql).trim())) return { rowCount: 0, rows: [] };
        if (/SELECT activo FROM fg_tipo_certificado/i.test(sql)) {
            return { rowCount: 1, rows: [{ activo: true }] };
        }
        if (/INSERT INTO fg_certificado/i.test(sql)) {
            return { rowCount: 1, rows: [{ id: 987, estado: 'BORRADOR', pasoActual: 'PAGO' }] };
        }
        if (/INSERT INTO fg_certificado_vehiculo/i.test(sql)) {
            return { rowCount: 1, rows: [] };
        }
        throw new Error(`Consulta inesperada en la prueba: ${sql}`);
    };
    db.query = queryMock;
    db.connect = async () => ({ query: queryMock, release: () => undefined });

    try {
        const borrador = await certificadosService.crearBorrador(
            { tarifaCodigo: 'GLP_ANUAL', observaciones: '' },
            { username: 'OPERADOR_TEST', perfil_id: 'OPERADOR', planta_key: '201' }
        );
        assert.deepEqual(borrador, { id: 987, estado: 'BORRADOR', pasoActual: 'PAGO' });
        const insert = consultas.find((item) => /INSERT INTO fg_certificado/i.test(item.sql));
        assert.equal(insert.params[0], 'GLP_ANUAL');
        assert.equal(insert.params[1], 'GLP_ANUAL');
        assert.equal(insert.params[3], '201');
    } finally {
        db.query = queryOriginal;
        db.connect = connectOriginal;
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
