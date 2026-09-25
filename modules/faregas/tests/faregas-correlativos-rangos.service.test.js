const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const rangos = require('../services/faregas-correlativos-rangos.service');

const TAMANO = 100;
const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

/**
 * Store en memoria con el grafo real de fg_correlativo_certificado:
 * - EXCLUDE por (tipo_certificado_clave, int8range(nro_inicio, nro_maximo))
 * - UNIQUE (planta, tipo, modalidad, nro_inicio, nro_maximo)
 * - UNIQUE parcial (planta, tipo, modalidad) WHERE activo
 * - CHECK nro_actual entre nro_inicio-1 y nro_maximo
 */
class FakeRangos {
    constructor({ rangos = [], usados = [], combinaciones = [] } = {}) {
        this.estado = {
            rangos: rangos.map((r) => ({ ...r })),
            usados,
            combinaciones
        };
        this.log = [];
        this.snapshot = null;
        this.advisories = [];
    }

    async query(sqlCrudo, params = []) {
        const sql = norm(sqlCrudo);
        this.log.push({ sql, params: [...params] });
        if (sql === 'BEGIN') { this.snapshot = JSON.parse(JSON.stringify(this.estado)); return { rowCount: 0, rows: [] }; }
        if (sql === 'COMMIT') { this.snapshot = null; return { rowCount: 0, rows: [] }; }
        if (sql === 'ROLLBACK') {
            if (this.snapshot) this.estado = this.snapshot;
            this.snapshot = null;
            return { rowCount: 0, rows: [] };
        }
        const e = this.estado;
        const lista = (items) => ({ rowCount: items.length, rows: items.map((i) => ({ ...i })) });
        const int = (v) => Number(v);

        if (/pg_advisory_xact_lock/.test(sql)) { this.advisories.push(params[0]); return { rowCount: 1, rows: [] }; }

        if (/FROM fg_correlativo_certificado\s+ORDER BY tipo_certificado_clave/.test(sql)) {
            return lista([...e.rangos].sort((a, b) => (
                String(a.tipo).localeCompare(String(b.tipo))
                || String(a.planta_key).localeCompare(String(b.planta_key))
                || String(a.modalidad).localeCompare(String(b.modalidad))
                || int(a.nro_inicio) - int(b.nro_inicio)
            )));
        }
        if (/FROM fg_certificado\s+WHERE numero_certificado/.test(sql)) {
            return lista(e.usados.map((u) => ({ tipo: u.tipo, numero: String(u.numero), numero_certificado: u.codigo })));
        }
        if (/SELECT DISTINCT t\.planta_key/.test(sql)) {
            return lista(e.combinaciones);
        }
        if (/UPDATE fg_correlativo_certificado\s+SET activo = FALSE/.test(sql)) {
            const fila = e.rangos.find((r) => int(r.id) === int(params[0]));
            if (!fila) return { rowCount: 0, rows: [] };
            fila.activo = false;
            fila.fecha_cierre = '2026-09-25';
            return { rowCount: 1, rows: [{ ...fila }] };
        }
        if (/INSERT INTO fg_correlativo_certificado/.test(sql)) {
            const [planta_key, tipo, modalidad, nro_inicio, nro_maximo, nro_actual] = params;
            // EXCLUDE: solapamiento por tipo
            const solapa = e.rangos.find((r) => r.tipo === tipo
                && int(r.nro_inicio) <= int(nro_maximo) && int(nro_inicio) <= int(r.nro_maximo));
            if (solapa) { const e2 = new Error('rango_ui'); e2.code = '23P01'; throw e2; }
            // UNIQUE parcial: un solo activo por combinación
            if (e.rangos.some((r) => r.planta_key === planta_key && r.tipo === tipo
                && r.modalidad === modalidad && r.activo)) {
                const e2 = new Error('dup'); e2.code = '23505'; throw e2;
            }
            const nuevo = {
                id: Math.max(0, ...e.rangos.map((r) => int(r.id))) + 1,
                planta_key, tipo, modalidad,
                nro_inicio: int(nro_inicio), nro_maximo: int(nro_maximo), nro_actual: int(nro_actual),
                activo: true
            };
            e.rangos.push(nuevo);
            return { rowCount: 1, rows: [{ ...nuevo }] };
        }
        throw new Error(`Consulta no simulada: ${sql}`);
    }

    release() {}
}

