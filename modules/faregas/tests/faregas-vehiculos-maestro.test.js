const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const farenetReadAdapter = require('../integrations/farenet-read.adapter');
const vehiculosService = require('../services/faregas-vehiculos.service');

const filaMaestro = (cambios = {}) => ({
    id: 1,
    placa: 'ABC123',
    placa_normalizada: 'ABC123',
    marca: 'TOYOTA',
    modelo: 'YARIS',
    color: 'NEGRO',
    numero_motor: 'AAA',
    ...cambios
});

const conFuentesSimuladas = async ({ maestro = null, legacy = null, farenet = null, errorFarenet = null }, accion) => {
    const queryOriginal = db.query;
    const farenetOriginal = farenetReadAdapter.buscarVehiculoPorPlaca;
    const consultas = [];
    db.query = async (sql, params) => {
        consultas.push({ sql, params });
        if (/FROM fg_vehiculo/i.test(sql)) {
            return { rowCount: maestro ? 1 : 0, rows: maestro ? [maestro] : [] };
        }
        if (/WITH candidatos AS/i.test(sql)) {
            return { rowCount: legacy ? 1 : 0, rows: legacy ? [legacy] : [] };
        }
        throw new Error(`Consulta inesperada: ${sql}`);
    };
    farenetReadAdapter.buscarVehiculoPorPlaca = async () => {
        if (errorFarenet) throw errorFarenet;
        return farenet;
    };
    try {
        return await accion(consultas);
    } finally {
        db.query = queryOriginal;
        farenetReadAdapter.buscarVehiculoPorPlaca = farenetOriginal;
    }
};

test('normaliza globalmente placa con trim y mayúsculas', () => {
    assert.equal(vehiculosService.normalizarPlaca(' abc123 '), 'ABC123');
});

test('usa FARENET como fuente inicial cuando FAREGAS no conoce la placa', async () => {
    await conFuentesSimuladas({
        farenet: { placa: 'ABC123', marca: 'TOYOTA', color: 'BLANCO' }
    }, async () => {
        const resultado = await vehiculosService.resolverVehiculoPorPlaca('ABC123');
        assert.equal(resultado.origen, 'FARENET');
        assert.equal(resultado.vehiculo.marca, 'TOYOTA');
    });
});

test('prioriza el maestro FAREGAS y usa FARENET solo para completar vacíos', async () => {
    await conFuentesSimuladas({
        maestro: filaMaestro({ combustible: null }),
        farenet: { placa: 'ABC123', marca: 'OTRA', color: 'BLANCO', combustible: 'GASOLINA' }
    }, async () => {
        const resultado = await vehiculosService.resolverVehiculoPorPlaca('ABC123');
        assert.equal(resultado.vehiculo.marca, 'TOYOTA');
        assert.equal(resultado.vehiculo.color, 'NEGRO');
        assert.equal(resultado.vehiculo.combustible, 'GASOLINA');
        assert.equal(resultado.origen, 'MIXTO');
    });
});

test('devuelve FAREGAS cuando FARENET está caído', async () => {
    await conFuentesSimuladas({
        maestro: filaMaestro(),
        errorFarenet: new Error('FARENET_NO_DISPONIBLE')
    }, async () => {
        const resultado = await vehiculosService.resolverVehiculoPorPlaca('ABC123');
        assert.equal(resultado.origen, 'FAREGAS');
        assert.equal(resultado.vehiculo.numeroMotor, 'AAA');
        assert.equal(resultado.errorFarenet.message, 'FARENET_NO_DISPONIBLE');
    });
});

test('excluye el snapshot del certificado actual del fallback legacy', async () => {
    await conFuentesSimuladas({ farenet: { placa: 'ABC123' } }, async (consultas) => {
        await vehiculosService.resolverVehiculoPorPlaca('ABC123', { excludeCertificadoId: 500 });
        const consultaLegacy = consultas.find(({ sql }) => /WITH candidatos AS/i.test(sql));
        assert.equal(consultaLegacy.params[1], 500);
        assert.match(consultaLegacy.sql, /v\.certificado_id <> \$2/);
        assert.match(consultaLegacy.sql, /completitud >= 5/);
    });
});

test('usa snapshot FAREGAS legacy cuando todavía no existe maestro', async () => {
    await conFuentesSimuladas({
        legacy: { ...filaMaestro(), certificado_id: 286 },
        farenet: { placa: 'ABC123', color: 'BLANCO' }
    }, async () => {
        const resultado = await vehiculosService.resolverVehiculoPorPlaca('ABC123');
        assert.equal(resultado.snapshotLegacyId, 286);
        assert.equal(resultado.vehiculo.color, 'NEGRO');
        assert.equal(resultado.origen, 'FAREGAS');
    });
});

test('el maestro es global y la búsqueda no filtra por planta', async () => {
    const consultas = [];
    const executor = {
        query: async (sql, params) => {
            consultas.push({ sql, params });
            return { rowCount: 1, rows: [filaMaestro()] };
        }
    };
    await vehiculosService.buscarMaestroPorPlaca('ABC123', executor);
    assert.doesNotMatch(consultas[0].sql, /planta/i);
    assert.deepEqual(consultas[0].params, ['ABC123']);
});

test('sincroniza maestro desde snapshot sin modificar el snapshot histórico ni borrar valores con vacíos', async () => {
    const consultas = [];
    const client = {
        query: async (sql, params) => {
            consultas.push({ sql, params });
            return {
                rowCount: 1,
                rows: [{ id: 9, placa: 'ABC123', placa_normalizada: 'ABC123', certificado_origen_id: 500, confirmado: true }]
            };
        }
    };

    const resultado = await vehiculosService.sincronizarMaestroDesdeSnapshot(client, 500, 'OPERADOR');
    assert.equal(resultado.certificado_origen_id, 500);
    assert.match(consultas[0].sql, /INSERT INTO fg_vehiculo/);
    assert.match(consultas[0].sql, /FROM fg_certificado_vehiculo/);
    assert.match(consultas[0].sql, /ON CONFLICT \(placa_normalizada\) DO UPDATE/);
    assert.match(consultas[0].sql, /COALESCE\(NULLIF\(BTRIM\(EXCLUDED\.numero_motor\)/);
    assert.match(consultas[0].sql, /numero_ejes IS NOT NULL/);
    assert.doesNotMatch(consultas[0].sql, /UPDATE\s+fg_certificado_vehiculo/i);
});
