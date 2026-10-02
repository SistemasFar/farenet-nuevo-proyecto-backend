const db = require('../../../config/database');

/**
 * CORRELATIVOS DE CERTIFICADO: INVENTARIO DE RANGOS POR SEDE.
 *
 * Este servicio reemplaza a `faregas-correlativos-rangos.service.js` en el
 * camino de emisión. La diferencia es de modelo, no de detalle:
 *
 *   antes  -> la unidad es (planta_key, tipo_certificado_clave, modalidad)
 *   ahora  -> la unidad es la SEDE y su rango físico
 *
 * Reglas del inventario, que vienen del funcionamiento real:
 *
 *  - Un rango pertenece a la SEDE. No tiene tipo de certificado, ni modalidad,
 *    ni producto, ni servicio. Esos datos no aparecen en la tabla ni en las
 *    consultas: si un producto y un tipo distinto consumen de la misma sede,
 *    salen del MISMO rango, consecutivamente.
 *
 *  - Cada rango va de 1 a 50 números. `cantidad = rango_fin - rango_inicio + 1`.
 *    No hay tamaño fijo de 100: los bloques que entrega el proveedor vienen en
 *    tamaños variables.
 *
 *  - Una sede tiene UN solo rango ACTIVO. Cuando se agota queda como historial
 *    (AGOTADO) y se agrega un rango nuevo. No se amplía, no se reinicia, no se
 *    recarga: eso reutilizaría números ya entregados a otra sede.
 *
 *  - Los números físicos son únicos: la restricción de exclusión es GLOBAL, sin
 *    columna de familia. Un rango no se solapa con otro ni dentro de la misma
 *    sede ni con otra sede.
 *
 *  - `numero_actual` es consumo real: nunca retrocede, nunca se resetea y nunca
 *    se reduce el final por debajo de lo ya entregado.
 *
 *  - La previsualización NO entra aquí. Este módulo sólo consume en
 *    `consumirNumero`, que se llama desde la emisión definitiva y siempre
 *    dentro de la transacción que emite.
 *
 * Sobre el formato impreso: el número que se guarda en
 * `fg_certificado.numero_certificado` sigue siendo `DG-{codigo}-{numero}`,
 * porque el código DG pertenece al tipo de certificado y las plantillas ya lo
 * imprimen. Lo que cambia de modelo es DE DÓNDE SALE el número: del inventario
 * de la sede, no de un contador por tipo. El mismo número físico no se entrega
 * dos veces en una sede aunque lo usen tipos distintos.
 */

const ESTADOS = Object.freeze(['ACTIVO', 'AGOTADO', 'CERRADO']);

/** Tope de números por rango. Lo fija la regla del inventario. */
const CANTIDAD_MAXIMA = 50;

/** Tamaño de la SUGERENCIA al agregar un rango. Es sólo una ayuda. */
const TAMANO_SUGERENCIA = 50;

/**
 * Intentos de lectura del rango activo. Cada intento puede encontrarlo ya
 * agotado por otra transacción; el bloqueo por sede hace que eso sea raro, pero
 * la relectura lo hace seguro igual.
 */
const INTENTOS_CONSUMO = 5;

const errorNegocio = (codigo, statusCode = 400, detalles = null) => {
    const error = new Error(codigo);
    error.code = codigo;
    error.codigo = codigo;
    error.status = statusCode;
    error.statusCode = statusCode;
    if (detalles) error.detalles = detalles;
    return error;
};

const numero = (valor) => Number(valor);

// ---------------------------------------------------------------------------
// Mensajes de interfaz. Se exportan para que backend y tests usen el mismo
// texto y no se desincronicen.
// ---------------------------------------------------------------------------