const rango = (over = {}) => ({
    id: 1, planta_key: '201', tipo: 'GLP_ANUAL', modalidad: 'ANUAL',
    nro_inicio: 1, nro_actual: 0, nro_maximo: 100, activo: true, ...over
});

// ===========================================================================
// 1 y 2. Tamaño y secuencia contigua
// ===========================================================================

test('1. el rango 1-100 tiene exactamente 100 números', () => {
    const bloque = rangos.siguienteBloqueLibre([], 0);
    assert.equal(bloque.nro_inicio, 1);
    assert.equal(bloque.nro_maximo, 100);
    assert.equal(bloque.nro_maximo - bloque.nro_inicio + 1, 100);
    assert.equal(bloque.tamano, 100);
});

test('2. después de 1-100 el siguiente rango es 101-200', () => {
    const bloque = rangos.siguienteBloqueLibre([{ ini: 1, fin: 100 }], 100);
    assert.equal(bloque.nro_inicio, 101);
    assert.equal(bloque.nro_maximo, 200);
    assert.equal(bloque.nro_maximo - bloque.nro_inicio + 1, 100);
});

test('2b. la secuencia continúa 201-300 y 301-400', () => {
    const ocupados = [{ ini: 1, fin: 100 }, { ini: 101, fin: 200 }];
    const b1 = rangos.siguienteBloqueLibre(ocupados, 200);
    assert.deepEqual([b1.nro_inicio, b1.nro_maximo], [201, 300]);
    ocupados.push({ ini: b1.nro_inicio, fin: b1.nro_maximo });
    const b2 = rangos.siguienteBloqueLibre(ocupados, b1.nro_maximo);
    assert.deepEqual([b2.nro_inicio, b2.nro_maximo], [301, 400]);
});

// ===========================================================================
// 3 y 4. Solapamiento y familias independientes
// ===========================================================================

test('3. no permite 50-149 si ya existe 1-100', async () => {
    const store = new FakeRangos({ rangos: [rango({ nro_inicio: 1, nro_actual: 0, nro_maximo: 100 })] });
    await assert.rejects(
        () => rangos.validarRango(store, {
            tipo: 'GLP_ANUAL', planta_key: '201', modalidad: 'ANUAL', nro_inicio: 50, nro_maximo: 149
        }),
        (error) => error.message === 'RANGO_SE_SOLAPA' && error.statusCode === 409
    );
});

test('4. familias distintas manejan secuencias independientes', () => {
    const b = rangos.siguienteBloqueLibre([{ ini: 1, fin: 100 }], 100);
    assert.equal(b.nro_inicio, 101);
    // La familia GNV no hereda la ocupación de GLP: se evalúa por separado.
    const gnv = rangos.siguienteBloqueLibre([{ ini: 500, fin: 599 }], 599);
    assert.deepEqual([gnv.nro_inicio, gnv.nro_maximo], [600, 699]);
});

// ===========================================================================
// 5. No reutiliza números ya emitidos
// ===========================================================================

test('5. no reutiliza un número histórico ya emitido', async () => {
    const store = new FakeRangos({
        rangos: [rango({ id: 9, nro_inicio: 1, nro_actual: 0, nro_maximo: 100, activo: false })],
        usados: [{ tipo: 'GLP_ANUAL', numero: 250, codigo: 'DG-41-250' }]
    });
    await assert.rejects(
        () => rangos.validarRango(store, {
            tipo: 'GLP_ANUAL', planta_key: '201', modalidad: 'ANUAL', nro_inicio: 200, nro_maximo: 299
        }),
        (error) => error.message === 'RANGO_REUTILIZA_NUMEROS_USADOS' && error.detalles.numeros.includes(250)
    );
});

test('5b. el plan evita números históricos', async () => {
    const store = new FakeRangos({
        // Rango activo inválido (10 números) que además ya emitió el 150.
        rangos: [rango({ id: 9, nro_inicio: 145, nro_actual: 150, nro_maximo: 154, activo: true })],
        usados: [{ tipo: 'GLP_ANUAL', numero: 150, codigo: 'DG-41-150' }],
        combinaciones: [{ planta_key: '201', tipo: 'GLP_ANUAL', modalidad: 'ANUAL' }]
    });
    const plan = await rangos.calcularPlan(store);
    assert.equal(plan.aplicable, true);
    const paso = plan.pasos.find((p) => p.combinacion.tipo === 'GLP_ANUAL');
    assert.ok(paso, 'el plan detecta la combinación con rango inválido');
    assert.ok(paso.nuevoRango.nro_inicio > 154, 'el bloque nuevo no pisa el rango histórico');
    assert.ok(!(paso.nuevoRango.nro_inicio <= 150 && 150 <= paso.nuevoRango.nro_maximo),
        'no reutiliza el número histórico 150');
    assert.equal(paso.nuevoRango.nro_maximo - paso.nuevoRango.nro_inicio + 1, 100);
});

