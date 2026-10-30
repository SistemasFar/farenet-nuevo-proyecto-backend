const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const { _private } = require('../services/faregas-notas-credito-worker.service');
const { _private: documentosPrivate } = require('../services/faregas-documentos-electronicos.service');

const config = {
    nubefact: {
        environment: 'DEMO',
        productionConfirmed: false,
        notasAutoEmissionEnabled: true,
        notasWorkerBatchSize: 10,
        notasWorkerLeaseMs: 120000,
        reconciliationRetryMs: 1000,
        maxAttempts: 5,
    },
};

const trabajoBase = (overrides = {}) => ({
    id: 7,
    solicitud_id: 41,
    certificado_id: 710,
    facturacion_id: 910,
    empresa_key: 'FAREGAS',
    planta_key: '98',
    motivo_codigo: '01',
    sustento_aprobado: 'Anulación autorizada',
    datos_aprobados: { motivoCodigo: '01', itemIndice: null, descripcionCorregida: null },
    usuario_ejecutor: 'gibarra',
    entorno_facturador: 'DEMO',
    facturacion_estado: 'ACEPTADO',
    facturacion_aceptada_sunat: true,
    facturacion_proveedor: 'NUBEFACT',
    facturacion_nro_comprobante: 'BBB1-00000257',
    facturacion_serie: 'BBB1',
    facturacion_numero: 257,
    facturacion_enlace_pdf: 'https://example.com/pdf',
    facturacion_enlace_xml: 'https://example.com/xml',
    usuario_perfil_id: 'SISTEMAS',
    propietario_bloqueo: '123e4567-e89b-42d3-a456-426614174000',
    ...overrides,
});

const dbProcesamiento = ({ notas = [], onUpdate = () => {} } = {}) => ({
    query: async (sql, params = []) => {
        const normal = String(sql).replace(/\s+/g, ' ').trim();
        if (normal.includes('FROM fg_credito')) return { rows: notas, rowCount: notas.length };
        if (normal.includes('FROM fg_documento_anulacion')) return { rows: [], rowCount: 0 };
        console.log('UNHANDLED_QUERY:', normal.substring(0, 80));
        if (normal.startsWith('UPDATE fg_nota_credito_trabajo')) {
            onUpdate({ sql: normal, params });
            return { rows: [], rowCount: 1 };
        }
        if (normal.startsWith('UPDATE fg_solicitud_operacion')) {
            onUpdate({ sql: normal, params });
            return { rows: [], rowCount: 1 };
        }
        throw new Error(`Consulta no simulada: ${normal}`);
    },
});