const MENSAJES = Object.freeze({
    SEDE_SIN_CORRELATIVOS:
        'La sede no tiene correlativos disponibles. Asigne un nuevo rango de hasta 50 números.',
    RANGO_SE_SOLAPA:
        'El rango indicado se superpone con números ya asignados a otra sede.',
    RANGO_SOLAPA_DENTRO_DE_SEDE:
        'El rango indicado se superpone con otro rango de la misma sede.',
    RANGO_INICIO_BLOQUEADO:
        'El inicio del rango no puede cambiar porque ya existen certificados emitidos.',
    RANGO_MAXIMO_BLOQUEADO:
        'El final del rango no puede quedar por debajo de los certificados ya emitidos.',
    SEDE_YA_TIENE_RANGO_ACTIVO:
        'La sede ya tiene un rango activo. Agote o cierre ese rango antes de asignar otro.',
    CANTIDAD_FUERA_DE_RANGO:
        'El rango debe tener entre 1 y 50 números (hasta - desde + 1).',
    RANGO_CERRADO_NO_EDITABLE:
        'El rango está cerrado: no se puede modificar.'
});

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const obtenerRangoPorId = async (queryable, id) => {
    const { rows } = await queryable.query(`
        SELECT id, planta_key, rango_inicio, numero_actual, rango_fin, cantidad, disponibles,
               estado, fecha_asignacion, fecha_cierre, observacion
        FROM fg_correlativo_certificado_sede
        WHERE id = $1`, [id]);
    return rows[0] || null;
};

/**
 * Listado del inventario con las columnas que pide la pantalla: sede, fecha de
 * asignación, rango, número actual, cantidad, disponibles, estado y
 * observación. `cantidad` y `disponibles` llegan calculados desde la base.
 */
const listarRangos = async (queryable, { plantaKey = null, estado = null } = {}) => {
    const params = [];
    const filtros = [];
    if (plantaKey) {
        params.push(plantaKey);
        filtros.push(`c.planta_key = $${params.length}`);
    }
    if (estado && ESTADOS.includes(estado)) {
        params.push(estado);
        filtros.push(`c.estado = $${params.length}`);
    }
    const { rows } = await queryable.query(`
        SELECT c.id, c.planta_key, p.nombre AS planta_nombre, p.activo AS planta_activa,
               c.rango_inicio, c.rango_fin, c.numero_actual, c.cantidad, c.disponibles,
               c.estado, c.fecha_asignacion, c.fecha_cierre, c.observacion
        FROM fg_correlativo_certificado_sede c
        LEFT JOIN fg_planta p ON p.key = c.planta_key
        ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
        ORDER BY c.planta_key,
                 CASE c.estado WHEN 'ACTIVO' THEN 0 WHEN 'AGOTADO' THEN 1 ELSE 2 END,
                 c.fecha_asignacion DESC
    `, params);

    return rows.map((fila) => ({
        ...fila,
        rango_inicio: numero(fila.rango_inicio),
        rango_fin: numero(fila.rango_fin),
        numero_actual: numero(fila.numero_actual),
        cantidad: numero(fila.cantidad),
        disponibles: numero(fila.disponibles),
        usados: numero(fila.numero_actual) - (numero(fila.rango_inicio) - 1),
        // Un rango cuya fecha de asignación aún no llega existe en el inventario
        // pero todavía no se consume. Se deriva de la fecha y no es un estado
        // almacenado, para que no pueda quedar desincronizado.
        vigente: new Date(fila.fecha_asignacion).getTime() <= Date.now(),
        estadoMostrado: fila.estado === 'ACTIVO'
            && new Date(fila.fecha_asignacion).getTime() > Date.now()
            ? 'PENDIENTE'
            : fila.estado
    }));
};

/** Totales por sede: cuántos rangos tiene, cuántos números le quedan. */
const obtenerResumenPorSede = async (queryable, { plantaKey = null } = {}) => {
    const params = [];
    const filtro = plantaKey ? 'WHERE c.planta_key = $1' : '';
    if (plantaKey) params.push(plantaKey);
    const { rows } = await queryable.query(`
        SELECT c.planta_key,
               p.nombre AS planta_nombre,
               COUNT(*)::int                                             AS rangos,
               COUNT(*) FILTER (WHERE c.estado = 'ACTIVO')::int          AS activos,
               COUNT(*) FILTER (WHERE c.estado = 'AGOTADO')::int         AS agotados,
               COUNT(*) FILTER (WHERE c.estado = 'CERRADO')::int         AS cerrados,
               COALESCE(SUM(c.cantidad), 0)::bigint                      AS numeros_totales,
               COALESCE(SUM(c.disponibles), 0)::bigint                   AS numeros_libres
        FROM fg_correlativo_certificado_sede c
        LEFT JOIN fg_planta p ON p.key = c.planta_key
        ${filtro}
        GROUP BY c.planta_key, p.nombre
        ORDER BY c.planta_key
    `, params);
    return rows.map((fila) => ({
        ...fila,
        numeros_totales: numero(fila.numeros_totales),
        numeros_libres: numero(fila.numeros_libres)
    }));
};