// ===========================================================================
// 6 y 7. nro_actual se conserva y rangos agotados
// ===========================================================================

test('6. un rango usado conserva su nro_actual (nunca se resetea)', async () => {
    const store = new FakeRangos({
        rangos: [rango({ id: 5, nro_inicio: 101, nro_actual: 135, nro_maximo: 200, activo: true })]
    });
    await assert.rejects(
        () => rangos.editarRango(store, { id: 5, nro_inicio: 1, nro_maximo: 100 }),
        (error) => error.message === 'RANGO_YA_USADO_NO_EDITABLE' && error.detalles.nro_actual === 135
    );
    assert.equal(store.estado.rangos[0].nro_actual, 135, 'no se modifica nro_actual');
    assert.equal(store.log.some(({ sql }) => /UPDATE fg_correlativo_certificado/i.test(sql)), false,
        'no se escribe nada en un rango ya usado');
});

test('7. un rango agotado queda histórico y se crea el siguiente bloque', async () => {
    const store = new FakeRangos({
        rangos: [rango({ id: 7, nro_inicio: 1, nro_actual: 100, nro_maximo: 100, activo: true })],
        combinaciones: [{ planta_key: '201', tipo: 'GLP_ANUAL', modalidad: 'ANUAL' }]
    });
    const plan = await rangos.calcularPlan(store);
    assert.equal(plan.aplicable, true);
    const paso = plan.pasos.find((p) => p.combinacion.planta_key === '201');
    assert.deepEqual([paso.nuevoRango.nro_inicio, paso.nuevoRango.nro_maximo], [101, 200]);

    const resultado = await rangos.aplicarPlan(store, plan);
    const cerrado = resultado.aplicados[0].cerrados[0];
    assert.equal(cerrado.activo, false);
    assert.equal(cerrado.nro_actual, 100, 'el agotado conserva su nro_actual');
    assert.equal(resultado.aplicados[0].creado.nro_actual, 100, 'el nuevo arranca en inicio-1');
    assert.equal(store.estado.rangos.find((r) => r.id === 7).activo, false);
});

// ===========================================================================
// 8. Un solo activo por combinación
// ===========================================================================

test('8. no permite un segundo rango activo para la misma planta+tipo+modalidad', async () => {
    const store = new FakeRangos({
        rangos: [rango({ id: 3, nro_inicio: 1, nro_actual: 0, nro_maximo: 100, activo: true })]
    });
    await assert.rejects(
        () => rangos.validarRango(store, {
            tipo: 'GLP_ANUAL', planta_key: '201', modalidad: 'ANUAL', nro_inicio: 201, nro_maximo: 300
        }),
        (error) => error.message === 'YA_EXISTE_RANGO_ACTIVO' && error.statusCode === 409
    );
});

test('8b. la misma modalidad en otra sede sí puede tener su rango', async () => {
    const store = new FakeRangos({
        rangos: [rango({ id: 3, planta_key: '201', nro_inicio: 1, nro_actual: 0, nro_maximo: 100, activo: true })]
    });
    const ok = await rangos.validarRango(store, {
        tipo: 'GLP_ANUAL', planta_key: '190', modalidad: 'ANUAL', nro_inicio: 201, nro_maximo: 300
    });
    assert.equal(ok.nro_inicio, 201);
    assert.equal(ok.nro_maximo - ok.nro_inicio + 1, 100);
});

// ===========================================================================
// 9. Dos sedes no se cruzan dentro de la misma familia
// ===========================================================================

test('9. dos sedes de la misma familia no pueden cruzarse', async () => {
    const store = new FakeRangos({
        rangos: [rango({ id: 3, planta_key: '201', nro_inicio: 1, nro_actual: 0, nro_maximo: 100, activo: true })]
    });
    await assert.rejects(
        () => rangos.validarRango(store, {
            tipo: 'GLP_ANUAL', planta_key: '190', modalidad: 'ANUAL', nro_inicio: 50, nro_maximo: 149
        }),
        (error) => error.message === 'RANGO_SE_SOLAPA' && error.detalles.conflicto.planta_key === '201'
    );
    const siguiente = rangos.siguienteBloqueLibre([{ ini: 1, fin: 100 }], 100);
    assert.deepEqual([siguiente.nro_inicio, siguiente.nro_maximo], [101, 200]);
});

