const test = require('node:test');
const assert = require('node:assert/strict');
const {
    _private: {
        reclamarLote,
        consultarFila,
        persistirResultado,
        esDocumentoNoEncontrado
    }
} = require('../services/faregas-nubefact-cron.service');

const crearDatabase = ({ filas = [], claimId = 900, erroresPrevios = 0, vigente = true } = {}) => {
    const consultas = [];
    const client = {
        releaseCount: 0,
        async query(sql, params = []) {
            const texto = String(sql);
            consultas.push({ sql: texto, params });
            if (texto.includes('SELECT f.id AS facturacion_id')) {
                return { rows: filas, rowCount: filas.length };
            }
            if (texto.includes('COALESCE(MAX(numero_intento)')) {
                return { rows: [{ numero: 4 }], rowCount: 1 };
            }
            if (texto.includes('INSERT INTO fg_facturacion_intento')) {
                return { rows: [{ id: claimId }], rowCount: 1 };
            }
            if (texto.includes('SELECT f.estado')) {
                return vigente
                    ? { rows: [{ estado: 'PENDIENTE' }], rowCount: 1 }
                    : { rows: [], rowCount: 0 };
            }
            if (texto.includes('SELECT COUNT(*)::integer AS total')) {
                return { rows: [{ total: erroresPrevios }], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
        },
        release() { this.releaseCount += 1; }
    };
    return {
        database: { connect: async () => client },
        client,
        consultas
    };
};

const filaPendiente = {
    facturacion_id: 10,
    certificado_id: 20,
    estado: 'PENDIENTE',
    serie: 'FFF1',
    numero: 7,
    tipo_comprobante: 'FACTURA',
    operacion_id: 30,
    planta_key: '201'
};

test('reclama PENDIENTE huérfano y PENDIENTE_SUNAT con bloqueo no bloqueante', async () => {
    const contexto = crearDatabase({ filas: [filaPendiente] });
    const filas = await reclamarLote({
        database: contexto.database,
        entorno: 'DEMO',
        batchSize: 10,
        pendingLeaseMs: 120000,
        reconciliationRetryMs: 900000,
        maxErrors: 5
    });

    const select = contexto.consultas.find(item => item.sql.includes('SELECT f.id AS facturacion_id'));
    assert.match(select.sql, /f\.estado IN \('PENDIENTE', 'PENDIENTE_SUNAT'\)/);
    assert.match(select.sql, /FOR UPDATE OF f SKIP LOCKED/);
    assert.equal(filas[0].claim_id, 900);
    assert.equal(contexto.client.releaseCount, 1);
});

test('el claim es persistente y refresca el lease antes de liberar la transacción', async () => {
    const contexto = crearDatabase({ filas: [filaPendiente] });
    await reclamarLote({
        database: contexto.database,
        entorno: 'DEMO',
        batchSize: 10,
        pendingLeaseMs: 120000,
        reconciliationRetryMs: 900000,
        maxErrors: 5
    });

    const indiceInsert = contexto.consultas.findIndex(item => item.sql.includes('INSERT INTO fg_facturacion_intento'));
    const indiceLease = contexto.consultas.findIndex(item => item.sql.includes('SET fecha_ultimo_intento'));
    const indiceCommit = contexto.consultas.findIndex(item => item.sql === 'COMMIT');
    assert.ok(indiceInsert >= 0 && indiceInsert < indiceCommit);
    assert.ok(indiceLease >= 0 && indiceLease < indiceCommit);
    const payloadClaim = JSON.parse(contexto.consultas[indiceInsert].params[2]);
    assert.equal(payloadClaim.operacion, 'consultar_comprobante');
});

test('el backoff de huérfanos y el de SUNAT viajan separados al SQL', async () => {
    const contexto = crearDatabase();
    await reclamarLote({
        database: contexto.database,
        entorno: 'DEMO',
        batchSize: 25,
        pendingLeaseMs: 180000,
        reconciliationRetryMs: 1200000,
        maxErrors: 4
    });
    const select = contexto.consultas.find(item => item.sql.includes('SELECT f.id AS facturacion_id'));
    assert.deepEqual(select.params, ['DEMO', 180000, 1200000, 'consultar_comprobante', 4, 25]);
});

test('la recuperación consulta y nunca ejecuta un segundo POST de emisión', async () => {
    let consultas = 0;
    let emisiones = 0;
    const provider = {
        consultarComprobante: async payload => {
            consultas += 1;
            assert.deepEqual(payload, { tipoDeComprobante: 1, serie: 'FFF1', numero: 7 });
            return { status: 'PENDING_SUNAT', data: {} };
        },
        emitirComprobante: async () => { emisiones += 1; }
    };
    const configService = {
        resolverParaPlanta: async () => ({ credentials: { apiUrl: 'https://demo.test', token: '***' } })
    };

    await consultarFila(filaPendiente, { provider, configService });
    assert.equal(consultas, 1);
    assert.equal(emisiones, 0);
});

test('documento no encontrado mantiene la incertidumbre y no lo rechaza', async () => {
    const contexto = crearDatabase();
    const resultado = {
        status: 'REJECTED',
        httpStatus: 400,
        data: { errors: 'Documento no existe' }
    };
    assert.equal(esDocumentoNoEncontrado(resultado), true);
    const persistencia = await persistirResultado({
        database: contexto.database,
        fila: { ...filaPendiente, claim_id: 900 },
        resultado,
        maxErrors: 5
    });
    const actualizacion = contexto.consultas.find(item => item.sql.includes("SET estado = 'PENDIENTE_SUNAT'"));
    assert.ok(actualizacion);
    assert.deepEqual(persistencia, { actualizada: true, estado: 'PENDIENTE_SUNAT' });
});

test('reconoce documento no encontrado dentro de un error estructurado', () => {
    assert.equal(esDocumentoNoEncontrado({
        status: 'REJECTED',
        data: { errors: { detalle: 'Documento no existe' } }
    }), true);
});

test('al alcanzar el máximo de errores técnicos termina en ERROR', async () => {
    const contexto = crearDatabase({ erroresPrevios: 2 });
    const persistencia = await persistirResultado({
        database: contexto.database,
        fila: { ...filaPendiente, claim_id: 900 },
        resultado: { status: 'ERROR', reason: 'TIMEOUT', error: 'ETIMEDOUT' },
        maxErrors: 3
    });
    const actualizacion = contexto.consultas.find(item => item.sql.includes('SET estado = $2'));
    assert.equal(actualizacion.params[1], 'ERROR');
    assert.deepEqual(persistencia, { actualizada: true, estado: 'ERROR' });
});

test('un rechazo funcional determinístico finaliza como RECHAZADO', async () => {
    const contexto = crearDatabase();
    const persistencia = await persistirResultado({
        database: contexto.database,
        fila: { ...filaPendiente, claim_id: 900 },
        resultado: {
            status: 'REJECTED',
            httpStatus: 400,
            data: { errors: 'RUC incorrecto' }
        },
        maxErrors: 5
    });
    assert.deepEqual(persistencia, { actualizada: true, estado: 'RECHAZADO' });
    assert.ok(contexto.consultas.some(item => item.sql.includes("SET estado = 'RECHAZADO'")));
});

test('una respuesta obsoleta no modifica la facturación', async () => {
    const contexto = crearDatabase({ vigente: false });
    const persistencia = await persistirResultado({
        database: contexto.database,
        fila: { ...filaPendiente, claim_id: 900 },
        resultado: { status: 'ACCEPTED', data: { aceptada_por_sunat: true } },
        maxErrors: 5
    });
    assert.deepEqual(persistencia, { actualizada: false, estado: 'OMITIDO' });
    assert.equal(
        contexto.consultas.some(item => item.sql.includes("SET estado = 'ACEPTADO'")),
        false
    );
    assert.ok(contexto.consultas.some(item => item.params.includes('STALE_RESULT_IGNORED') || item.sql.includes('STALE_RESULT_IGNORED')));
});