/**
 * Qué número recibiría la próxima emisión de esta sede. SOLO LECTURA: no
 * bloquea, no incrementa y no reserva nada. La previsualización puede llamarlo
 * sin riesgo.
 */
const previsualizarProximo = async (queryable, plantaKey) => {
    const { rows } = await queryable.query(`
        SELECT id, rango_inicio, numero_actual, rango_fin, disponibles
        FROM fg_correlativo_certificado_sede
        WHERE planta_key = $1
          AND estado = 'ACTIVO'
          AND fecha_asignacion <= CURRENT_TIMESTAMP
          AND numero_actual < rango_fin
        ORDER BY fecha_asignacion ASC, rango_inicio ASC
        LIMIT 1
    `, [plantaKey]);
    if (rows.length === 0) return { disponible: false, motivo: MENSAJES.SEDE_SIN_CORRELATIVOS };
    const rango = rows[0];
    return {
        disponible: true,
        rangoId: rango.id,
        nro: numero(rango.numero_actual) + 1,
        rango_inicio: numero(rango.rango_inicio),
        rango_fin: numero(rango.rango_fin)
    };
};

/**
 * Números de certificado YA emitidos, por sede. Un rango no puede cubrir
 * números que ya se entregaron: eso sería reutilizar un número.
 */
const obtenerEmitidosPorSede = async (queryable) => {
    const { rows } = await queryable.query(`
        SELECT planta_key,
               split_part(numero_certificado, '-', 3) AS numero
        FROM fg_certificado
        WHERE numero_certificado IS NOT NULL
          AND numero_certificado ~ '^[A-Z]+-[0-9]+-[0-9]+$'
          AND split_part(numero_certificado, '-', 3) ~ '^[0-9]+$'
    `);
    const porSede = new Map();
    for (const fila of rows) {
        const n = Number(fila.numero);
        if (!Number.isSafeInteger(n)) continue;
        if (!porSede.has(fila.planta_key)) porSede.set(fila.planta_key, []);
        porSede.get(fila.planta_key).push(n);
    }
    return porSede;
};

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

/**
 * Valida un rango candidato contra el inventario real. Comprueba, en orden:
 * números enteros coherentes, cantidad entre 1 y 50, existencia de la sede,
 * solapamiento con cualquier rango (de esa sede o de otra), reutilización de
 * números ya emitidos y un solo rango activo por sede.
 *
 * No escribe nada.
 */