// ===========================================================================
// 10 y 11. Edición de rangos
// ===========================================================================

test('10. editar un rango SIN uso devuelve inicio/final correctos', async () => {
    const store = new FakeRangos({
        rangos: [rango({ id: 2, nro_inicio: 5001, nro_actual: 5000, nro_maximo: 5100, activo: true })]
    });
    const decision = await rangos.editarRango(store, { id: 2, nro_inicio: 6001, nro_maximo: 6100 });
    assert.equal(decision.accion, 'EDITAR');
    assert.equal(decision.usado, false);
    assert.equal(decision.rango.nro_inicio, 5001);
    assert.equal(decision.rango.nro_maximo, 5100);
    assert.equal(decision.nro_inicio, 6001);
    assert.equal(decision.nro_maximo, 6100);
});

test('10b. el rango debe tener exactamente 100 números (final = inicio + 99)', async () => {
    const store = new FakeRangos({ rangos: [] });
    await assert.rejects(
        () => rangos.validarRango(store, {
            tipo: 'GLP_ANUAL', planta_key: '201', modalidad: 'ANUAL', nro_inicio: 1, nro_maximo: 99
        }),
        (error) => error.message === 'RANGO_NO_CUMPLE_TAMANO' && error.detalles.obtenido === 99
    );
    const ok = await rangos.validarRango(store, {
        tipo: 'GLP_ANUAL', planta_key: '201', modalidad: 'ANUAL', nro_inicio: 1, nro_maximo: 100
    });
    assert.equal(ok.tamano, 100);
});

test('11. editar un rango USADO no permite retroceder', async () => {
    const store = new FakeRangos({
        rangos: [rango({ id: 4, nro_inicio: 102200, nro_actual: 102218, nro_maximo: 102299, activo: true })]
    });
    const decision = await rangos.editarRango(store, { id: 4, cerrar: true });
    assert.equal(decision.accion, 'CERRAR');
    assert.equal(decision.usado, true);
    assert.equal(decision.rango.nro_actual, 102218);
    await assert.rejects(
        () => rangos.editarRango(store, { id: 4, nro_inicio: 102200, nro_maximo: 102299 }),
        (error) => error.message === 'RANGO_YA_USADO_NO_EDITABLE'
    );
    assert.equal(store.estado.rangos[0].nro_actual, 102218);
});

// ===========================================================================
// 12. Sugerencia del siguiente bloque
// ===========================================================================

test('12. sugerir siguiente bloque devuelve exactamente 100 números libres', async () => {
    const store = new FakeRangos({
        rangos: [
            rango({ id: 1, planta_key: '201', nro_inicio: 103200, nro_actual: 103207, nro_maximo: 103209, activo: false }),
            rango({ id: 2, planta_key: '98', nro_inicio: 103100, nro_actual: 103099, nro_maximo: 103199, activo: true })
        ],
        usados: [{ tipo: 'GLP_ANUAL', numero: 103207, codigo: 'DG-41-103207' }]
    });
    const sugerencia = await rangos.sugerirSiguienteRango(store, {
        tipo: 'GLP_ANUAL', planta_key: '201', modalidad: 'INICIAL'
    });
    assert.equal(sugerencia.nro_maximo - sugerencia.nro_inicio + 1, 100);
    assert.equal(sugerencia.verificacion.ok, true);
    assert.ok(sugerencia.nro_inicio > 103209, 'no reutiliza el rango cerrado');
});

// ===========================================================================
// 13. Concurrencia
// ===========================================================================

test('13. dos asignaciones concurrentes no crean rangos superpuestos', async () => {
    const store = new FakeRangos({
        rangos: [],
        combinaciones: [{ planta_key: '201', tipo: 'GLP_ANUAL', modalidad: 'ANUAL' }]
    });

    const planA = await rangos.calcularPlan(store);
    const planB = await rangos.calcularPlan(store);
    assert.equal(planA.pasos[0].nuevoRango.nro_inicio, planB.pasos[0].nuevoRango.nro_inicio,
        'el cálculo es determinista: ambos admins ven el mismo bloque');

    await rangos.aplicarPlan(store, planA);
    // El segundo intento choca contra el EXCLUDE de la base: se rechaza entero.
    await assert.rejects(() => rangos.aplicarPlan(store, planB));
    assert.equal(store.estado.rangos.length, 1, 'sólo un rango sobrevive');
    assert.equal(store.estado.rangos[0].nro_maximo - store.estado.rangos[0].nro_inicio + 1, 100);
    assert.ok(store.advisories.length >= 2, 'se bloquea la combinación con advisory lock');
});