test('1. la aprobación crea una única intención persistente y auditable', async () => {
    const consultas = [];
    const executor = {
        query: async (sql, params = []) => {
            const normal = String(sql).replace(/\s+/g, ' ').trim();
            consultas.push({ sql: normal, params });
            if (normal.startsWith('INSERT INTO fg_nota_credito_trabajo')) {
                return { rows: [{ id: 7, solicitud_id: 41, estado: 'EN_COLA' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
        },
    };
    const worker = _private.crearWorker({ database: {}, documentos: {}, config });
    const resultado = await worker.encolarAprobacion(executor, {
        id: 41,
        tipo_operacion: 'EMITIR_NOTA_CREDITO',
        estado: 'APROBADA',
        certificado_id: 710,
        facturacion_id: 910,
        empresa_key: 'FAREGAS',
        planta_key: '98',
        motivo: 'Anulación autorizada',
        datos_propuestos: { motivoCodigo: '01' },
    }, 'gibarra');

    assert.equal(resultado.creada, true);
    assert.equal(consultas.filter((q) => q.sql.startsWith('INSERT INTO fg_nota_credito_trabajo')).length, 1);
    assert.match(consultas[0].sql, /ON CONFLICT \(solicitud_id\) DO NOTHING/);
    assert.ok(consultas.some((q) => q.sql.includes("'NOTA_CREDITO_ENCOLADA'")));
});

test('2. el worker reutiliza el motor existente y persiste una nota aceptada', async () => {
    const actualizaciones = [];
    let emisiones = 0;
    const proveedorNubefactSimulado = {
        emitirComprobante: async () => {
            emisiones += 1;
            return { status: 'ACCEPTED', data: { aceptada_por_sunat: true } };
        },
    };
    const worker = _private.crearWorker({
        database: dbProcesamiento({ onUpdate: (value) => actualizaciones.push(value) }),
        documentos: {
            emitirNota: async (_certificadoId, _tipo, data, _usuario, dependencies) => {
                assert.equal(data.solicitudId, 41);
                assert.equal(data.motivoCodigo, '01');
                const respuesta = await dependencies.nubefactService.emitirComprobante({ tipo_de_comprobante: 3 });
                assert.equal(respuesta.status, 'ACCEPTED');
                return { id: 80, estado: 'ACEPTADO', nroComprobante: 'BC01-00000001' };
            },
        },
        config,
    });
    const resultado = await worker._private.procesarReclamado(
        trabajoBase(),
        { nubefactService: proveedorNubefactSimulado }
    );
    assert.equal(resultado.estado, 'ACEPTADA');
    assert.equal(emisiones, 1);
    assert.ok(actualizaciones.some((item) => item.params[1] === 'ACEPTADA'));
    assert.ok(actualizaciones.some((item) => item.params[1] === 'COMPLETADA'));
});

test('2b. el marcador de cola no se confunde con una nota fiscal ya procesada', () => {
    assert.equal(documentosPrivate.esMarcadorColaNotaSinDocumento({
        tipoOperacion: 'NOTA_CREDITO',
        trabajoId: 7,
        estado: 'AUTORIZADA_EN_COLA',
    }), true);
    assert.equal(documentosPrivate.esMarcadorColaNotaSinDocumento({
        tipoOperacion: 'NOTA_CREDITO',
        notaId: 80,
        estado: 'PENDIENTE',
    }), false);
});

test('3. un comprobante original pendiente espera y no llama a NubeFact', async () => {
    let emisiones = 0;
    const estados = [];
    const worker = _private.crearWorker({
        database: dbProcesamiento({ onUpdate: ({ params }) => estados.push(params[1]) }),
        documentos: { emitirNota: async () => { emisiones += 1; } },
        config,
    });
    const resultado = await worker._private.procesarReclamado(trabajoBase({
        facturacion_estado: 'PENDIENTE_SUNAT',
        facturacion_aceptada_sunat: null,
        facturacion_enlace_pdf: null,
        facturacion_enlace_xml: null,
    }));
    assert.equal(resultado.estado, 'ESPERANDO_COMPROBANTE');
    assert.equal(emisiones, 0);
    assert.ok(estados.includes('ESPERANDO_COMPROBANTE'));
});

test('4. un resultado incierto con nota local consulta y nunca vuelve a emitir', async () => {
    let emisiones = 0;
    let consultas = 0;
    const nota = { id: 80, estado: 'PENDIENTE', motivo_codigo: '01', sustento: 'Anulación autorizada' };
    const worker = _private.crearWorker({
        database: dbProcesamiento({ notas: [nota] }),
        documentos: {
            emitirNota: async () => { emisiones += 1; },
            consultarNota: async () => {
                consultas += 1;
                return { id: 80, estado: 'PENDIENTE_SUNAT', nroComprobante: 'BC01-00000001' };
            },
        },
        config,
    });
    const resultado = await worker._private.procesarReclamado(trabajoBase({
        estado_anterior: 'RESULTADO_INCIERTO',
    }));
    assert.equal(resultado.estado, 'PENDIENTE_SUNAT');
    assert.equal(consultas, 1);
    assert.equal(emisiones, 0);
});

test('5. un snapshot incompleto bloquea el envío con una causa visible', async () => {
    const estados = [];
    const worker = _private.crearWorker({
        database: dbProcesamiento({ onUpdate: ({ params }) => estados.push(params[1]) }),
        documentos: {
            emitirNota: async () => {
                const error = new Error('Snapshot incompleto');
                error.code = 'SNAPSHOT_FISCAL_INCOMPLETO';
                throw error;
            },
        },
        config,
    });
    const resultado = await worker._private.procesarReclamado(trabajoBase());
    assert.equal(resultado.estado, 'BLOQUEADA');
    assert.ok(estados.includes('BLOQUEADA'));
});

test('6. el motivo 03 conserva exactamente la descripción aprobada', () => {
    const datos = _private.datosAprobados({
        datos_propuestos: {
            motivoCodigo: '03',
            itemIndice: 0,
            descripcionCorregida: 'CERTIFICADO GLP ANUAL CORREGIDO',
        },
    });
    assert.deepEqual(datos, {
        motivoCodigo: '03',
        itemIndice: 0,
        descripcionCorregida: 'CERTIFICADO GLP ANUAL CORREGIDO',
    });
});

test('7. la migración no hace backfill de solicitudes históricas', () => {
    const migration = fs.readFileSync(path.resolve(
        __dirname,
        '../database/migrations_history/20261030_faregas_cola_notas_credito.sql'
    ), 'utf8');
    assert.match(migration, /No realiza backfill/i);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+(?:public\.)?fg_nota_credito_trabajo\s*\([^;]*SELECT/is);
    assert.doesNotMatch(migration, /UPDATE\s+(?:public\.)?fg_solicitud_operacion/is);
});

test('8. la reclamación usa bloqueo transaccional para impedir dos workers', () => {
    const source = fs.readFileSync(path.resolve(
        __dirname,
        '../services/faregas-notas-credito-worker.service.js'
    ), 'utf8');
    assert.match(source, /FOR UPDATE OF t SKIP LOCKED/);
    assert.match(source, /propietario_bloqueo = \$2::uuid/);
    assert.match(source, /bloqueo_hasta/);
    assert.match(source, /uq_fg_nota_credito_trabajo_solicitud|ON CONFLICT \(solicitud_id\) DO NOTHING/);
});

test('9. dos workers sobre la misma cola producen una sola emisión', async () => {
    let bloqueado = false;
    let estado = 'EN_COLA';
    let emisiones = 0;
    const queueDb = {
        connect: async () => ({
            release() {},
            query: async (sql) => {
                const normal = String(sql).replace(/\s+/g, ' ').trim();
                if (normal === 'BEGIN' || normal === 'COMMIT' || normal === 'ROLLBACK') {
                    return { rows: [], rowCount: 0 };
                }
                if (normal.includes('FOR UPDATE OF t SKIP LOCKED')) {
                    if (bloqueado || estado !== 'EN_COLA') return { rows: [], rowCount: 0 };
                    bloqueado = true;
                    return { rows: [trabajoBase({ estado: 'EN_COLA' })], rowCount: 1 };
                }
                if (normal.startsWith('UPDATE fg_nota_credito_trabajo')) {
                    estado = 'EMITIENDO';
                    return { rows: [trabajoBase({ estado })], rowCount: 1 };
                }
                if (normal.startsWith('UPDATE fg_solicitud_operacion')) return { rows: [], rowCount: 1 };
                throw new Error(`Consulta no simulada: ${normal}`);
            },
        }),
        query: async (sql) => {
            const normal = String(sql).replace(/\s+/g, ' ').trim();
            if (normal.includes('FROM fg_credito')) return { rows: [], rowCount: 0 };
            if (normal.includes('FROM fg_documento_anulacion')) return { rows: [], rowCount: 0 };
            if (normal.startsWith('UPDATE fg_nota_credito_trabajo')) {
                estado = 'ACEPTADA';
                return { rows: [], rowCount: 1 };
            }
            if (normal.startsWith('UPDATE fg_solicitud_operacion')) return { rows: [], rowCount: 1 };
            throw new Error(`Consulta no simulada: ${normal}`);
        },
    };
    const documentos = {
        emitirNota: async () => {
            emisiones += 1;
            await new Promise((resolve) => setImmediate(resolve));
            return { id: 80, estado: 'ACEPTADO' };
        },
    };
    const workerA = _private.crearWorker({ database: queueDb, documentos, config, crearPropietario: () => '123e4567-e89b-42d3-a456-426614174000' });
    const workerB = _private.crearWorker({ database: queueDb, documentos, config, crearPropietario: () => '123e4567-e89b-42d3-a456-426614174001' });
    const [a, b] = await Promise.all([
        workerA.procesarPendientes({ batchSize: 1 }),
        workerB.procesarPendientes({ batchSize: 1 }),
    ]);
    assert.equal(a.reclamados + b.reclamados, 1);
    assert.equal(emisiones, 1);
});

test('10. una instancia nueva recupera un trabajo EN_COLA persistido', async () => {
    let disponible = true;
    let emisiones = 0;
    const persistedDb = {
        connect: async () => ({
            release() {},
            query: async (sql) => {
                const normal = String(sql).replace(/\s+/g, ' ').trim();
                if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normal)) return { rows: [], rowCount: 0 };
                if (normal.includes('FOR UPDATE OF t SKIP LOCKED')) {
                    if (!disponible) return { rows: [], rowCount: 0 };
                    disponible = false;
                    return { rows: [trabajoBase({ estado: 'EN_COLA' })], rowCount: 1 };
                }
                if (normal.startsWith('UPDATE fg_nota_credito_trabajo')) {
                    return { rows: [trabajoBase({ estado: 'EMITIENDO' })], rowCount: 1 };
                }
                if (normal.startsWith('UPDATE fg_solicitud_operacion')) return { rows: [], rowCount: 1 };
                throw new Error(`Consulta no simulada: ${normal}`);
            },
        }),
        query: async (sql) => {
            const normal = String(sql).replace(/\s+/g, ' ').trim();
            if (normal.includes('FROM fg_credito')) return { rows: [], rowCount: 0 };
            if (normal.includes('FROM fg_documento_anulacion')) return { rows: [], rowCount: 0 };
            if (normal.startsWith('UPDATE fg_nota_credito_trabajo')) return { rows: [], rowCount: 1 };
            if (normal.startsWith('UPDATE fg_solicitud_operacion')) return { rows: [], rowCount: 1 };
            throw new Error(`Consulta no simulada: ${normal}`);
        },
    };
    // Simula un backend nuevo: no hay memoria compartida con el proceso que encoló.
    const workerReiniciado = _private.crearWorker({
        database: persistedDb,
        documentos: { emitirNota: async () => { emisiones += 1; return { id: 80, estado: 'ACEPTADO' }; } },
        config,
        crearPropietario: () => '123e4567-e89b-42d3-a456-426614174002',
    });
    const resultado = await workerReiniciado.procesarPendientes({ batchSize: 1 });
    assert.equal(resultado.reclamados, 1);
    assert.equal(emisiones, 1);
});

test('11. la cola queda deshabilitada hasta activarla explícitamente', async () => {
    const worker = _private.crearWorker({
        database: {},
        documentos: {},
        config: { nubefact: { notasAutoEmissionEnabled: false } },
    });
    assert.deepEqual(await worker.procesarPendientes(), {
        habilitado: false,
        reclamados: 0,
        resultados: [],
    });
});
