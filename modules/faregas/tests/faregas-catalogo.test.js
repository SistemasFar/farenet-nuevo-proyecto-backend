const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const service = require('../services/faregas-tarifas.service');
const controller = require('../controllers/faregas-tarifas.controller');

test.after(() => db.end());

const fila = (cambios = {}) => ({
    categoria_codigo: 'GLP',
    categoria_nombre: 'GLP',
    categoria_orden: 10,
    servicio_id: 1,
    servicio_codigo: 'GLP_ANUAL',
    servicio_nombre: 'Certificado Anual',
    servicio_orden: 10,
    tipo_flujo: 'CERTIFICACION',
    requiere_certificado: true,
    requiere_vehiculo: true,
    tipo_certificado_clave: 'GLP_ANUAL',
    modalidad: 'ANUAL',
    tarifa_id: 49,
    tarifa_codigo: 'GLP_ANUAL',
    precio: '60.00',
    ...cambios
});

test('construye categorías y servicios sin exponer datos de SKU', () => {
    const catalogo = service.construirCatalogo(
        { key: '201', nombre: 'INDEPENDENCIA' },
        [fila(), fila({
            servicio_id: 2,
            servicio_codigo: 'GLP_INICIAL',
            servicio_nombre: 'Certificado Inicial',
            servicio_orden: 20,
            modalidad: 'INICIAL',
            tarifa_id: 50,
            tarifa_codigo: 'GLP_INICIAL',
            precio: '80.00'
        })]
    );

    assert.equal(catalogo.sede.key, '201');
    assert.equal(catalogo.categorias.length, 1);
    assert.equal(catalogo.categorias[0].servicios.length, 2);
    assert.equal(catalogo.categorias[0].servicios[0].tipo_flujo, 'CERTIFICACION');
    assert.equal(catalogo.categorias[0].servicios[0].tarifa.precio, 60);
    assert.equal('producto_facturacion_id' in catalogo.categorias[0].servicios[0], false);
    assert.equal('codigo_sku' in catalogo.categorias[0].servicios[0], false);
});

test('el catálogo filtra sede, categoría, servicio y tarifa activos', async () => {
    const consultas = [];
    const queryable = {
        async query(sql, params) {
            consultas.push({ sql, params });
            if (consultas.length === 1) {
                return { rowCount: 1, rows: [{ key: '201', nombre: 'INDEPENDENCIA' }] };
            }
            return { rowCount: 1, rows: [fila()] };
        }
    };

    const catalogo = await service.obtenerCatalogoPorPlanta('201', queryable);
    assert.equal(catalogo.categorias[0].servicios[0].codigo, 'GLP_ANUAL');
    assert.deepEqual(consultas[0].params, ['201']);
    assert.deepEqual(consultas[1].params, ['201']);
    assert.match(consultas[0].sql, /fg_planta[\s\S]*activo = TRUE/i);
    assert.match(consultas[1].sql, /p\.activo = TRUE/i);
    assert.match(consultas[1].sql, /c\.activo = TRUE/i);
    assert.match(consultas[1].sql, /s\.activo = TRUE/i);
    assert.match(consultas[1].sql, /t\.activo = TRUE/i);
    assert.match(consultas[1].sql, /s\.tipo_flujo = 'CERTIFICACION'/i);
});

test('una sede activa sin tarifas devuelve catálogo vacío y no un error técnico', async () => {
    let consulta = 0;
    const queryable = {
        async query() {
            consulta += 1;
            return consulta === 1
                ? { rowCount: 1, rows: [{ key: '203', nombre: 'DERBY' }] }
                : { rowCount: 0, rows: [] };
        }
    };

    const catalogo = await service.obtenerCatalogoPorPlanta('203', queryable);
    assert.deepEqual(catalogo, {
        sede: { key: '203', nombre: 'DERBY' },
        categorias: []
    });
});

test('el controlador usa exclusivamente la planta autenticada', async () => {
    const original = service.obtenerCatalogoPorPlanta;
    let plantaConsultada;
    service.obtenerCatalogoPorPlanta = async (plantaKey) => {
        plantaConsultada = plantaKey;
        return { sede: { key: plantaKey, nombre: 'INDEPENDENCIA' }, categorias: [] };
    };

    const res = {
        statusCode: 200,
        payload: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; }
    };

    try {
        await controller.obtenerTarifasPorPlanta({
            user: { planta_key: '201' },
            query: { planta_key: '13' },
            body: { planta_key: '13' }
        }, res);
    } finally {
        service.obtenerCatalogoPorPlanta = original;
    }

    assert.equal(plantaConsultada, '201');
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.catalogo.sede.key, '201');
});

test('la tarifa oficial se resuelve con todas las entidades activas', async () => {
    let consulta;
    const queryable = {
        async query(sql, params) {
            consulta = { sql, params };
            return { rowCount: 1, rows: [fila()] };
        }
    };

    const tarifa = await service.obtenerTarifaOperativaPorCodigo('201', 'GLP_ANUAL', queryable);
    assert.equal(tarifa.precio, 60);
    assert.deepEqual(consulta.params, ['201', 'GLP_ANUAL']);
    assert.match(consulta.sql, /p\.activo = TRUE/i);
    assert.match(consulta.sql, /c\.activo = TRUE/i);
    assert.match(consulta.sql, /s\.activo = TRUE/i);
    assert.match(consulta.sql, /t\.activo = TRUE/i);
    assert.match(consulta.sql, /s\.tipo_flujo/i);
});

test('rechaza una tarifa de servicio complementario para operaciones de certificado', () => {
    assert.throws(
        () => service.validarTarifaCertificacion({ tipo_flujo: 'SERVICIO_COMPLEMENTARIO' }),
        /SERVICIO_NO_CERTIFICACION/
    );
    assert.equal(
        service.validarTarifaCertificacion({ tipo_flujo: 'CERTIFICACION', precio: 80 }).precio,
        80
    );
});
