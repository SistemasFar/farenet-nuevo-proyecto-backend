const test = require('node:test');
const leerSeccionSql = require('./leer-seccion-sql');
const assert = require('node:assert/strict');
const path = require('node:path');

const rules = require('../services/faregas-chips-codigos-disponibles.rules');

const createFakeDb = ({ initialChips = [], codigoAutogenerable = true, sedeActiva = true, migrationAvailable = true } = {}) => {
    const state = {
        chips: new Map(initialChips.map((chip) => [chip.numero_chip, { ...chip }])),
        reservations: new Map(),
        codigoAutogenerable,
        sedeActiva,
        migrationAvailable,
        nextId: 1000,
        advisoryLock: Promise.resolve()
    };

    const connect = async () => {
        let releaseLock = null;
        let heldLock = false;
        const client = {
            async query(sql, params = []) {
                const q = sql.replace(/\s+/g, ' ').trim();
                if (q === 'BEGIN') return { rows: [], rowCount: 0 };
                if (q === 'COMMIT' || q === 'ROLLBACK') {
                    if (heldLock) releaseLock?.();
                    heldLock = false;
                    return { rows: [], rowCount: 0 };
                }
                if (q.startsWith('SELECT pg_advisory_xact_lock')) {
                    const previous = state.advisoryLock;
                    let unlock;
                    state.advisoryLock = new Promise((resolve) => { unlock = resolve; });
                    await previous;
                    releaseLock = unlock;
                    heldLock = true;
                    return { rows: [], rowCount: 1 };
                }
                if (q.includes("to_regclass('public.fg_chip_codigo_reserva')")) {
                    return { rows: [{ disponible: state.migrationAvailable }], rowCount: 1 };
                }
                if (q.startsWith('DELETE FROM fg_chip_codigo_reserva WHERE vence_en <= NOW()')) {
                    const now = Date.now();
                    for (const [code, reservation] of state.reservations) {
                        if (reservation.venceEn <= now) state.reservations.delete(code);
                    }
                    return { rows: [], rowCount: 0 };
                }
                if (q.includes('FROM fg_producto_inventariable pi')) {
                    const product = {
                        id: 41,
                        codigo: 'CHIP',
                        nombre: 'Chip serializado de prueba',
                        tipo: 'CHIP_SERIALIZADO',
                        codigo_autogenerable: state.codigoAutogenerable
                    };
                    return { rows: [product], rowCount: 1 };
                }
                if (q.includes('FROM fg_producto_inventariable_sede')) {
                    return { rows: [], rowCount: state.sedeActiva ? 1 : 0 };
                }
                if (q.includes('FROM fg_chip WHERE numero_chip = ANY')) {
                    const rows = params[0].filter((code) => state.chips.has(code)).map((numero_chip) => ({ numero_chip }));
                    return { rows, rowCount: rows.length };
                }
                if (q.includes('FROM fg_chip_codigo_reserva') && q.includes('numero_chip = ANY')) {
                    const rows = params[0].filter((code) => {
                        const reservation = state.reservations.get(code);
                        return reservation && reservation.venceEn > Date.now();
                    }).map((numero_chip) => ({ numero_chip }));
                    return { rows, rowCount: rows.length };
                }
                if (q.startsWith('INSERT INTO fg_chip_codigo_reserva')) {
                    const [token, codigos, productoId, plantaKey, usuario, duracion] = params;
                    const venceEn = Date.now() + Number(duracion) * 60_000;
                    for (const code of codigos) {
                        if (state.chips.has(code) || state.reservations.has(code)) {
                            const error = new Error('duplicate');
                            error.code = '23505';
                            error.constraint = 'uq_fg_chip_codigo_reserva_numero';
                            throw error;
                        }
                        state.reservations.set(code, { token, productoId, plantaKey, usuario, venceEn });
                    }
                    return { rows: codigos.map(() => ({ vence_en: new Date(venceEn).toISOString() })), rowCount: codigos.length };
                }
                if (q.startsWith('SELECT') && q.includes('FROM fg_chip_codigo_reserva') && q.includes('WHERE token =')) {
                    const [token, productoId, plantaKey] = params;
                    const rows = [...state.reservations.entries()]
                        .filter(([, reservation]) => reservation.token === token
                            && reservation.productoId === productoId
                            && reservation.plantaKey === plantaKey)
                        .map(([numero_chip, reservation]) => ({ numero_chip, vence_en: new Date(reservation.venceEn).toISOString() }))
                        .sort((a, b) => a.numero_chip.localeCompare(b.numero_chip));
                    return { rows, rowCount: rows.length };
                }
                if (q.startsWith('INSERT INTO fg_chip (')) {
                    const [productoId, numero_chip, plantaKey, usuario] = params;
                    if (state.chips.has(numero_chip)) {
                        const error = new Error('duplicate');
                        error.code = '23505';
                        error.constraint = 'fg_chip_numero_chip_key';
                        throw error;
                    }
                    const chip = { id: state.nextId++, numero_chip, estado: 'DISPONIBLE', productoId, plantaKey, usuario };
                    state.chips.set(numero_chip, chip);
                    return { rows: [chip], rowCount: 1 };
                }
                if (q.startsWith('INSERT INTO fg_chip_movimiento')) return { rows: [], rowCount: 1 };
                if (q.startsWith('DELETE FROM fg_chip_codigo_reserva WHERE token =')) {
                    const [token] = params;
                    let rowCount = 0;
                    for (const [code, reservation] of state.reservations) {
                        if (reservation.token === token) { state.reservations.delete(code); rowCount += 1; }
                    }
                    return { rows: [], rowCount };
                }
                throw new Error(`SQL no contemplado en fake DB: ${q}`);
            },
            release() {
                if (heldLock) releaseLock?.();
                heldLock = false;
            }
        };
        return client;
    };

    return { state, connect, query: async () => ({ rows: [], rowCount: 0 }) };
};

