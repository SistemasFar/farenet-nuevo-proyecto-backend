const test = require('node:test');
const assert = require('node:assert/strict');
const { reconciliarPendientesSunat } = require('../services/faregas-nubefact-cron.service');

const config = environment => ({
    nubefact: {
        environment,
        retryLockMs: 120000,
        reconciliationRetryMs: 900000,
        maxAttempts: 5
    }
});

test('entorno inválido no abre conexiones ni procesa documentos', async () => {
    let conexiones = 0;
    const resultado = await reconciliarPendientesSunat({
        integrationsConfig: config('LOCAL'),
        database: { connect: async () => { conexiones += 1; } }
    });
    assert.equal(conexiones, 0);
    assert.deepEqual(resultado, {
        procesados: 0, aceptados: 0, rechazados: 0, pendientes: 0, errores: 0, omitidos: 0
    });
});

test('integración deshabilitada no reclama filas aunque se invoque el worker', async () => {
    let conexiones = 0;
    const configuracion = config('DEMO');
    configuracion.nubefact.enabled = false;
    const resultado = await reconciliarPendientesSunat({
        integrationsConfig: configuracion,
        database: { connect: async () => { conexiones += 1; } }
    });
    assert.equal(conexiones, 0);
    assert.equal(resultado.procesados, 0);
    assert.equal(resultado.errores, 0);
});

test('lote vacío finaliza sin invocar al proveedor', async () => {
    let llamadasProveedor = 0;
    const client = {
        async query(sql) {
            if (String(sql).includes('SELECT f.id AS facturacion_id')) return { rows: [], rowCount: 0 };
            return { rows: [], rowCount: 0 };
        },
        release() {}
    };
    const resultado = await reconciliarPendientesSunat({
        integrationsConfig: config('DEMO'),
        database: { connect: async () => client },
        provider: { consultarComprobante: async () => { llamadasProveedor += 1; } }
    });
    assert.equal(llamadasProveedor, 0);
    assert.deepEqual(resultado, {
        procesados: 0, aceptados: 0, rechazados: 0, pendientes: 0, errores: 0, omitidos: 0
    });
});

test('flujo completo consulta una vez y persiste una aceptación', async () => {
    let numeroConexion = 0;
    let llamadasProveedor = 0;
    const consultasPersistencia = [];
    const fila = {
        facturacion_id: 1,
        certificado_id: 2,
        estado: 'PENDIENTE_SUNAT',
        serie: 'BBB1',
        numero: 18,
        tipo_comprobante: 'BOLETA',
        operacion_id: 3,
        planta_key: '201'
    };
    const claimClient = {
        async query(sql) {
            const texto = String(sql);
            if (texto.includes('SELECT f.id AS facturacion_id')) return { rows: [fila], rowCount: 1 };
            if (texto.includes('COALESCE(MAX(numero_intento)')) return { rows: [{ numero: 2 }], rowCount: 1 };
            if (texto.includes('INSERT INTO fg_facturacion_intento')) return { rows: [{ id: 77 }], rowCount: 1 };
            return { rows: [], rowCount: 1 };
        },
        release() {}
    };
    const persistClient = {
        async query(sql, params = []) {
            const texto = String(sql);
            consultasPersistencia.push({ sql: texto, params });
            if (texto.includes('SELECT f.estado')) return { rows: [{ estado: 'PENDIENTE_SUNAT' }], rowCount: 1 };
            return { rows: [], rowCount: 1 };
        },
        release() {}
    };
    const database = {
        connect: async () => (++numeroConexion === 1 ? claimClient : persistClient)
    };
    const provider = {
        consultarComprobante: async () => {
            llamadasProveedor += 1;
            return {
                status: 'ACCEPTED',
                httpStatus: 200,
                data: { aceptada_por_sunat: true, enlace_del_pdf: 'https://demo.test/bbb1-18.pdf' }
            };
        }
    };
    const configService = {
        resolverParaPlanta: async () => ({ credentials: { apiUrl: 'https://demo.test', token: '***' } })
    };

    const resultado = await reconciliarPendientesSunat({
        integrationsConfig: config('DEMO'),
        database,
        provider,
        configService
    });
    assert.equal(llamadasProveedor, 1);
    assert.equal(numeroConexion, 2);
    assert.deepEqual(resultado, {
        procesados: 1, aceptados: 1, rechazados: 0, pendientes: 0, errores: 0, omitidos: 0
    });
    assert.ok(consultasPersistencia.some(item => item.sql.includes("SET estado = 'ACEPTADO'")));
});

test('fallo al reclamar lote se reporta sin ocultarlo', async () => {
    const mensajes = [];
    const client = {
        async query(sql) {
            if (String(sql).includes('UPDATE fg_facturacion f')) throw new Error('database unavailable');
            return { rows: [], rowCount: 0 };
        },
        release() {}
    };
    const resultado = await reconciliarPendientesSunat({
        integrationsConfig: config('DEMO'),
        database: { connect: async () => client },
        logger: { error: (...args) => mensajes.push(args.join(' ')) }
    });
    assert.equal(resultado.errores, 1);
    assert.match(mensajes[0], /database unavailable/);
});
