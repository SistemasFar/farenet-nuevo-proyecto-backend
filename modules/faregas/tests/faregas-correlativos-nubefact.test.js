const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const correlativos = require('../services/faregas-correlativos-nubefact.service');

const serieDemo = (environment = 'DEMO') => ({
    id: 352,
    planta_key: '201',
    empresa_key: 'CAMBRIDGE',
    empresa_key_resolved: 'CAMBRIDGE',
    tipo_comprobante: 'FACTURA',
    serie: 'FFF1',
    ultimo_numero: 43,
    autogenerada: true,
    proveedor_emision: 'NUBEFACT',
    entorno_emision: environment,
    confirmada_produccion: environment === 'PRODUCCION',
    numero_inicial_confirmado: null
});

const crearExecutor = ({ lastNumber = 43, localRows = [] } = {}) => {
    const state = { lastNumber, localRows, updates: [], selects: [] };
    const executor = {
        query: async (sql, params = []) => {
            const statement = sql.replace(/\s+/g, ' ').trim();
            if (statement.includes('FROM fg_serie_comprobante s')) {
                state.selects.push({ statement, params });
                const environment = params.includes('PRODUCCION') ? 'PRODUCCION' : 'DEMO';
                return { rowCount: 1, rows: [{ ...serieDemo(environment), ultimo_numero: state.lastNumber }] };
            }
            if (statement.includes('FROM fg_facturacion')) {
                const rows = state.localRows.filter(row => row.numero === params[1]);
                return { rowCount: rows.length, rows };
            }
            if (statement.startsWith('UPDATE fg_serie_comprobante')) {
                state.updates.push(params);
                if (state.lastNumber !== params[2]) return { rowCount: 0, rows: [] };
                state.lastNumber = params[0];
                return { rowCount: 1, rows: [{ id: params[1] }] };
            }
            throw new Error(`SQL no previsto en el mock: ${statement}`);
        }
    };
    return { executor, state };
};

const providerDePrueba = (resultForNumber, seen = []) => ({
    consultarComprobante: async (payload) => {
        seen.push(payload.numero);
        return resultForNumber(payload.numero);
    }
});

const noExiste = { status: 'REJECTED', data: { errors: 'El comprobante no existe' } };
const ocupadoRechazado = { status: 'REJECTED', data: { errors: 'Este documento ya existe en NubeFact' } };

