const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../services/faregas-correlativos-nubefact.service');

const fila = ({ id, plantaKey = '201', empresaKey, tipo, serie, ultimo }) => ({
    id,
    planta_key: plantaKey,
    empresa_key: empresaKey,
    empresa_key_resolved: empresaKey,
    tipo_comprobante: tipo,
    serie,
    ultimo_numero: ultimo,
    autogenerada: true,
    proveedor_emision: 'NUBEFACT',
    entorno_emision: empresaKey === 'CAMBRIDGE' ? 'DEMO' : 'PRODUCCION',
    confirmada_produccion: empresaKey !== 'CAMBRIDGE',
    numero_inicial_confirmado: empresaKey === 'CAMBRIDGE' ? null : ultimo,
    sistema_origen: empresaKey === 'CAMBRIDGE' ? 'NUBEFACT_DEMO_COMPARTIDA' : 'DMS_FACT',
    fecha_corte: null
});

const crearExecutor = () => {
    const demo = new Map([
        ['BOLETA', fila({ id: 353, empresaKey: 'CAMBRIDGE', tipo: 'BOLETA', serie: 'BBB1', ultimo: 118 })],
        ['FACTURA', fila({ id: 352, empresaKey: 'CAMBRIDGE', tipo: 'FACTURA', serie: 'FFF1', ultimo: 2 })]
    ]);
    const produccion = new Map([
        ['13:BOLETA:FAREGAS', fila({ id: 9001, plantaKey: '13', empresaKey: 'FAREGAS', tipo: 'BOLETA', serie: 'B006', ultimo: 10 })],
        ['13:FACTURA:FAREGAS', fila({ id: 9002, plantaKey: '13', empresaKey: 'FAREGAS', tipo: 'FACTURA', serie: 'F006', ultimo: 20 })],
        ['98:BOLETA:FAREGAS', fila({ id: 9003, plantaKey: '98', empresaKey: 'FAREGAS', tipo: 'BOLETA', serie: 'B010', ultimo: 30 })],
        ['98:FACTURA:FAREGAS', fila({ id: 9004, plantaKey: '98', empresaKey: 'FAREGAS', tipo: 'FACTURA', serie: 'F010', ultimo: 40 })]
    ]);
    const consultas = [];

    return {
        consultas,
        demo,
        async query(sql, valores) {
            consultas.push({ sql, valores: [...valores] });
            if (/^\s*SELECT s\.\*/.test(sql)) {
                const esDemo = valores.length === 3;
                const row = esDemo
                    ? demo.get(valores[0])
                    : produccion.get(`${valores[0]}:${valores[1]}:${valores[3]}`);
                return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
            }
            if (/^\s*UPDATE fg_serie_comprobante/.test(sql)) {
                const [numero, id, anterior] = valores;
                const row = [...demo.values()].find((actual) => actual.id === id);
                if (!row || row.ultimo_numero !== anterior) return { rowCount: 0, rows: [] };
                row.ultimo_numero = numero;
                return { rowCount: 1, rows: [{ id }] };
            }
            throw new Error(`SQL no esperado: ${sql}`);
        }
    };
};

test('COLINA, ATE y SURCO resuelven la misma BBB1 DEMO sin filtrar por planta', async () => {
    const executor = crearExecutor();
    for (const plantaKey of ['13', '140', '98']) {
        const serie = await service.obtenerSeriePrevista({
            plantaKey,
            empresaKey: 'CAMBRIDGE',
            tipoComprobante: 'BOLETA',
            environment: 'DEMO'
        }, executor);
        assert.equal(serie.id, 353);
        assert.equal(serie.serie, 'BBB1');
        assert.equal(serie.plantaKey, '201', 'planta_key es sólo alojamiento técnico');
    }
    for (const consulta of executor.consultas) {
        assert.deepEqual(consulta.valores, ['BOLETA', 'DEMO', 'CAMBRIDGE']);
        assert.doesNotMatch(consulta.sql, /s\.planta_key = \$1/);
    }
});