const cargarServicioConDbFalsa = (fakeDb) => {
    const dbPath = require.resolve('../../../config/database', { paths: [path.join(__dirname, '..', 'services')] });
    const authPath = require.resolve('../services/faregas-auth.service');
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
    require.cache[authPath] = {
        id: authPath,
        filename: authPath,
        loaded: true,
        exports: { validarAccesoPlanta: async () => true }
    };
    const servicePath = require.resolve('../services/faregas-chips.service');
    delete require.cache[servicePath];
    return require(servicePath);
};

test('reglas de generación conservan formato, prefijo, saltos y ceros a la izquierda', () => {
    const ocupados = Array.from({ length: 6 }, (_, index) => `CHIP${index + 1}`);
    const seis = rules.generarCodigosDisponibles({ prefijo: 'chip', cantidad: 6, digitos: 1, minimo: 1, ocupados });
    assert.deepEqual(seis.codigos, ['CHIP7', 'CHIP8', 'CHIP9', 'CHIP10', 'CHIP11', 'CHIP12']);
    assert.deepEqual(seis.omitidos, ocupados);

    const huecos = rules.generarCodigosDisponibles({ prefijo: 'X-', cantidad: 4, digitos: 2, minimo: 1, ocupados: ['X-01', 'X-03', 'X-05'] });
    assert.deepEqual(huecos.codigos, ['X-02', 'X-04', 'X-06', 'X-07']);
    assert.deepEqual(huecos.omitidos, ['X-01', 'X-03', 'X-05']);

    const zeros = rules.generarCodigosDisponibles({ prefijo: 'PORTA_', cantidad: 3, digitos: 3, minimo: 7, ocupados: ['PORTA_007', 'PORTA_008'] });
    assert.deepEqual(zeros.codigos, ['PORTA_009', 'PORTA_010', 'PORTA_011']);
    assert.throws(() => rules.generarCodigosDisponibles({ prefijo: 'A', cantidad: 501, digitos: 1 }), /CODIGOS_DISPONIBLES_SOLICITUD_INVALIDA/);
    assert.throws(() => rules.generarCodigosDisponibles({ prefijo: 'CHIP%', cantidad: 1, digitos: 1 }), /CODIGOS_DISPONIBLES_SOLICITUD_INVALIDA/);
});