const validarRango = async (queryable, {
    plantaKey, rango_inicio, rango_fin, ignorarRangoId = null, exigirActivo = true
}) => {
    const inicio = numero(rango_inicio);
    const fin = numero(rango_fin);
    if (!Number.isSafeInteger(inicio) || inicio < 1) {
        throw errorNegocio('RANGO_INICIO_INVALIDO', 400, {
            mensaje: 'El número inicial debe ser un entero mayor que cero.'
        });
    }
    if (!Number.isSafeInteger(fin) || fin < inicio) {
        throw errorNegocio('RANGO_FIN_INVALIDO', 400, {
            mensaje: 'El número final debe ser un entero mayor o igual al inicial.'
        });
    }
    const cantidad = fin - inicio + 1;
    if (cantidad < 1 || cantidad > CANTIDAD_MAXIMA) {
        throw errorNegocio('CANTIDAD_FUERA_DE_RANGO', 400, {
            mensaje: MENSAJES.CANTIDAD_FUERA_DE_RANGO,
            cantidad, maximo: CANTIDAD_MAXIMA
        });
    }

    const planta = await queryable.query('SELECT key, nombre FROM fg_planta WHERE key = $1', [plantaKey]);
    if (planta.rowCount === 0) {
        throw errorNegocio('PLANTA_NOT_FOUND', 404, { mensaje: 'La sede indicada no existe.' });
    }

    const { rows: existentes } = await queryable.query(`
        SELECT id, planta_key, rango_inicio, rango_fin, estado
        FROM fg_correlativo_certificado_sede
        WHERE ($1::bigint IS NULL OR id <> $1::bigint)
          AND rango_inicio <= $3::bigint AND $2::bigint <= rango_fin
        ORDER BY rango_inicio
    `, [ignorarRangoId, inicio, fin]);

    if (existentes.length > 0) {
        const mismaSede = existentes.find((f) => f.planta_key === plantaKey);
        const conflicto = mismaSede || existentes[0];
        throw errorNegocio(
            mismaSede ? 'RANGO_SOLAPA_DENTRO_DE_SEDE' : 'RANGO_SE_SOLAPA',
            409,
            {
                mensaje: mismaSede ? MENSAJES.RANGO_SOLAPA_DENTRO_DE_SEDE : MENSAJES.RANGO_SE_SOLAPA,
                conflicto: {
                    id: conflicto.id,
                    planta_key: conflicto.planta_key,
                    rango_inicio: numero(conflicto.rango_inicio),
                    rango_fin: numero(conflicto.rango_fin),
                    estado: conflicto.estado
                }
            }
        );
    }

    // No se puede ofrecer un rango que contenga números ya entregados en esa
    // misma sede. Los certificados de otra sede no se cruzan aquí: la
    // exclusividad global la garantiza la restricción de exclusión.
    const emitidos = (await obtenerEmitidosPorSede(queryable)).get(plantaKey) || [];
    const reutilizados = emitidos.filter((n) => n >= inicio && n <= fin);
    if (reutilizados.length > 0) {
        throw errorNegocio('RANGO_REUTILIZA_NUMEROS_USADOS', 409, {
            mensaje: 'El rango contiene números de certificado ya emitidos en esta sede.',
            numeros: reutilizados.slice(0, 20)
        });
    }

    // Una sede, un rango activo. El índice parcial uk_fg_corr_sede_activo lo
    // impone en la base; aquí se avisa antes para que el mensaje sea útil.
    if (exigirActivo) {
        const activo = await queryable.query(`
            SELECT id, rango_inicio, rango_fin, numero_actual
            FROM fg_correlativo_certificado_sede
            WHERE planta_key = $1 AND estado = 'ACTIVO'
              AND ($2::bigint IS NULL OR id <> $2::bigint)
        `, [plantaKey, ignorarRangoId]);
        if (activo.rowCount > 0) {
            throw errorNegocio('SEDE_YA_TIENE_RANGO_ACTIVO', 409, {
                mensaje: MENSAJES.SEDE_YA_TIENE_RANGO_ACTIVO,
                activo: {
                    id: activo.rows[0].id,
                    rango_inicio: numero(activo.rows[0].rango_inicio),
                    rango_fin: numero(activo.rows[0].rango_fin),
                    numero_actual: numero(activo.rows[0].numero_actual)
                }
            });
        }
    }

    return {
        planta_key: plantaKey,
        rango_inicio: inicio,
        rango_fin: fin,
        cantidad
    };
};

/** Encuentra el primer bloque global libre, incluyendo huecos intermedios. */
const encontrarPrimerBloqueLibre = (rangos, tamano = TAMANO_SUGERENCIA) => {
    let inicio = 1;
    const ordenados = [...rangos].sort((a, b) => (
        numero(a.rango_inicio) - numero(b.rango_inicio)
        || numero(a.rango_fin) - numero(b.rango_fin)
    ));

    for (const rango of ordenados) {
        const ocupadoDesde = numero(rango.rango_inicio);
        const ocupadoHasta = numero(rango.rango_fin);
        if (ocupadoHasta < inicio) continue;
        if (ocupadoDesde - inicio >= tamano) break;
        inicio = Math.max(inicio, ocupadoHasta + 1);
    }

    return {
        rango_inicio: inicio,
        rango_fin: inicio + tamano - 1,
        cantidad: tamano
    };
};

/**
 * Bloque libre sugerido: el primer espacio global de 50 números que no cruza
 * ningún rango registrado, aunque el hueco esté entre dos rangos existentes.
 * Es sólo una sugerencia; la escritura vuelve a validar y la exclusión GiST es
 * la última protección frente a concurrencia.
 */
