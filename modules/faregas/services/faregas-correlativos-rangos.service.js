const db = require('../../../config/database');

/**
 * Normalización de rangos de correlativo de certificado.
 *
 * Reglas de la casa (verificadas contra la BD):
 *  - Un rango tiene EXACTAMENTE 100 números: nro_maximo - nro_inicio + 1 = 100.
 *  - La identidad de un rango es (planta_key, tipo_certificado_clave, modalidad).
 *  - El prefijo/familia es `tipo_certificado_clave` (DG-22 GNV, DG-39 CONFORMIDAD,
 *    DG-41 GLP). Dentro de una familia los rangos NO pueden solaparse, y esa
 *    restricción ya la impone `excl_fg_correlativo_rango` en la base.
 *  - Un número de certificado ya emitido NUNCA se reutiliza, aunque su rango se
 *    cierre o el certificado se anule.
 *  - `nro_actual` es consumo real: nunca se resetea ni se decrementa.
 *  - Solo puede existir UN rango activo por combinación; los anteriores quedan
 *    históricos con su `nro_actual` intacto.
 */

const TAMANO_RANGO = 100;
const MODALIDADES_PERMITIDAS = ['INICIAL', 'ANUAL', 'UNICA'];

const alinearArriba = (valor, tamano = TAMANO_RANGO) => Math.ceil(valor / tamano) * tamano;

const intersectan = (a, b) => a.ini <= b.fin && b.ini <= a.fin;

/**
 * Siguiente bloque libre de tamaño exacto, contiguo al mayor número ocupado de
 * la familia: 1-100 -> 101-200 -> 201-300. Si el bloque contiguo chocara con
 * otro intervalo se reintenta alineando al siguiente múltiplo del tamaño.
 * Determinista: mismos datos de entrada ⇒ mismo bloque.
 */
const siguienteBloqueLibre = (ocupados = [], maxOcupado = 0, tamano = TAMANO_RANGO) => {
    const ordenados = [...ocupados].sort((a, b) => Number(a.ini) - Number(b.ini));
    let nro_inicio = Number(maxOcupado) > 0 ? Number(maxOcupado) + 1 : 1;
    for (const ocupado of ordenados) {
        if (intersectan({ ini: nro_inicio, fin: nro_inicio + tamano - 1 }, ocupado)) {
            nro_inicio = alinearArriba(Number(ocupado.fin) + 1, tamano);
        }
    }
    return { nro_inicio, nro_maximo: nro_inicio + tamano - 1, tamano };
};

const errorNegocio = (codigo, statusCode = 400, detalles = null) => {
    const error = new Error(codigo);
    error.code = codigo;
    error.codigo = codigo;
    error.status = statusCode;
    error.statusCode = statusCode;
    if (detalles) error.detalles = detalles;
    return error;
};

/** Normaliza la modalidad real del servicio al dominio del correlativo. */
const normalizarModalidad = (modalidad) => {
    const valor = String(modalidad || '').trim().toUpperCase();
    return MODALIDADES_PERMITIDAS.includes(valor) ? valor : 'UNICA';
};

/**
 * Números de certificado YA emitidos, agrupados por familia.
 * Se toma sólo el último segmento del código (DG-41-103207 → 103207).
 */
const obtenerNumerosHistoricos = async (queryable) => {
    const result = await queryable.query(`
        SELECT tipo_certificado_clave AS tipo,
               split_part(numero_certificado, '-', 3) AS numero,
               numero_certificado
        FROM fg_certificado
        WHERE numero_certificado ~ '^[A-Z]+-[0-9]+-[0-9]+$'
          AND split_part(numero_certificado, '-', 3) ~ '^[0-9]+$'
    `);
    const porTipo = new Map();
    for (const fila of result.rows) {
        const numero = Number(fila.numero);
        if (!Number.isSafeInteger(numero)) continue;
        if (!porTipo.has(fila.tipo)) porTipo.set(fila.tipo, new Set());
        porTipo.get(fila.tipo).add(numero);
    }
    return porTipo;
};

/** Combinaciones reales sede+tipo+modalidad que la operación puede usar. */
const obtenerCombinacionesReales = async (queryable) => {
    const result = await queryable.query(`
        SELECT DISTINCT t.planta_key, s.tipo_certificado_clave AS tipo,
               COALESCE(s.modalidad, 'UNICA') AS modalidad
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        JOIN fg_planta p ON p.key = t.planta_key
        WHERE p.activo = TRUE
          AND p.empresa_key = 'FAREGAS'
          AND t.activo = TRUE
          AND s.activo = TRUE
        ORDER BY 1, 2, 3
    `);
    return result.rows.map((fila) => ({
        planta_key: fila.planta_key,
        tipo: fila.tipo,
        modalidad: normalizarModalidad(fila.modalidad)
    }));
};