test('propuesta y confirmación consultan el inventario global y crean una sola vez', async () => {
    const estadosHistoricos = ['DISPONIBLE', 'RESERVADO', 'VENDIDO', 'BAJA', 'VENDIDO', 'RESERVADO'];
    const fakeDb = createFakeDb({ initialChips: Array.from({ length: 6 }, (_, index) => ({
        numero_chip: `CHIP${index + 1}`,
        estado: estadosHistoricos[index],
        productoInventariableId: 999,
        plantaKey: '13'
    })) });
    const service = cargarServicioConDbFalsa(fakeDb);
    const user = { username: 'test', perfil_id: 'TEST' };
    const solicitud = { plantaKey: '98', productoInventariableId: 41, prefijo: 'CHIP', cantidad: 6, digitos: 1, minimo: 1 };
    const propuesta = await service.proponerCodigosDisponibles(solicitud, user);
    assert.deepEqual(propuesta.codigos, ['CHIP7', 'CHIP8', 'CHIP9', 'CHIP10', 'CHIP11', 'CHIP12']);
    assert.deepEqual(propuesta.omitidos, ['CHIP1', 'CHIP2', 'CHIP3', 'CHIP4', 'CHIP5', 'CHIP6']);
    assert.equal(fakeDb.state.reservations.size, 6);

    const creados = await service.ingresar({
        plantaKey: '98', productoInventariableId: 41, numeros: propuesta.codigos,
        modoCodigo: 'GENERADOS', tokenPropuesta: propuesta.token
    }, user);
    assert.equal(creados.length, 6);
    assert.equal(fakeDb.state.chips.size, 12);
    assert.equal(fakeDb.state.reservations.size, 0);
});

test('rango exacto informa duplicados históricos y no reemplaza seriales físicos', async () => {
    const fakeDb = createFakeDb({ initialChips: [{ numero_chip: 'PHYS-001', estado: 'VENDIDO', productoInventariableId: 999, plantaKey: '13' }] });
    const service = cargarServicioConDbFalsa(fakeDb);
    await assert.rejects(
        service.ingresar({ plantaKey: '98', productoInventariableId: 41, numeros: ['PHYS-001', 'PHYS-002'] }, { username: 'test' }),
        (error) => error.message === 'CHIP_DUPLICADO' && error.detalles.includes('PHYS-001')
    );
    assert.equal(fakeDb.state.chips.has('PHYS-002'), false);
});

test('propuestas concurrentes y rangos exactos no pueden tomar códigos reservados', async () => {
    const fakeDb = createFakeDb();
    const service = cargarServicioConDbFalsa(fakeDb);
    const user = { username: 'test', perfil_id: 'TEST' };
    const base = { plantaKey: '98', productoInventariableId: 41, prefijo: 'CHIP', cantidad: 1, digitos: 2, minimo: 30 };
    const [primera, segunda] = await Promise.all([
        service.proponerCodigosDisponibles(base, user),
        service.proponerCodigosDisponibles(base, user)
    ]);
    assert.deepEqual(primera.codigos, ['CHIP30']);
    assert.deepEqual(segunda.codigos, ['CHIP31']);

    await assert.rejects(
        service.ingresar({ plantaKey: '98', productoInventariableId: 41, numeros: ['CHIP30'] }, user),
        (error) => error.message === 'CHIP_CODIGO_RESERVADO' && error.detalles.includes('CHIP30')
    );
    await assert.rejects(
        service.ingresar({ plantaKey: '98', productoInventariableId: 41, numeros: ['CHIP30', 'CHIP30'] }, user),
        (error) => error.message === 'LOTE_CHIPS_INVALIDO'
    );
});