const sugerirRango = async (queryable, { plantaKey } = {}) => {
    const { rows } = await queryable.query(`
        SELECT rango_inicio, rango_fin
        FROM fg_correlativo_certificado_sede
        ORDER BY rango_inicio, rango_fin
    `);
    const libre = encontrarPrimerBloqueLibre(rows);
    return {
        planta_key: plantaKey || null,
        ...libre
    };
};

// ---------------------------------------------------------------------------
// Escrituras (siempre dentro de la transacción del llamador)
// ---------------------------------------------------------------------------

/**
 * "Asignar rango a sede". Alta desde la interfaz: valida y escribe, en una sola
 * transacción, para que la exclusión global sea la última palabra.
 */
exports.agregarRango = async (datos) => {
    const inicio = numero(datos.rango_inicio);
    const fin = numero(datos.rango_fin);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await bloquearSede(client, datos.plantaKey);
        const validado = await validarRango(client, datos);
        const { rows } = await client.query(`
            INSERT INTO fg_correlativo_certificado_sede
                (planta_key, rango_inicio, rango_fin, numero_actual, estado,
                 fecha_asignacion, observacion)
            VALUES ($1, $2, $3, $4, 'ACTIVO',
                    COALESCE($5::timestamp, CURRENT_TIMESTAMP), $6)
            RETURNING id, planta_key, rango_inicio, rango_fin, numero_actual, cantidad,
                      disponibles, estado, fecha_asignacion, fecha_cierre, observacion
        `, [datos.plantaKey, inicio, fin, inicio - 1,
            datos.fechaAsignacion || null, datos.observacion || null]);
        await client.query('COMMIT');
        return { ...rows[0], ...validado };
    } catch (error) {
        await client.query('ROLLBACK');
        throw traducirErrorDeExclusion(error);
    } finally {
        client.release();
    }
};

/**
 * Edición de un rango existente.
 *
 *  - Sin consumo: se pueden corregir desde y hasta mientras no solapen.
 *  - Con consumo: el inicio queda congelado y el final no puede bajar de lo
 *    entregado. `numero_actual` es de sólo lectura: jamás se escribe.
 *  - Cerrado: no se toca.
 */
exports.editarRango = async (id, datos) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const rango = await obtenerRangoPorId(client, id);
        if (!rango) throw errorNegocio('RANGO_NO_ENCONTRADO', 404, { mensaje: 'El rango indicado no existe.' });
        if (rango.estado === 'CERRADO') {
            throw errorNegocio('RANGO_CERRADO_NO_EDITABLE', 409, { mensaje: MENSAJES.RANGO_CERRADO_NO_EDITABLE });
        }

        await bloquearSede(client, rango.planta_key);

        const actual = numero(rango.numero_actual);
        const inicioViejo = numero(rango.rango_inicio);
        const entregado = actual >= inicioViejo;

        const inicio = datos.rango_inicio === undefined ? inicioViejo : numero(datos.rango_inicio);
        const fin = datos.rango_fin === undefined ? numero(rango.rango_fin) : numero(datos.rango_fin);
        const fechaAsignacion = datos.fechaAsignacion === undefined
            ? rango.fecha_asignacion
            : datos.fechaAsignacion;
        const observacion = datos.observacion === undefined ? rango.observacion : datos.observacion;

        if (entregado && inicio !== inicioViejo) {
            throw errorNegocio('RANGO_INICIO_BLOQUEADO', 409, {
                mensaje: MENSAJES.RANGO_INICIO_BLOQUEADO,
                numero_actual: actual, rango_inicio: inicioViejo
            });
        }
        if (fin < actual) {
            throw errorNegocio('RANGO_MAXIMO_BLOQUEADO', 409, {
                mensaje: MENSAJES.RANGO_MAXIMO_BLOQUEADO,
                numero_actual: actual
            });
        }

        await validarRango(client, {
            plantaKey: rango.planta_key,
            rango_inicio: inicio,
            rango_fin: fin,
            ignorarRangoId: rango.id,
            exigirActivo: false
        });

        const { rows } = await client.query(`
            UPDATE fg_correlativo_certificado_sede
            SET rango_inicio = $2,
                rango_fin = $3,
                fecha_asignacion = $4::timestamp,
                observacion = $5,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, planta_key, rango_inicio, rango_fin, numero_actual, cantidad,
                      disponibles, estado, fecha_asignacion, fecha_cierre, observacion
        `, [id, inicio, fin, fechaAsignacion, observacion]);

        await client.query('COMMIT');
        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw traducirErrorDeExclusion(error);
    } finally {
        client.release();
    }
};