const obtenerRangos = async (queryable, cliente = null) => {
    const sql = `
        SELECT id, planta_key, tipo_certificado_clave AS tipo, modalidad,
               nro_inicio, nro_actual, nro_maximo, activo, fecha_asignacion, fecha_cierre
        FROM fg_correlativo_certificado
        ORDER BY tipo_certificado_clave, planta_key, modalidad, nro_inicio
    `;
    const result = cliente ? await cliente.query(sql) : await queryable.query(sql);
    return result.rows.map((fila) => ({
        ...fila,
        nro_inicio: Number(fila.nro_inicio),
        nro_actual: Number(fila.nro_actual),
        nro_maximo: Number(fila.nro_maximo),
        usado: Number(fila.nro_actual) - (Number(fila.nro_inicio) - 1),
        disponible: Number(fila.nro_maximo) - Number(fila.nro_actual),
        tamano: Number(fila.nro_maximo) - Number(fila.nro_inicio) + 1
    }));
};

const construirOcupacion = (rangos, historicos) => {
    const ocupados = new Map();
    const maximos = new Map();
    const agregar = (tipo, ini, fin) => {
        if (!ocupados.has(tipo)) ocupados.set(tipo, []);
        ocupados.get(tipo).push({ ini: Number(ini), fin: Number(fin) });
        maximos.set(tipo, Math.max(maximos.get(tipo) || 0, Number(fin)));
    };
    for (const rango of rangos) agregar(rango.tipo, rango.nro_inicio, rango.nro_maximo);
    for (const [tipo, numeros] of historicos) {
        for (const numero of numeros) agregar(tipo, numero, numero);
    }
    return { ocupados, maximos };
};

const estaLibre = (tipo, bloque, ocupados, historicos) => {
    const cruza = (ocupados.get(tipo) || []).some((ocupado) => intersectan(
        { ini: bloque.nro_inicio, fin: bloque.nro_maximo }, ocupado
    ));
    const reutiliza = [...(historicos.get(tipo) || [])].some((numero) => (
        numero >= bloque.nro_inicio && numero <= bloque.nro_maximo
    ));
    return { ok: !cruza && !reutiliza, cruza, reutiliza };
};

/**
 * Auditoría de estado: anomalías, combinaciones sin rango y rangos huérfanos.
 * Sólo lectura.
 */
const auditar = async (queryable) => {
    const rangos = await obtenerRangos(queryable);
    const historicos = await obtenerNumerosHistoricos(queryable);
    const combinaciones = await obtenerCombinacionesReales(queryable);

    const porCombinacion = new Map();
    for (const rango of rangos) {
        const clave = `${rango.planta_key}|${rango.tipo}|${rango.modalidad}`;
        if (!porCombinacion.has(clave)) porCombinacion.set(clave, []);
        porCombinacion.get(clave).push(rango);
    }
    const clavesReales = new Set(combinaciones.map(
        (c) => `${c.planta_key}|${c.tipo}|${c.modalidad}`
    ));

    const rangoValido = (rango) => rango.tamano === TAMANO_RANGO && rango.nro_actual < rango.nro_maximo;
    const anomalias = rangos.filter((rango) => (
        rango.tamano !== TAMANO_RANGO
        || rango.nro_actual > rango.nro_maximo
        || rango.nro_actual < rango.nro_inicio - 1
        || (rango.activo && rango.nro_actual >= rango.nro_maximo)
    )).map((rango) => ({
        ...rango,
        anomalia: rango.tamano !== TAMANO_RANGO ? 'TAMANO_DISTINTO_DE_100'
            : rango.nro_actual > rango.nro_maximo ? 'NRO_ACTUAL_MAYOR_A_MAXIMO'
            : rango.nro_actual < rango.nro_inicio - 1 ? 'NRO_ACTUAL_MENOR_A_INICIO_MENOS_UNO'
            : 'RANGO_AGOTADO_Y_ACTIVO'
    }));

    const sinRango = combinaciones.filter((c) => {
        const filas = porCombinacion.get(`${c.planta_key}|${c.tipo}|${c.modalidad}`) || [];
        return filas.filter((r) => r.activo && rangoValido(r)).length !== 1;
    });

    const multiples = [...porCombinacion.entries()].filter(([, filas]) => (
        filas.filter((r) => r.activo).length > 1
    )).map(([clave, filas]) => ({
        combinacion: clave, ids: filas.filter((r) => r.activo).map((r) => r.id)
    }));

    const huerfanos = rangos.filter((rango) => !clavesReales.has(
        `${rango.planta_key}|${rango.tipo}|${rango.modalidad}`
    ));

    return {
        resumen: {
            rangosTotales: rangos.length,
            rangosActivos: rangos.filter((r) => r.activo).length,
            rangosHistoricos: rangos.filter((r) => !r.activo).length,
            rangosAgotados: rangos.filter((r) => r.activo && r.nro_actual >= r.nro_maximo).length,
            rangosInconsistentes: anomalias.length,
            combinacionesReales: combinaciones.length,
            combinacionesSinRangoValido: sinRango.length,
            combinacionesConMultiplesActivos: multiples.length,
            rangosHuerfanos: huerfanos.length
        },
        anomalias,
        combinaciones,
        sinRango,
        multiples,
        huerfanos
    };
};