test('producto sin opt-in o no habilitado en sede no puede generar códigos', async () => {
    const user = { username: 'test', perfil_id: 'TEST' };
    const disabledService = cargarServicioConDbFalsa(createFakeDb({ codigoAutogenerable: false }));
    await assert.rejects(
        disabledService.proponerCodigosDisponibles({ plantaKey: '98', productoInventariableId: 41, prefijo: 'CHIP', cantidad: 1, digitos: 3 }, user),
        (error) => error.message === 'CODIGOS_DISPONIBLES_CONFIGURACION_REQUERIDA'
    );
    const sedeService = cargarServicioConDbFalsa(createFakeDb({ sedeActiva: false }));
    await assert.rejects(
        sedeService.proponerCodigosDisponibles({ plantaKey: '98', productoInventariableId: 41, prefijo: 'CHIP', cantidad: 1, digitos: 3 }, user),
        (error) => error.message === 'PRODUCTO_NO_HABILITADO_SEDE_INGRESO'
    );
});

test('confirmación rechaza la propuesta vencida y no registra inventario', async () => {
    const fakeDb = createFakeDb();
    const service = cargarServicioConDbFalsa(fakeDb);
    const user = { username: 'test', perfil_id: 'TEST' };
    const propuesta = await service.proponerCodigosDisponibles({ plantaKey: '98', productoInventariableId: 41, prefijo: 'END', cantidad: 1, digitos: 2, minimo: 5 }, user);
    for (const reserva of fakeDb.state.reservations.values()) reserva.venceEn = Date.now() - 1000;
    await assert.rejects(
        service.ingresar({ plantaKey: '98', productoInventariableId: 41, numeros: propuesta.codigos, modoCodigo: 'GENERADOS', tokenPropuesta: propuesta.token }, user),
        (error) => error.message === 'CODIGOS_PROPUESTA_EXPIRADA'
    );
    assert.equal(fakeDb.state.chips.has('END05'), false);
});

test('sin aplicar 006 los ingresos exactos siguen disponibles y el modo automático informa el requisito', async () => {
    const fakeDb = createFakeDb({ migrationAvailable: false });
    const service = cargarServicioConDbFalsa(fakeDb);
    const user = { username: 'test', perfil_id: 'TEST' };
    const ingresados = await service.ingresar({ plantaKey: '98', productoInventariableId: 41, numeros: ['FISICO-77'] }, user);
    assert.equal(ingresados.length, 1);
    await assert.rejects(
        service.proponerCodigosDisponibles({ plantaKey: '98', productoInventariableId: 41, prefijo: 'AUTO', cantidad: 1, digitos: 2 }, user),
        (error) => error.message === 'MIGRACION_006_REQUERIDA'
    );
});

test('migración 006 y esquema maestro reservan códigos globalmente sin tocar FARENET', () => {
    const incremental = leerSeccionSql('006');
    const maestro = leerSeccionSql('000');
    assert.match(incremental, /ADD COLUMN IF NOT EXISTS codigo_autogenerable boolean NOT NULL DEFAULT FALSE/i);
    assert.match(incremental, /CREATE TABLE IF NOT EXISTS public\.fg_chip_codigo_reserva/i);
    assert.match(incremental, /UNIQUE INDEX IF NOT EXISTS uq_fg_chip_codigo_reserva_numero\s+ON public\.fg_chip_codigo_reserva \(numero_chip\)/i);
    assert.doesNotMatch(incremental, /\b(?:UPDATE|INSERT|DELETE)\s+public\.(?!fg_chip_codigo_reserva)/i);
    assert.match(maestro, /codigo_autogenerable boolean DEFAULT false NOT NULL/i);
    assert.match(maestro, /CREATE TABLE public\.fg_chip_codigo_reserva/i);
    assert.match(maestro, /UNIQUE \(numero_chip\)/i);
    assert.doesNotMatch(incremental, /\b(?:ALTER|CREATE|DROP)\s+(?:TABLE|INDEX)[^;]*\b(?:persona|usuario|vehiculo|tarjetapropiedad)\b/i);
});