/**
 * Cierra un rango como historial. `numero_actual` NO se toca: es consumo real, y
 * los números no entregados quedan inutilizados para siempre. Cerrar el rango
 * activo es lo que permite asignarle otro a la misma sede.
 */
exports.cerrarRango = async (id) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const rango = await obtenerRangoPorId(client, id);
        if (!rango) throw errorNegocio('RANGO_NO_ENCONTRADO', 404, { mensaje: 'El rango indicado no existe.' });
        if (rango.estado === 'CERRADO') {
            await client.query('COMMIT');
            return { mensaje: 'El rango ya se encontraba cerrado.', ...rango };
        }
        const { rows } = await client.query(`
            UPDATE fg_correlativo_certificado_sede
            SET estado = 'CERRADO',
                fecha_cierre = CURRENT_TIMESTAMP,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, planta_key, rango_inicio, rango_fin, numero_actual, cantidad,
                      disponibles, estado, fecha_asignacion, fecha_cierre, observacion
        `, [id]);
        await client.query('COMMIT');
        return { mensaje: 'Rango cerrado correctamente.', ...rows[0] };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Serializa todo lo que ocurre sobre una misma sede dentro de la transacción en
 * curso. Es la pieza que garantiza que dos emisiones simultáneas no obtengan el
 * mismo número.
 */
const bloquearSede = async (client, plantaKey) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`corr_sede|${plantaKey}`]);
};

/**
 * RESERVA EL NÚMERO DEFINITIVO. La única función de este servicio que consume.
 *
 * Secuencia:
 *  1. comprueba si la sede tiene inventario; si no tiene ninguno devuelve
 *     `migrada: false` para que la emisión decida (puente técnico);
 *  2. bloquea la sede (advisory lock transaccional);
 *  3. toma su rango ACTIVO con FOR UPDATE;
 *  4. calcula el siguiente;
 *  5. lo consume dentro de la misma transacción que emite, y marca AGOTADO si
 *     era el último.
 *
 * Si la sede tiene inventario pero no tiene rango activo —porque se agotó y
 * todavía no se le asignó otro— NO consume nada y bloquea la emisión.
 */
