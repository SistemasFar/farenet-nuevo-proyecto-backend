const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
// Antes de tocar el pool: con NODE_ENV=test la carga automática de .env se
// salta, y sin esto el pool intenta conectarse con el usuario del sistema.
if (USA_BASE_DE_DATOS) {
    require('../../../config/env-loader').loadEnv(true);
}

const db = require('../../../config/database');
const service = require('../services/faregas-correlativos-sede.service');

const MIGRACION = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations',
    '20261002_faregas_correlativos_por_sede.sql'), 'utf8');
const SERVICIO = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-correlativos-sede.service.js'), 'utf8');
const EMISION = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-certificados.service.js'), 'utf8');

const TABLA = 'fg_correlativo_certificado_sede';
const MENSAJE_SIN_CORRELATIVOS =
    'La sede no tiene correlativos disponibles. Asigne un nuevo rango de hasta 50 números.';

// ===========================================================================
// Cliente falso: modela lo que el servicio necesita del motor.
//   - bloqueo por sede en serie (como pg_advisory_xact_lock),
//   - relectura del rango activo después del bloqueo,
//   - numero_actual y estado que se mueven juntos,
//   - rechazo de solapamiento global, como la exclusión de la base.
// ===========================================================================

function clienteFalso(inventario = []) {
    const rangos = inventario.map((r, i) => ({
        id: r.id ?? i + 1,
        planta_key: r.planta_key,
        rango_inicio: Number(r.rango_inicio),
        rango_fin: Number(r.rango_fin),
        numero_actual: Number(r.numero_actual ?? Number(r.rango_inicio) - 1),
        estado: r.estado || 'ACTIVO',
        fecha_asignacion: r.fecha_asignacion || '2026-01-01T00:00:00.000Z',
        fecha_cierre: r.fecha_cierre || null,
        observacion: r.observacion || null
    }));
    let cola = Promise.resolve();

    const cliente = {
        async query(sqlCrudo, params = []) {
            const sql = String(sqlCrudo).replace(/\s+/g, ' ').trim();
            if (/pg_advisory_xact_lock/i.test(sql)) {
                const anterior = cola;
                let liberar;
                cola = new Promise((r) => { liberar = r; });
                await anterior;
                cliente.liberar = liberar;
                return { rowCount: 1, rows: [{}] };
            }
            if (/COUNT\(\*\)::int n FROM fg_correlativo_certificado_sede/i.test(sql)) {
                return { rowCount: 1, rows: [{ n: rangos.filter((r) => r.planta_key === params[0]).length }] };
            }
            if (/FROM fg_planta WHERE key = \$1/i.test(sql)) {
                const existe = params[0] === '201' || params[0] === '98' || params[0] === '13';
                return { rowCount: existe ? 1 : 0, rows: existe ? [{ key: params[0], nombre: params[0] }] : [] };
            }
            if (/rango_inicio <= \$3::bigint AND \$2::bigint <= rango_fin/i.test(sql)) {
                const [ignorar, inicio, fin] = params;
                const choque = rangos.filter((r) => (
                    (ignorar === null || Number(r.id) !== Number(ignorar))
                    && r.rango_inicio <= Number(fin) && Number(inicio) <= r.rango_fin
                ));
                return { rowCount: choque.length, rows: choque.map((r) => ({ ...r })) };
            }
            if (/FROM fg_certificado/i.test(sql) && /numero_certificado ~/i.test(sql)) {
                return { rowCount: 0, rows: [] };
            }
            // El bloqueo del rango activo va ANTES de la comprobacion de "ya
            // tiene activo": ambas consultas filtran por estado = 'ACTIVO' y por
            // planta_key, y el orden decide cual responde.
            if (/FROM fg_correlativo_certificado_sede/i.test(sql) && /FOR UPDATE/i.test(sql)) {
                const candidatos = rangos.filter((r) => (
                    r.planta_key === params[0]
                    && r.estado === 'ACTIVO'
                    && new Date(r.fecha_asignacion).getTime() <= Date.now()
                    && r.numero_actual < r.rango_fin
                ));
                candidatos.sort((a, b) => (
                    new Date(a.fecha_asignacion) - new Date(b.fecha_asignacion)
                    || a.rango_inicio - b.rango_inicio
                ));
                return { rowCount: candidatos.length ? 1 : 0, rows: candidatos.length ? [candidatos[0]] : [] };
            }
            if (/estado = 'ACTIVO'/i.test(sql) && /planta_key = \$1/i.test(sql)) {
                const activos = rangos.filter((r) => (
                    r.planta_key === params[0] && r.estado === 'ACTIVO'
                    && (params[1] === null || Number(r.id) !== Number(params[1]))
                ));
                return { rowCount: activos.length, rows: activos.map((r) => ({ ...r })) };
            }
            if (/UPDATE fg_correlativo_certificado_sede/i.test(sql)) {
                const rango = rangos.find((r) => r.id === Number(params[0]));
                if (!rango) return { rowCount: 0, rows: [] };
                rango.numero_actual = Number(params[1]);
                rango.estado = params[2];
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Consulta no simulada: ${sql}`);
        },
        liberar: null
    };
    return { cliente, rangos };
}

/**
 * Consume un número y suelta el bloqueo de sede, como si la transacción que
 * emite terminara. Es el equivalente en el cliente falso del COMMIT que en el
 * sistema real devuelve el advisory lock.
 */
const consumido = async (cliente, plantaKey) => {
    try {
        return await service.consumirNumero(cliente, plantaKey);
    } finally {
        if (cliente.liberar) { cliente.liberar(); cliente.liberar = null; }
    }
};

const rango = (id, inicio, fin, extra = {}) => ({
    id, planta_key: '201', rango_inicio: inicio, rango_fin: fin, ...extra
});

test('la sugerencia nunca repite un rango usado por otra sede', () => {
    const libre = service.encontrarPrimerBloqueLibre([
        { planta_key: '291', rango_inicio: 1, rango_fin: 50 }
    ]);
    assert.deepEqual(libre, { rango_inicio: 51, rango_fin: 100, cantidad: 50 });
});

test('la sugerencia aprovecha el primer hueco global completo', () => {
    const libre = service.encontrarPrimerBloqueLibre([
        { planta_key: '291', rango_inicio: 1, rango_fin: 50 },
        { planta_key: '201', rango_inicio: 101, rango_fin: 150 }
    ]);
    assert.deepEqual(libre, { rango_inicio: 51, rango_fin: 100, cantidad: 50 });
});

test('la sugerencia avanza después de rangos contiguos aunque lleguen desordenados', () => {
    const libre = service.encontrarPrimerBloqueLibre([
        { planta_key: '201', rango_inicio: 51, rango_fin: 100 },
        { planta_key: '291', rango_inicio: 1, rango_fin: 50 }
    ]);
    assert.deepEqual(libre, { rango_inicio: 101, rango_fin: 150, cantidad: 50 });
});

// ===========================================================================
// 1. Esquema: las columnas y las reglas que pidió el inventario
// ===========================================================================

test('1. la tabla tiene exactamente las columnas acordadas', () => {
    const cuerpo = MIGRACION.slice(MIGRACION.indexOf('CREATE TABLE'), MIGRACION.indexOf(');', MIGRACION.indexOf('CREATE TABLE')));
    for (const columna of ['planta_key', 'rango_inicio', 'rango_fin', 'numero_actual',
        'cantidad', 'disponibles', 'estado', 'fecha_asignacion', 'observacion']) {
        assert.match(cuerpo, new RegExp(`\\b${columna}\\b`), `falta ${columna}`);
    }
    // cantidad y disponibles se calculan en la base: no se escriben a mano.
    assert.match(cuerpo, /cantidad\s+bigint GENERATED ALWAYS AS \(rango_fin - rango_inicio \+ 1\) STORED/);
    assert.match(cuerpo, /disponibles\s+bigint GENERATED ALWAYS AS \(rango_fin - numero_actual\) STORED/);
});

test('2. la clave no lleva producto, tipo, servicio ni modalidad', () => {
    const cuerpo = MIGRACION.slice(MIGRACION.indexOf('CREATE TABLE'), MIGRACION.indexOf(');', MIGRACION.indexOf('CREATE TABLE')));
    for (const prohibido of ['tipo_certificado_clave', 'modalidad', 'producto_facturacion_id',
        'servicio_id', 'operacion_id']) {
        assert.doesNotMatch(cuerpo, new RegExp(prohibido), `${prohibido} no puede estar en la tabla`);
    }
    // Y el código del servicio tampoco los consulta. Se mira el código sin
    // comentarios: el archivo explica por qué el modelo anterior sí los tenía.
    const codigo = SERVICIO
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((linea) => !linea.trim().startsWith('*') && !linea.trim().startsWith('//'))
        .join('\n');
    for (const prohibido of ['tipo_certificado_clave', 'modalidad', 'producto_facturacion_id', 'servicio_id']) {
        assert.doesNotMatch(codigo, new RegExp(prohibido), `${prohibido} no puede aparecer en el código`);
    }
});

test('3. un rango va de 1 a 50 números', () => {
    assert.match(MIGRACION, /chk_corr_sede_cantidad\s*\n\s*CHECK \(rango_fin - rango_inicio \+ 1 BETWEEN 1 AND 50\)/);
    assert.equal(service.CANTIDAD_MAXIMA, 50);
    assert.match(SERVICIO, /if \(cantidad < 1 \|\| cantidad > CANTIDAD_MAXIMA\)/);
    assert.match(SERVICIO, /mensaje: MENSAJES\.CANTIDAD_FUERA_DE_RANGO/);
});

test('4. la exclusión de solapamiento es global, sin columna de familia', () => {
    assert.match(MIGRACION, /excl_fg_corr_sede_rango[\s\S]*?EXCLUDE USING gist \(int8range\(rango_inicio, rango_fin, '\[\]'\) WITH &&\)/);
    assert.doesNotMatch(MIGRACION, /WITH =,/);
});

test('5. una sede tiene un solo rango ACTIVO, y el índice lo impone', () => {
    assert.match(MIGRACION, /CREATE UNIQUE INDEX uk_fg_corr_sede_activo\s*\n\s*ON fg_correlativo_certificado_sede \(planta_key\)\s*\n\s*WHERE estado = 'ACTIVO'/);
    assert.match(SERVICIO, /SEDE_YA_TIENE_RANGO_ACTIVO/);
    assert.match(SERVICIO, /error\.constraint === 'uk_fg_corr_sede_activo'/);
});

test('6. el consumo no retrocede y AGOTADO sólo si no queda nada', () => {
    assert.match(MIGRACION, /chk_corr_sede_actual\s*\n\s*CHECK \(numero_actual >= rango_inicio - 1 AND numero_actual <= rango_fin\)/);
    assert.match(MIGRACION, /chk_corr_sede_agotado_coherente[\s\S]*?estado <> 'AGOTADO' OR numero_actual >= rango_fin/);
});

test('7. la edición nunca escribe numero_actual', () => {
    const editar = SERVICIO.slice(SERVICIO.indexOf('exports.editarRango'), SERVICIO.indexOf('exports.cerrarRango'));
    const bloque = /UPDATE fg_correlativo_certificado_sede\s+SET([\s\S]*?)WHERE id = \$1/.exec(editar);
    assert.ok(bloque, 'debe haber un UPDATE en editarRango');
    assert.doesNotMatch(bloque[1], /numero_actual\s*=/,
        'numero_actual es consumo real: la edición no lo escribe');
});

// ===========================================================================
// 2. Consumo: la sede es la unidad
// ===========================================================================

test('8. una sede con un solo rango entrega su secuencia y avanza un número', async () => {
    const { cliente, rangos } = clienteFalso([rango(1, 11091, 11140)]);
    const resultado = await consumido(cliente, '201');
    assert.equal(resultado.migrada, true);
    assert.equal(resultado.nro, 11091);
    assert.equal(rangos[0].numero_actual, 11091, 'consume exactamente un número');
    assert.equal(rangos[0].estado, 'ACTIVO');
});

test('9. el último número agota el rango y lo marca AGOTADO', async () => {
    const { cliente, rangos } = clienteFalso([rango(1, 11091, 11100, { numero_actual: 11099 })]);
    const resultado = await consumido(cliente, '201');
    assert.equal(resultado.nro, 11100);
    assert.equal(resultado.rangoAgotado, true);
    assert.equal(rangos[0].estado, 'AGOTADO');
});

test('10. agotado el rango, la emisión se bloquea con el mensaje acordado', async () => {
    const { cliente, rangos } = clienteFalso([rango(1, 11091, 11100, { numero_actual: 11100, estado: 'AGOTADO' })]);
    await assert.rejects(consumido(cliente, '201'), (error) => {
        assert.equal(error.code, 'SEDE_SIN_CORRELATIVOS');
        assert.equal(error.statusCode, 409);
        assert.equal(error.detalles.mensaje, MENSAJE_SIN_CORRELATIVOS);
        return true;
    });
    assert.equal(rangos[0].numero_actual, 11100, 'no se consumió nada');
});

test('11. con un rango nuevo, la sede sigue por el mismo bloque asignado', async () => {
    // El agotado queda como historial y el nuevo es el único ACTIVO.
    const { cliente } = clienteFalso([
        rango(1, 11091, 11100, { numero_actual: 11100, estado: 'AGOTADO' }),
        rango(2, 12001, 12040)
    ]);
    const siguiente = await consumido(cliente, '201');
    assert.equal(siguiente.nro, 12001, 'consume del rango nuevo de la misma sede');
});

test('12. un rango cerrado no entrega números', async () => {
    const { cliente } = clienteFalso([
        rango(1, 11091, 11100, { numero_actual: 11095, estado: 'CERRADO', fecha_cierre: '2026-03-01T00:00:00Z' }),
        rango(2, 12001, 12040)
    ]);
    const r = await consumido(cliente, '201');
    assert.equal(r.nro, 12001, 'los cerrados quedan como historial');
});

test('13. un rango con fecha futura todavía no se consume', async () => {
    const { cliente } = clienteFalso([rango(1, 11091, 11100, { fecha_asignacion: '2099-01-01T00:00:00Z' })]);
    await assert.rejects(consumido(cliente, '201'), /SEDE_SIN_CORRELATIVOS/);
});

test('14. el consumo serializa: dos llamadas simultáneas no repiten número', async () => {
    const { cliente, rangos } = clienteFalso([rango(1, 11091, 11140)]);
    const [a, b] = await Promise.all([consumido(cliente, '201'), consumido(cliente, '201')]);
    assert.deepEqual([a.nro, b.nro].sort((x, y) => x - y), [11091, 11092]);
    assert.equal(rangos[0].numero_actual, 11092);
});

test('15. dos llamadas simultáneas sobre el último número: uno lo toma, el otro se bloquea', async () => {
    const { cliente, rangos } = clienteFalso([rango(1, 11091, 11100, { numero_actual: 11099 })]);
    const resultados = await Promise.allSettled([
        consumido(cliente, '201'),
        consumido(cliente, '201')
    ]);
    const exitos = resultados.filter((r) => r.status === 'fulfilled');
    const fallos = resultados.filter((r) => r.status === 'rejected');
    assert.equal(exitos.length, 1, 'sólo una emisión puede quedarse con el número');
    assert.equal(exitos[0].value.nro, 11100, 'y es el último del rango');
    assert.equal(fallos[0].reason.code, 'SEDE_SIN_CORRELATIVOS',
        'la otra se bloquea en vez de repetir el número');
    assert.equal(rangos[0].numero_actual, 11100);
    assert.equal(rangos[0].estado, 'AGOTADO');
});

test('16. una sede sin inventario avisa que no está configurada', async () => {
    const { cliente, rangos } = clienteFalso([]);
    assert.deepEqual(await consumido(cliente, '201'), { migrada: false });
    assert.equal(rangos.length, 0);
});

// ===========================================================================
// 3. Validaciones del alta
// ===========================================================================

test('17. rechaza solapamiento dentro de la misma sede', async () => {
    const { cliente } = clienteFalso([rango(1, 11041, 11065)]);
    await assert.rejects(
        () => service.validarRango(cliente, { plantaKey: '201', rango_inicio: 11050, rango_fin: 11099 }),
        (error) => {
            assert.equal(error.code, 'RANGO_SOLAPA_DENTRO_DE_SEDE');
            assert.equal(error.detalles.mensaje,
                'El rango indicado se superpone con otro rango de la misma sede.');
            return true;
        }
    );
});

test('18. rechaza solapamiento entre sedes distintas', async () => {
    // Caso del enunciado: SURCO 11041-11065 y COLINA 11050-11100.
    const { cliente } = clienteFalso([{ ...rango(1, 11041, 11065), planta_key: '98' }]);
    await assert.rejects(
        () => service.validarRango(cliente, { plantaKey: '13', rango_inicio: 11050, rango_fin: 11099 }),
        (error) => {
            assert.equal(error.code, 'RANGO_SE_SOLAPA');
            assert.equal(error.detalles.mensaje,
                'El rango indicado se superpone con números ya asignados a otra sede.');
            assert.equal(error.detalles.conflicto.planta_key, '98');
            return true;
        }
    );
});

test('19. un rango contiguo NO es solapamiento', async () => {
    const { cliente } = clienteFalso([rango(1, 11091, 11140)]);
    // exigirActivo: false porque lo que se prueba aquí es el solapamiento, no
    // el cupo de un rango activo por sede (que tiene su propio caso).
    const ok = await service.validarRango(cliente, {
        plantaKey: '201', rango_inicio: 11141, rango_fin: 11190, exigirActivo: false
    });
    assert.equal(ok.rango_inicio, 11141);
    assert.equal(ok.cantidad, 50);
});

test('20. rechaza más de 50 números y acepta hasta 50', async () => {
    const { cliente } = clienteFalso([]);
    await assert.rejects(
        () => service.validarRango(cliente, { plantaKey: '201', rango_inicio: 100, rango_fin: 150 }),
        (error) => {
            assert.equal(error.code, 'CANTIDAD_FUERA_DE_RANGO');
            assert.equal(error.detalles.cantidad, 51);
            assert.equal(error.detalles.mensaje,
                'El rango debe tener entre 1 y 50 números (hasta - desde + 1).');
            return true;
        }
    );
    const ok = await service.validarRango(cliente, { plantaKey: '201', rango_inicio: 100, rango_fin: 150 - 1 });
    assert.equal(ok.cantidad, 50);
});

test('21. rechaza una sede que ya tiene rango activo', async () => {
    const { cliente } = clienteFalso([rango(1, 11091, 11140)]);
    await assert.rejects(
        () => service.validarRango(cliente, { plantaKey: '201', rango_inicio: 12001, rango_fin: 12050 }),
        (error) => {
            assert.equal(error.code, 'SEDE_YA_TIENE_RANGO_ACTIVO');
            assert.equal(error.detalles.mensaje,
                'La sede ya tiene un rango activo. Agote o cierre ese rango antes de asignar otro.');
            return true;
        }
    );
});

test('22. no se puede ofrecer un rango con números ya emitidos en la sede', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip('requiere FAREGAS_TEST_DB=1');
    const emitidos = await db.query(`
      SELECT DISTINCT split_part(numero_certificado, '-', 3) AS numero
      FROM fg_certificado
      WHERE planta_key = '13' AND numero_certificado ~ '^[A-Z]+-[0-9]+-[0-9]+$'
      ORDER BY 1 LIMIT 1`);
    assert.ok(emitidos.rows.length > 0, 'COLINA debe tener certificados emitidos');
    const numero = Number(emitidos.rows[0].numero);
    await assert.rejects(
        () => service.validarRango(db, {
            plantaKey: '13', rango_inicio: numero, rango_fin: numero + 49
        }),
        (error) => {
            assert.equal(error.code, 'RANGO_REUTILIZA_NUMEROS_USADOS');
            assert.ok(error.detalles.numeros.includes(numero));
            return true;
        }
    );
});

// ===========================================================================
// 4. Reglas de edición (requieren base)
// ===========================================================================

test('23. un rango con consumo no deja cambiar el inicio', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip('requiere FAREGAS_TEST_DB=1');
    const id = await crearRangoDePrueba('190', 500000, 500049, 500005);
    try {
        await assert.rejects(
            () => service.editarRango(id, { rango_inicio: 499990 }),
            (error) => {
                assert.equal(error.code, 'RANGO_INICIO_BLOQUEADO');
                assert.equal(error.detalles.mensaje,
                    'El inicio del rango no puede cambiar porque ya existen certificados emitidos.');
                return true;
            }
        );
    } finally { await borrar(id); }
});

test('24. un rango con consumo no deja bajar el final por debajo de lo entregado', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip('requiere FAREGAS_TEST_DB=1');
    const id = await crearRangoDePrueba('190', 500200, 500249, 500210);
    try {
        await assert.rejects(
            () => service.editarRango(id, { rango_fin: 500205 }),
            (error) => {
                assert.equal(error.code, 'RANGO_MAXIMO_BLOQUEADO');
                assert.equal(error.detalles.mensaje,
                    'El final del rango no puede quedar por debajo de los certificados ya emitidos.');
                return true;
            }
        );
        // Y ampliar el final sí se permite, hasta el tope de 50.
        await assert.rejects(() => service.editarRango(id, { rango_fin: 500400 }), /CANTIDAD_FUERA_DE_RANGO/);
    } finally { await borrar(id); }
});

test('25. un rango sin consumo admite corregir desde y hasta', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip('requiere FAREGAS_TEST_DB=1');
    const id = await crearRangoDePrueba('190', 500400, 500419);
    try {
        const fila = (await db.query(
            'SELECT numero_actual, cantidad FROM fg_correlativo_certificado_sede WHERE id=$1', [id])).rows[0];
        assert.equal(Number(fila.numero_actual), 500399, 'arranca en rango_inicio - 1');
        assert.equal(Number(fila.cantidad), 20);
        const movido = await service.editarRango(id, { rango_inicio: 500400, rango_fin: 500449 });
        assert.equal(Number(movido.rango_fin), 500449);
        assert.equal(Number(movido.cantidad), 50);
        assert.equal(Number(movido.numero_actual), 500399, 'el consumo no se mueve');
    } finally { await borrar(id); }
});

test('26. cerrar un rango no toca el consumo y libera a la sede', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip('requiere FAREGAS_TEST_DB=1');
    const id = await crearRangoDePrueba('190', 500600, 500649);
    try {
        await service.cerrarRango(id);
        await assert.rejects(() => service.editarRango(id, { rango_fin: 500649 }), (e) => e.code === 'RANGO_CERRADO_NO_EDITABLE');
        const cerrado = (await db.query(
            'SELECT numero_actual, estado FROM fg_correlativo_certificado_sede WHERE id=$1', [id])).rows[0];
        assert.equal(Number(cerrado.numero_actual), 500599, 'cerrar no toca el consumo real');
        assert.equal(cerrado.estado, 'CERRADO');
        // Al estar cerrado, ya se puede asignar otro rango a la misma sede.
        const nuevo = await service.agregarRango({ plantaKey: '190', rango_inicio: 500700, rango_fin: 500749 });
        assert.equal(nuevo.estado, 'ACTIVO');
        await borrar(nuevo.id);
    } finally { await borrar(id); }
});

test('27. la base rechaza el segundo rango activo de una misma sede', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip('requiere FAREGAS_TEST_DB=1');
    const primero = await crearRangoDePrueba('190', 500800, 500849);
    try {
        // Se intenta saltarse el servicio para comprobar que la base lo impide.
        await assert.rejects(
            () => db.query(`
                INSERT INTO fg_correlativo_certificado_sede
                    (planta_key, rango_inicio, rango_fin, numero_actual, estado)
                VALUES ('190', 500900, 500949, 500899, 'ACTIVO')`),
            (error) => error.code === '23505' && error.constraint === 'uk_fg_corr_sede_activo'
        );
    } finally { await borrar(primero); }
});

test('28. la base rechaza rangos de más de 50 números', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip('requiere FAREGAS_TEST_DB=1');
    await assert.rejects(
        () => db.query(`
            INSERT INTO fg_correlativo_certificado_sede
                (planta_key, rango_inicio, rango_fin, numero_actual, estado)
            VALUES ('190', 501000, 501100, 501000, 'CERRADO')`),
        (error) => error.code === '23514' && error.constraint === 'chk_corr_sede_cantidad'
    );
});

// ===========================================================================
// 5. Previsualización y alcance
// ===========================================================================

test('29. la previsualización no reserva ni avanza nada', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip('requiere FAREGAS_TEST_DB=1');
    const id = await crearRangoDePrueba('190', 502000, 502049);
    try {
        const antes = (await db.query(
            'SELECT numero_actual FROM fg_correlativo_certificado_sede WHERE id=$1', [id])).rows[0];
        const siguiente = await service.previsualizarProximo(db, '190');
        assert.equal(siguiente.disponible, true);
        assert.equal(siguiente.nro, 502000);
        for (let i = 0; i < 5; i += 1) await service.previsualizarProximo(db, '190');
        const despues = (await db.query(
            'SELECT numero_actual FROM fg_correlativo_certificado_sede WHERE id=$1', [id])).rows[0];
        assert.equal(Number(despues.numero_actual), Number(antes.numero_actual), 'no consume');
    } finally { await borrar(id); }
});

test('30. la emisión busca sólo el rango activo de la sede', () => {
    const inicio = EMISION.indexOf('exports.emitirCertificado = async');
    const bloque = EMISION.slice(inicio, EMISION.indexOf('const generateGnvAnualHtml', inicio));
    assert.match(bloque, /await sedeRangos\.consumirNumero\(client, cert\.planta_key\)/);
    assert.match(bloque, /if \(consumo\.migrada\)/);
    // El puente entrega el número pero lo declara: es corte técnico, no la
    // solución final, y hay que poder verlo.
    assert.match(bloque, /origenCorrelativo = 'LEGACY'/);
    assert.match(bloque, /origen_correlativo: origenCorrelativo/);
    // Y la rama del modelo nuevo no pregunta por tipo ni modalidad.
    const ramaSede = bloque.slice(
        bloque.indexOf('if (consumo.migrada)'),
        bloque.indexOf("origenCorrelativo = 'LEGACY'")
    );
    assert.doesNotMatch(ramaSede, /tipo_clave|modalidad_correlativo/);
});

test('31. el inventario y el modelo viejo siguen siendo tablas distintas', () => {
    const migracion = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', 'scripts', '_corregir-inventario-sede.cjs'), 'utf8');
    // La corrección anterior vació el inventario; no volvió a migrar rangos
    // viejos ni a tocar certificados.
    assert.match(migracion, /NO se toca fg_certificado/);
    assert.doesNotMatch(migracion, /UPDATE fg_certificado/i);
    assert.match(migracion, /if \(fallos|ABORTO/);
    assert.match(SERVICIO, /_db = db/);
});

test('32. el módulo no toca series, Nubefact ni correlativos tributarios', () => {
    for (const archivo of [SERVICIO, MIGRACION]) {
        assert.doesNotMatch(archivo, /fg_serie_comprobante|nubefact|NUBEFACT|fg_facturacion\b/);
    }
});

async function crearRangoDePrueba(plantaKey, inicio, fin, actual = null) {
    const res = await db.query(`
        INSERT INTO fg_correlativo_certificado_sede
            (planta_key, rango_inicio, rango_fin, numero_actual, estado, observacion)
        VALUES ($1, $2, $3, $4, 'ACTIVO', 'prueba')
        RETURNING id`, [plantaKey, inicio, fin, actual ?? inicio - 1]);
    return res.rows[0].id;
}

async function borrar(id) {
    if (id) await db.query('DELETE FROM fg_correlativo_certificado_sede WHERE id = $1', [id]);
}

test.after(() => db.end());