describe('Reserva transaccional de correlativos NubeFact', () => {
    it('reserva el primer candidato que NubeFact confirma disponible', async () => {
        const { executor, state } = crearExecutor();
        const vistos = [];
        const reserva = await correlativos.reservarSiguienteDisponible({
            plantaKey: '98', empresaKey: 'CAMBRIDGE', tipoComprobante: 'FACTURA',
            environment: 'DEMO', credentials: { apiUrl: 'demo', token: 'mock' },
            provider: providerDePrueba(() => noExiste, vistos)
        }, executor);

        assert.equal(reserva.numero, 44);
        assert.equal(reserva.nroComprobante, 'FFF1-00000044');
        assert.equal(reserva.disponibleEnNubefact, true);
        assert.deepEqual(vistos, [44]);
        assert.equal(state.lastNumber, 44);
        assert.match(state.selects[0].statement, /FOR UPDATE OF s/);
    });

    it('salta solo candidatos que NubeFact confirmó ocupados, incluidos los rechazados', async () => {
        const { executor, state } = crearExecutor();
        const vistos = [];
        const reserva = await correlativos.reservarSiguienteDisponible({
            plantaKey: '98', empresaKey: 'CAMBRIDGE', tipoComprobante: 'FACTURA',
            environment: 'DEMO', credentials: { apiUrl: 'demo', token: 'mock' },
            provider: providerDePrueba(number => number === 44 ? ocupadoRechazado : noExiste, vistos)
        }, executor);

        assert.deepEqual(vistos, [44, 45]);
        assert.equal(reserva.numero, 45);
        assert.equal(reserva.candidatosOcupados, 1);
        assert.equal(state.lastNumber, 45);
        assert.deepEqual(state.updates, [[45, 352, 43]]);
    });

    it('no avanza el contador ante consulta ambigua o error de proveedor', async () => {
        for (const answer of [
            { status: 'ERROR', reason: 'NETWORK_ERROR' },
            { status: 'REJECTED', data: { errors: 'No se pudo validar el documento' } }
        ]) {
            const { executor, state } = crearExecutor();
            await assert.rejects(
                correlativos.reservarSiguienteDisponible({
                    plantaKey: '98', empresaKey: 'CAMBRIDGE', tipoComprobante: 'FACTURA',
                    environment: 'DEMO', credentials: { apiUrl: 'demo', token: 'mock' },
                    provider: providerDePrueba(() => answer)
                }, executor),
                error => error.code === 'NUBEFACT_VALIDACION_CORRELATIVO_NO_DISPONIBLE'
            );
            assert.equal(state.lastNumber, 43);
            assert.equal(state.updates.length, 0);
        }
    });

    it('se detiene ante una reserva local por encima del contador y no consulta al proveedor', async () => {
        const { executor, state } = crearExecutor({ localRows: [{ numero: 44, id: 99, estado: 'PENDIENTE' }] });
        let providerCalls = 0;
        await assert.rejects(
            correlativos.reservarSiguienteDisponible({
                plantaKey: '98', empresaKey: 'CAMBRIDGE', tipoComprobante: 'FACTURA',
                environment: 'DEMO', credentials: { apiUrl: 'demo', token: 'mock' },
                provider: { consultarComprobante: async () => { providerCalls += 1; return noExiste; } }
            }, executor),
            error => error.code === 'CORRELATIVO_RESERVADO_LOCALMENTE'
        );
        assert.equal(providerCalls, 0);
        assert.equal(state.updates.length, 0);
    });

    it('serializa dos reservas concurrentes y nunca devuelve el mismo número', async () => {
        const { executor, state } = crearExecutor();
        const argumentos = {
            plantaKey: '98', empresaKey: 'CAMBRIDGE', tipoComprobante: 'FACTURA',
            environment: 'DEMO', credentials: { apiUrl: 'demo', token: 'mock' },
            provider: providerDePrueba(() => noExiste)
        };
        const resultados = await Promise.allSettled([
            correlativos.reservarSiguienteDisponible(argumentos, executor),
            correlativos.reservarSiguienteDisponible(argumentos, executor)
        ]);
        const numeros = resultados.filter(item => item.status === 'fulfilled').map(item => item.value.numero);
        assert.equal(new Set(numeros).size, numeros.length);
        assert.equal(numeros.length, 1);
        assert.equal(state.lastNumber, 44);
        assert.ok(resultados.some(item => item.status === 'rejected'
            && item.reason.code === 'CORRELATIVO_CONCURRENCIA'));
    });

    it('mantiene el alcance DEMO por empresa y el de PRODUCCIÓN por empresa y planta', async () => {
        for (const environment of ['DEMO', 'PRODUCCION']) {
            const { executor, state } = crearExecutor();
            await correlativos.obtenerSeriePrevista({
                plantaKey: '98', empresaKey: 'CAMBRIDGE', tipoComprobante: 'FACTURA', environment
            }, executor);
            const query = state.selects[0];
            assert.match(query.statement, /COALESCE\(s\.empresa_key, p\.empresa_key\)/);
            assert.match(query.statement, /s\.tipo_comprobante/);
            assert.match(query.statement, /s\.entorno_emision/);
            if (environment === 'DEMO') assert.doesNotMatch(query.statement, /s\.planta_key = \$1/);
            else assert.match(query.statement, /s\.planta_key = \$1/);
            assert.deepEqual(query.params, environment === 'DEMO'
                ? ['FACTURA', 'DEMO', 'CAMBRIDGE']
                : ['98', 'FACTURA', 'PRODUCCION', 'CAMBRIDGE']);
        }
    });

    it('corta la búsqueda en el límite configurado y no actualiza el contador si todos están ocupados', async () => {
        const { executor, state } = crearExecutor();
        const vistos = [];
        await assert.rejects(
            correlativos.reservarSiguienteDisponible({
                plantaKey: '98', empresaKey: 'CAMBRIDGE', tipoComprobante: 'FACTURA',
                environment: 'DEMO', credentials: { apiUrl: 'demo', token: 'mock' },
                maxCandidatos: 5,
                provider: providerDePrueba(() => ocupadoRechazado, vistos)
            }, executor),
            error => error.code === 'NUBEFACT_SIN_CORRELATIVO_DISPONIBLE'
                && error.detalles.candidatosConsultados === 5
        );
        assert.deepEqual(vistos, [44, 45, 46, 47, 48]);
        assert.equal(state.lastNumber, 43);
        assert.equal(state.updates.length, 0);
    });
});