/**
 * PLAN de normalización. Calcula, por combinación, qué rango activo se cierra y
 * qué bloque nuevo de 100 números se crea. No escribe nada.
 */
const calcularPlan = async (queryable) => {
    const rangos = await obtenerRangos(queryable);
    const historicos = await obtenerNumerosHistoricos(queryable);
    const combinaciones = await obtenerCombinacionesReales(queryable);
    const { ocupados, maximos } = construirOcupacion(rangos, historicos);

    const porCombinacion = new Map();
    for (const rango of rangos) {
        const clave = `${rango.planta_key}|${rango.tipo}|${rango.modalidad}`;
        if (!porCombinacion.has(clave)) porCombinacion.set(clave, []);
        porCombinacion.get(clave).push(rango);
    }
    const rangoValido = (rango) => rango.tamano === TAMANO_RANGO && rango.nro_actual < rango.nro_maximo;

    const pendientes = combinaciones.filter((c) => {
        const filas = porCombinacion.get(`${c.planta_key}|${c.tipo}|${c.modalidad}`) || [];
        return filas.filter((r) => r.activo && rangoValido(r)).length !== 1;
    }).sort((a, b) => (
        a.tipo.localeCompare(b.tipo)
        || a.planta_key.localeCompare(b.planta_key)
        || a.modalidad.localeCompare(b.modalidad)
    ));

    const pasos = [];
    for (const combinacion of pendientes) {
        const filas = porCombinacion.get(`${combinacion.planta_key}|${combinacion.tipo}|${combinacion.modalidad}`) || [];
        const activos = filas.filter((r) => r.activo);
        if (!ocupados.has(combinacion.tipo)) {
            ocupados.set(combinacion.tipo, []);
            maximos.set(combinacion.tipo, 0);
        }
        const bloque = siguienteBloqueLibre(
            ocupados.get(combinacion.tipo) || [],
            maximos.get(combinacion.tipo) || 0
        );
        const verificacion = estaLibre(combinacion.tipo, bloque, ocupados, historicos);
        pasos.push({
            combinacion,
            rangoActual: activos[0] || null,
            cerrar: activos.map((r) => ({
                id: r.id,
                nro_inicio: r.nro_inicio,
                nro_maximo: r.nro_maximo,
                nro_actual: r.nro_actual
            })),
            motivo: activos.length === 0 ? 'SIN_RANGO_ACTIVO' : 'RANGO_ACTIVO_INVALIDO',
            nuevoRango: bloque,
            verificacion
        });
        ocupados.get(combinacion.tipo).push({ ini: bloque.nro_inicio, fin: bloque.nro_maximo });
        maximos.set(combinacion.tipo, Math.max(maximos.get(combinacion.tipo) || 0, bloque.nro_maximo));
    }

    return {
        tamanoRango: TAMANO_RANGO,
        pasos,
        inconsistencias: pasos.filter((paso) => !paso.verificacion.ok),
        aplicable: pasos.every((paso) => paso.verificacion.ok)
    };
};

/**
 * Bloque libre sugerido para una combinación concreta (botón
 * "USAR SIGUIENTE RANGO DISPONIBLE" del modal de edición).
 */