exports.consumirNumero = async (client, plantaKey) => {
    const total = (await client.query(
        'SELECT COUNT(*)::int n FROM fg_correlativo_certificado_sede WHERE planta_key = $1',
        [plantaKey])).rows[0].n;
    if (total === 0) return { migrada: false };

    await bloquearSede(client, plantaKey);

    for (let intento = 0; intento < INTENTOS_CONSUMO; intento += 1) {
        const { rows } = await client.query(`
            SELECT id, rango_inicio, numero_actual, rango_fin
            FROM fg_correlativo_certificado_sede
            WHERE planta_key = $1
              AND estado = 'ACTIVO'
              AND fecha_asignacion <= CURRENT_TIMESTAMP
              AND numero_actual < rango_fin
            ORDER BY fecha_asignacion ASC, rango_inicio ASC
            LIMIT 1
            FOR UPDATE
        `, [plantaKey]);
        if (rows.length === 0) break;

        const rango = rows[0];
        const siguiente = numero(rango.numero_actual) + 1;
        const agotado = siguiente >= numero(rango.rango_fin);
        await client.query(`
            UPDATE fg_correlativo_certificado_sede
            SET numero_actual = $2,
                estado = $3,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [rango.id, siguiente, agotado ? 'AGOTADO' : 'ACTIVO']);

        return {
            migrada: true,
            nro: siguiente,
            rangoId: rango.id,
            rangoInicio: numero(rango.rango_inicio),
            rangoFin: numero(rango.rango_fin),
            rangoAgotado: agotado
        };
    }

    throw errorNegocio('SEDE_SIN_CORRELATIVOS', 409, { mensaje: MENSAJES.SEDE_SIN_CORRELATIVOS });
};

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------

/** Anomalías del inventario. Sólo lectura. */
const auditar = async (queryable) => {
    const rangos = await listarRangos(queryable);
    const porSede = new Map();
    for (const rango of rangos) {
        if (!porSede.has(rango.planta_key)) porSede.set(rango.planta_key, []);
        porSede.get(rango.planta_key).push(rango);
    }

    const anomalias = [];
    const sinRango = [];
    for (const [plantaKey, filas] of porSede) {
        const activos = filas.filter((r) => r.estado === 'ACTIVO');
        if (activos.length === 0) sinRango.push({ planta_key: plantaKey, motivo: 'SIN_RANGO_ACTIVO' });
        // El índice parcial lo impide en la base; se comprueba igual.
        if (activos.length > 1) {
            anomalias.push({
                id: activos[0].id, planta_key: plantaKey,
                anomalia: 'MULTIPLES_RANGOS_ACTIVOS', detalle: activos.map((r) => r.id)
            });
        }
        for (const rango of filas) {
            if (rango.estado === 'ACTIVO' && rango.disponibles <= 0) {
                anomalias.push({ ...rango, anomalia: 'ACTIVO_SIN_NUMEROS' });
            }
            if (rango.cantidad > CANTIDAD_MAXIMA) {
                anomalias.push({ ...rango, anomalia: 'CANTIDAD_SUPERA_MAXIMO' });
            }
        }
    }

    return {
        resumen: {
            sedes: porSede.size,
            rangosTotales: rangos.length,
            rangosActivos: rangos.filter((r) => r.estado === 'ACTIVO').length,
            rangosAgotados: rangos.filter((r) => r.estado === 'AGOTADO').length,
            rangosCerrados: rangos.filter((r) => r.estado === 'CERRADO').length,
            rangosPendientes: rangos.filter((r) => r.estadoMostrado === 'PENDIENTE').length,
            anomalias: anomalias.length,
            sedesSinRangoActivo: sinRango.length,
            cantidadMaxima: CANTIDAD_MAXIMA
        },
        anomalias,
        sinRango
    };
};

/** Traduce la violación de la exclusividad global al mensaje de interfaz. */
const traducirErrorDeExclusion = (error) => {
    if (error && (error.code === '23P01' || error.constraint === 'excl_fg_corr_sede_rango')) {
        return errorNegocio('RANGO_SE_SOLAPA', 409, { mensaje: MENSAJES.RANGO_SE_SOLAPA });
    }
    if (error && error.code === '23505' && error.constraint === 'uk_fg_corr_sede_activo') {
        return errorNegocio('SEDE_YA_TIENE_RANGO_ACTIVO', 409, {
            mensaje: MENSAJES.SEDE_YA_TIENE_RANGO_ACTIVO
        });
    }
    if (error && error.code === '23505') {
        return errorNegocio('RANGO_DUPLICADO', 409, {
            mensaje: 'Ya existe un rango con esos mismos números.'
        });
    }
    return error;
};

exports.ESTADOS = ESTADOS;
exports.CANTIDAD_MAXIMA = CANTIDAD_MAXIMA;
exports.TAMANO_SUGERENCIA = TAMANO_SUGERENCIA;
exports.INTENTOS_CONSUMO = INTENTOS_CONSUMO;
exports.MENSAJES = MENSAJES;
exports.obtenerRangoPorId = obtenerRangoPorId;
exports.listarRangos = listarRangos;
exports.obtenerResumenPorSede = obtenerResumenPorSede;
exports.previsualizarProximo = previsualizarProximo;
exports.obtenerEmitidosPorSede = obtenerEmitidosPorSede;
exports.validarRango = validarRango;
exports.encontrarPrimerBloqueLibre = encontrarPrimerBloqueLibre;
exports.sugerirRango = sugerirRango;
exports.bloquearSede = bloquearSede;
exports.auditar = auditar;
exports.traducirErrorDeExclusion = traducirErrorDeExclusion;
exports._db = db;