test('13b. el bloqueo es por combinación (planta+tipo+modalidad)', async () => {
    const store = new FakeRangos({ rangos: [] });
    await rangos.bloquearCombinacion(store, '201', 'GLP_ANUAL', 'ANUAL');
    await rangos.bloquearCombinacion(store, '201', 'GLP_ANUAL', 'INICIAL');
    await rangos.bloquearCombinacion(store, '190', 'GLP_ANUAL', 'ANUAL');
    assert.equal(new Set(store.advisories).size, 3);
});

// ===========================================================================
// Auditoría y código
// ===========================================================================

test('la auditoría detecta tamaño, agotado, sin rango y huérfanos', async () => {
    const store = new FakeRangos({
        rangos: [
            rango({ id: 1, planta_key: '190', nro_inicio: 9001, nro_actual: 9000, nro_maximo: 9013, activo: true }),
            rango({ id: 2, planta_key: '201', nro_inicio: 999, nro_actual: 1000, nro_maximo: 1000, activo: true })
        ],
        combinaciones: [
            { planta_key: '201', tipo: 'GLP_ANUAL', modalidad: 'ANUAL' },
            { planta_key: '201', tipo: 'GNV_ANUAL', modalidad: 'INICIAL' }
        ]
    });
    const auditoria = await rangos.auditar(store);
    assert.equal(auditoria.resumen.rangosTotales, 2);
    assert.equal(auditoria.resumen.rangosAgotados, 1);
    assert.equal(auditoria.resumen.rangosInconsistentes, 2);
    assert.equal(auditoria.resumen.combinacionesSinRangoValido, 2);
    assert.equal(auditoria.resumen.rangosHuerfanos, 1, 'sólo el rango de otra sede es huérfano');
    // Ambos rangos tienen tamaño inválido; el agotamiento se reporta aparte.
    assert.deepEqual(
        auditoria.anomalias.map((a) => a.anomalia),
        ['TAMANO_DISTINTO_DE_100', 'TAMANO_DISTINTO_DE_100']
    );
    const agotado = auditoria.anomalias.find((a) => a.nro_actual >= a.nro_maximo);
    assert.equal(agotado.nro_actual, agotado.nro_maximo);
});

test('el servicio nunca reescribe nro_actual ni borra rangos', () => {
    const fuente = fs.readFileSync(require.resolve('../services/faregas-correlativos-rangos.service'), 'utf8');
    // nro_actual sólo se escribe al INSERTAR un rango nuevo (nro_inicio - 1).
    assert.doesNotMatch(fuente, /UPDATE[\s\S]{0,240}SET[\s\S]{0,80}nro_actual/);
    assert.doesNotMatch(fuente, /DELETE FROM fg_correlativo_certificado/);
    assert.doesNotMatch(fuente, /TRUNCATE/);
    const inserts = [...fuente.matchAll(/INSERT INTO fg_correlativo_certificado[\s\S]*?nro_actual[\s\S]*?;/g)];
    assert.equal(inserts.length, 1, 'sólo hay un INSERT de rango');
    assert.match(inserts[0][0], /inicio - 1/, 'el rango nuevo arranca en inicio - 1');
    assert.doesNotMatch(inserts[0][0], /nro_actual[^\n]*nro_inicio[^\n]*-\s*1\s*\)/);
});

test('el plan nunca se aplica si tiene inconsistencias', async () => {
    const store = new FakeRangos({ rangos: [], combinaciones: [{ planta_key: '201', tipo: 'GLP_ANUAL', modalidad: 'ANUAL' }] });
    const plan = await rangos.calcularPlan(store);
    plan.aplicable = false;
    plan.inconsistencias = [{ motivo: 'simulado' }];
    await assert.rejects(
        () => rangos.aplicarPlan(store, plan),
        (error) => error.message === 'PLAN_NO_APLICABLE' && error.statusCode === 409
    );
    assert.equal(store.estado.rangos.length, 0);
});