const sugerirSiguienteRango = async (queryable, { tipo, planta_key, modalidad, ignorarRangoId = null }) => {
    const rangos = await obtenerRangos(queryable);
    const historicos = await obtenerNumerosHistoricos(queryable);
    const { ocupados, maximos } = construirOcupacion(
        rangos.filter((rango) => Number(rango.id) !== Number(ignorarRangoId)),
        historicos
    );
    const bloque = siguienteBloqueLibre(ocupados.get(tipo) || [], maximos.get(tipo) || 0);
    return { ...bloque, verificacion: estaLibre(tipo, bloque, ocupados, historicos) };
};

/** Valida un rango candidato: tamaño exacto, solapamiento y reutilización. */
const validarRango = async (queryable, { tipo, planta_key, modalidad, nro_inicio, nro_maximo, ignorarRangoId = null }) => {
    const inicio = Number(nro_inicio);
    const fin = Number(nro_maximo);
    if (!Number.isSafeInteger(inicio) || inicio < 1) throw errorNegocio('NRO_INICIO_INVALIDO', 400);
    if (!Number.isSafeInteger(fin) || fin < inicio) throw errorNegocio('NRO_MAXIMO_INVALIDO', 400);
    if (fin - inicio + 1 !== TAMANO_RANGO) {
        throw errorNegocio('RANGO_NO_CUMPLE_TAMANO', 400, {
            nro_inicio: inicio,
            nro_maximo: fin,
            requerido: TAMANO_RANGO,
            obtenido: fin - inicio + 1
        });
    }
    const rangos = await obtenerRangos(queryable);
    const historicos = await obtenerNumerosHistoricos(queryable);
    const otros = rangos.filter((rango) => Number(rango.id) !== Number(ignorarRangoId));
    const solapado = otros.find((rango) => rango.tipo === tipo && intersectan(
        { ini: inicio, fin }, { ini: rango.nro_inicio, fin: rango.nro_maximo }
    ));
    if (solapado) {
        throw errorNegocio('RANGO_SE_SOLAPA', 409, {
            conflicto: { id: solapado.id, planta_key: solapado.planta_key, tipo: solapado.tipo, nro_inicio: solapado.nro_inicio, nro_maximo: solapado.nro_maximo }
        });
    }
    const reutilizado = [...(historicos.get(tipo) || [])].filter((numero) => numero >= inicio && numero <= fin);
    if (reutilizado.length > 0) {
        throw errorNegocio('RANGO_REUTILIZA_NUMEROS_USADOS', 409, { numeros: reutilizado.slice(0, 20) });
    }
    const activos = otros.filter((rango) => (
        rango.activo && rango.planta_key === planta_key && rango.tipo === tipo && rango.modalidad === modalidad
    ));
    if (activos.length > 0) {
        throw errorNegocio('YA_EXISTE_RANGO_ACTIVO', 409, {
            id: activos[0].id, nro_inicio: activos[0].nro_inicio, nro_maximo: activos[0].nro_maximo
        });
    }
    return { nro_inicio: inicio, nro_maximo: fin, tamano: TAMANO_RANGO };
};

// ---------------------------------------------------------------------------
// Escrituras (siempre dentro de una transacción del llamador)
// ---------------------------------------------------------------------------

/**
 * Cierra un rango como histórico. `nro_actual` NO se toca: es consumo real.
 */
const cerrarRango = async (client, rangoId) => {
    const resultado = await client.query(`
        UPDATE fg_correlativo_certificado
        SET activo = FALSE,
            fecha_cierre = CURRENT_TIMESTAMP,
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, planta_key, tipo_certificado_clave AS tipo, modalidad,
                  nro_inicio, nro_actual, nro_maximo, activo
    `, [rangoId]);
    if (resultado.rowCount !== 1) throw errorNegocio('RANGO_NO_ENCONTRADO', 404);
    return resultado.rows[0];
};

/**
 * Crea un rango nuevo. `nro_actual` arranca en `nro_inicio - 1` porque el rango
 * es nuevo y no tiene consumo: eso NO es retroceder un correlativo ya usado.
 */
const crearRango = async (client, { planta_key, tipo, modalidad, nro_inicio, nro_maximo }) => {
    const inicio = Number(nro_inicio);
    const fin = Number(nro_maximo);
    if (fin - inicio + 1 !== TAMANO_RANGO) {
        throw errorNegocio('RANGO_NO_CUMPLE_TAMANO', 400, {
            nro_inicio: inicio, nro_maximo: fin, requerido: TAMANO_RANGO, obtenido: fin - inicio + 1
        });
    }
    const resultado = await client.query(`
        INSERT INTO fg_correlativo_certificado
            (planta_key, tipo_certificado_clave, modalidad, nro_inicio, nro_maximo, nro_actual, activo)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        RETURNING id, planta_key, tipo_certificado_clave AS tipo, modalidad,
                  nro_inicio, nro_actual, nro_maximo, activo
    `, [planta_key, tipo, normalizarModalidad(modalidad), inicio, fin, inicio - 1]);
    return resultado.rows[0];
};