test('COLINA, SURCO y ATE reservan un único contador BBB1 consecutivo', async () => {
    const executor = crearExecutor();
    const numeros = [];
    for (const plantaKey of ['13', '98', '140']) {
        const reserva = await service.reservarSiguiente({
            plantaKey,
            empresaKey: 'CAMBRIDGE',
            tipoComprobante: 'BOLETA',
            environment: 'DEMO'
        }, executor);
        numeros.push(reserva.numero);
        assert.equal(reserva.id, 353);
    }
    assert.deepEqual(numeros, [119, 120, 121]);
    assert.equal(executor.demo.get('BOLETA').ultimo_numero, 121);
    assert.equal(executor.consultas.filter(({ sql }) => /FOR UPDATE OF s/.test(sql)).length, 3);
});

test('COLINA, SURCO y ATE comparten también el contador FFF1', async () => {
    const executor = crearExecutor();
    const numeros = [];
    for (const plantaKey of ['13', '98', '140']) {
        const reserva = await service.reservarSiguiente({
            plantaKey,
            empresaKey: 'CAMBRIDGE',
            tipoComprobante: 'FACTURA',
            environment: 'DEMO'
        }, executor);
        numeros.push(reserva.numero);
        assert.equal(reserva.serie, 'FFF1');
    }
    assert.deepEqual(numeros, [3, 4, 5]);
});

test('PRODUCCION continúa filtrando por planta y empresa propietaria', async () => {
    const executor = crearExecutor();
    const casos = [
        ['13', 'BOLETA', 'B006'],
        ['13', 'FACTURA', 'F006'],
        ['98', 'BOLETA', 'B010'],
        ['98', 'FACTURA', 'F010']
    ];
    for (const [plantaKey, tipoComprobante, esperada] of casos) {
        const serie = await service.obtenerSeriePrevista({
            plantaKey,
            empresaKey: 'FAREGAS',
            tipoComprobante,
            environment: 'PRODUCCION'
        }, executor);
        assert.equal(serie.serie, esperada);
        assert.notEqual(serie.serie, tipoComprobante === 'FACTURA' ? 'FFF1' : 'BBB1');
    }
    for (const consulta of executor.consultas) {
        assert.match(consulta.sql, /s\.planta_key = \$1/);
        assert.equal(consulta.valores[3], 'FAREGAS');
        assert.notEqual(consulta.valores[3], 'CAMBRIDGE');
    }
});

test('BE11 no puede reaparecer y la empresa emisora es obligatoria', async () => {
    const executor = crearExecutor();
    const serie = await service.obtenerSeriePrevista({
        plantaKey: '13',
        empresaKey: 'CAMBRIDGE',
        tipoComprobante: 'BOLETA',
        environment: 'DEMO'
    }, executor);
    assert.equal(serie.serie, 'BBB1');
    assert.notEqual(serie.serie, 'BE11');

    await assert.rejects(
        () => service.obtenerSeriePrevista({
            plantaKey: '13', tipoComprobante: 'BOLETA', environment: 'DEMO'
        }, executor),
        (error) => error.code === 'EMPRESA_EMISORA_SERIE_REQUERIDA'
    );
});

test('dos filas candidatas se rechazan en vez de ocultarse con LIMIT 1', async () => {
    const executor = {
        async query() {
            const row = fila({ id: 1, empresaKey: 'CAMBRIDGE', tipo: 'BOLETA', serie: 'BBB1', ultimo: 1 });
            return { rowCount: 2, rows: [row, { ...row, id: 2 }] };
        }
    };
    await assert.rejects(
        () => service.obtenerSeriePrevista({
            plantaKey: '13', empresaKey: 'CAMBRIDGE', tipoComprobante: 'BOLETA', environment: 'DEMO'
        }, executor),
        (error) => error.code === 'SERIE_COMPROBANTE_AMBIGUA'
    );
});