/**
 * Bloquea la combinación para que dos administradores no asignen rangos
 * cruzados a la vez. `excl_fg_correlativo_rango` sigue siendo la red de
 * seguridad final para solapamientos.
 */
const bloquearCombinacion = async (client, planta_key, tipo, modalidad) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${planta_key}|${tipo}|${normalizarModalidad(modalidad)}`
    ]);
};

/**
 * Aplica el plan de normalización dentro de la transacción del llamador.
 * Cierra los rangos inválidos conservando su `nro_actual` y crea el bloque
 * nuevo de 100 números. Si algo falla, el llamador hace ROLLBACK completo.
 */
const aplicarPlan = async (client, plan) => {
    if (!plan || plan.aplicable === false) {
        throw errorNegocio('PLAN_NO_APLICABLE', 409, {
            inconsistencias: (plan && plan.inconsistencias) || []
        });
    }
    const aplicados = [];
    for (const paso of plan.pasos) {
        const { planta_key, tipo, modalidad } = paso.combinacion;
        await bloquearCombinacion(client, planta_key, tipo, modalidad);
        const cerrados = [];
        for (const rango of paso.cerrar) {
            cerrados.push(await cerrarRango(client, rango.id));
        }
        const creado = await crearRango(client, {
            planta_key,
            tipo,
            modalidad,
            nro_inicio: paso.nuevoRango.nro_inicio,
            nro_maximo: paso.nuevoRango.nro_maximo
        });
        aplicados.push({ combinacion: paso.combinacion, cerrados, creado, motivo: paso.motivo });
    }
    return { tamanoRango: TAMANO_RANGO, aplicados };
};

/**
 * Edición de un rango existente.
 *  - Rango SIN uso: se pueden mover inicio/final manteniendo 100 números.
 *  - Rango CON uso: inicio/final quedan bloqueados; sólo se puede cerrar.
 * `nro_actual` siempre es de sólo lectura: jamás se escribe.
 */
const editarRango = async (queryable, { id, nro_inicio, nro_maximo, cerrar = false }) => {
    const rangos = await obtenerRangos(queryable);
    const rango = rangos.find((fila) => Number(fila.id) === Number(id));
    if (!rango) throw errorNegocio('RANGO_NO_ENCONTRADO', 404);
    const usado = rango.nro_actual > rango.nro_inicio - 1;

    if (cerrar) {
        return { accion: 'CERRAR', usado, rango };
    }
    if (usado) {
        throw errorNegocio('RANGO_YA_USADO_NO_EDITABLE', 409, {
            nro_actual: rango.nro_actual,
            nro_inicio: rango.nro_inicio,
            nro_maximo: rango.nro_maximo,
            mensaje: 'El rango ya emitió certificados. Ciérrelo y asigne un rango nuevo.'
        });
    }
    const validado = await validarRango(queryable, {
        tipo: rango.tipo,
        planta_key: rango.planta_key,
        modalidad: rango.modalidad,
        nro_inicio,
        nro_maximo,
        ignorarRangoId: rango.id
    });
    return { accion: 'EDITAR', usado, rango, ...validado };
};

exports.TAMANO_RANGO = TAMANO_RANGO;
exports.MODALIDADES_PERMITIDAS = MODALIDADES_PERMITIDAS;
exports.alinearArriba = alinearArriba;
exports.intersectan = intersectan;
exports.normalizarModalidad = normalizarModalidad;
exports.siguienteBloqueLibre = siguienteBloqueLibre;
exports.obtenerNumerosHistoricos = obtenerNumerosHistoricos;
exports.obtenerRangos = obtenerRangos;
exports.obtenerCombinacionesReales = obtenerCombinacionesReales;
exports.auditar = auditar;
exports.calcularPlan = calcularPlan;
exports.sugerirSiguienteRango = sugerirSiguienteRango;
exports.validarRango = validarRango;
exports.cerrarRango = cerrarRango;
exports.crearRango = crearRango;
exports.bloquearCombinacion = bloquearCombinacion;
exports.aplicarPlan = aplicarPlan;
exports.editarRango = editarRango;
exports.errorNegocio = errorNegocio;
exports._db = db;
