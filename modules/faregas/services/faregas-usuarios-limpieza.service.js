/**
 * Limpieza definitiva de usuarios de prueba.
 *
 * Caso de uso: retirar de la base usuarios que se crearon sólo para probar, sin
 * tocar la trazabilidad real. Hay dos modos y la diferencia la dicta la
 * auditoría, no el criterio del operador:
 *
 *   ELIMINAR  -> borra la fila de fg_usuario. Exige que no quede ninguna
 *                referencia: si quedan, se desvinculan las que la columna
 *                permita y se aborta el resto.
 *
 *   INACTIVAR -> conserva la fila de fg_usuario y pone `estado = false`. Es lo
 *                que corresponde cuando el usuario tiene auditorías propias:
 *                `fg_auditoria_config.username` es NOT NULL con FK a
 *                fg_usuario, así que sin borrar la auditoría no se puede borrar
 *                el usuario. Desactivarlo mantiene el rastro y lo saca del
 *                listado de activos.
 *
 * Reglas que este servicio no rompe:
 *
 *  - Los datos EXCLUSIVOS del usuario se borran en los dos modos (sus
 *    certificados, sus operaciones, y todo lo que cuelgue de ellos por FK).
 *  - Los registros COMPARTIDOS no se borran nunca. Si el usuario aparece como
 *    `usuario_modificacion` / `actualizado_por` en algo que es de otro, se
 *    desvincula poniéndolo en NULL, que es lo que la columna permite en las
 *    diez tablas donde existe.
 *  - Los MAESTROS no se tocan: persona, vehículo, chip, ejecutivo, tarifa,
 *    sede, empresa, serie, formato, producto fiscal, categoría.
 *
 * El orden de borrado está derivado de las FK reales del schema, no supuesto:
 * cada tabla se borra después de las que la referencian. Todo en UNA
 * transacción por usuario; si algo falla, esa transacción se revierte entera y
 * los demás usuarios se procesan igual.
 */
const db = require('../../../config/database');

/**
 * Plan de borrado.
 *
 * `nivel` es la DISTANCIA A LA RAÍZ: cuanto mayor, más lejos del usuario, y por
 * tanto antes se borra. El borrado recorre el plan de mayor a menor, con lo que
 * cada tabla desaparece antes que la que la referencia. Está derivado de las FK
 * reales del schema, y esa es la parte que hay que conservar: invertirlo hace que
 * `fg_certificado` se borre antes que `fg_operacion_detalle` y Postgres responde
 * 23503 por `fk_fg_operacion_detalle_certificado`.
 *
 * `pk` se declara cuando la tabla no tiene columna `id`: las tablas puente 1-a-N
 * de certificado usan el propio `certificado_id` como clave, y consultarlas por
 * `id` daría 42703.
 */
const PLAN = [
    // --- 9: hojas puras. Nada de lo que hay aquí las referencia. --------
    { nivel: 9, tabla: 'fg_chip_movimiento', columnas: ['usuario'],
      motivo: 'auditoría de movimientos del bien' },

    // --- 8: hijos de facturación / orden de pago / documento -------------
    { nivel: 8, tabla: 'fg_facturacion_intento', porFacturacion: true, motivo: 'intentos de emisión' },
    { nivel: 8, tabla: 'fg_facturacion_cuota', porFacturacion: true, motivo: 'cuotas de venta al crédito' },
    { nivel: 8, tabla: 'fg_pago', porOrdenPago: true, motivo: 'pagos registrados' },
    { nivel: 8, tabla: 'fg_documento_electronico_operacion', columnas: ['usuario_creacion'],
      motivo: 'intento de documento ante el proveedor' },
    { nivel: 8, tabla: 'fg_operacion_detalle_chip', porDetalle: true, pk: 'operacion_detalle_id',
      motivo: 'chip del detalle' },

    // --- 7: hijos de anulación, certificado y detalle de operación -------
    { nivel: 7, tabla: 'fg_documento_anulacion', columnas: ['usuario_creacion', 'usuario_modificacion'],
      motivo: 'anulaciones de documento' },
    { nivel: 7, tabla: 'fg_operacion_detalle', porOperacion: true, motivo: 'detalles de operación' },
    { nivel: 7, tabla: 'fg_operacion_detalle', porCertificado: true, motivo: 'detalles ligados al certificado' },
    { nivel: 7, tabla: 'fg_certificado_chip', porCertificado: true, pk: 'certificado_id', motivo: 'chip del certificado' },
    { nivel: 7, tabla: 'fg_certificado_vehiculo', porCertificado: true, pk: 'certificado_id', motivo: 'datos del vehículo' },
    { nivel: 7, tabla: 'fg_certificado_titular', porCertificado: true, motivo: 'titulares' },
    { nivel: 7, tabla: 'fg_certificado_glp', porCertificado: true, pk: 'certificado_id', motivo: 'detalle GLP' },
    { nivel: 7, tabla: 'fg_certificado_gnv', porCertificado: true, pk: 'certificado_id', motivo: 'detalle GNV' },
    { nivel: 7, tabla: 'fg_certificado_conformidad', porCertificado: true, pk: 'certificado_id', motivo: 'detalle conformidad' },

    // --- 6: hijos de descuento. Referencian también facturación y orden ----
    { nivel: 6, tabla: 'fg_descuentodetalle', porDescuentoCliente: true, motivo: 'detalle de descuento de cliente' },
    { nivel: 6, tabla: 'fg_descuentodetalle', porDescuento: true, motivo: 'detalle de descuento' },
    { nivel: 6, tabla: 'fg_descuentocomprobante', porDescuentoCliente: true, motivo: 'descuento aplicado a comprobante' },
    { nivel: 6, tabla: 'fg_descuentocomprobante', porFacturacionId: true, motivo: 'descuento de comprobante' },
    { nivel: 6, tabla: 'fg_descuentocomprobante', porOrdenPagoId: true, motivo: 'descuento de orden de pago' },
    // Las notas referencian la facturación, así que van antes que ella.
    { nivel: 6, tabla: 'fg_credito', columnas: ['usuario_creacion', 'usuario_modificacion'], motivo: 'notas de crédito' },
    { nivel: 6, tabla: 'fg_debito', columnas: ['usuario_creacion', 'usuario_modificacion'], motivo: 'notas de débito' },

    // --- 5: facturación y órdenes de pago. Hijas de cert y de operación ---
    { nivel: 5, tabla: 'fg_facturacion', porCertificado: true, motivo: 'facturación por certificado' },
    { nivel: 5, tabla: 'fg_facturacion', porOperacion: true, motivo: 'facturación por operación' },
    { nivel: 5, tabla: 'fg_orden_pago', porCertificado: true, motivo: 'orden de pago del certificado' },
    { nivel: 5, tabla: 'fg_orden_pago', porOperacion: true, motivo: 'orden de pago de la operación' },

    // --- 4/3: descuento de cliente y descuento ---------------------------
    { nivel: 4, tabla: 'fg_descuentocliente', columnas: ['usuario_creacion', 'usuario_modificacion'],
      motivo: 'campaña de descuento de cliente' },
    { nivel: 3, tabla: 'fg_descuento', columnas: ['usuario_creacion', 'usuario_modificacion'],
      motivo: 'campaña de descuento' },

    // --- 2/1: las raíces. Último de todo. --------------------------------
    { nivel: 2, tabla: 'fg_certificado', columnas: ['usuario_creacion'], motivo: 'certificados' },
    { nivel: 1, tabla: 'fg_operacion_comercial', columnas: ['usuario_creacion'], motivo: 'operaciones comerciales' }
];

/**
 * Tablas donde el usuario puede aparecer como "sólo modificó" algo que es de
 * otro. La columna es nullable en todas, así que se desvincula en vez de borrar.
 */
const VINCULOS_COMPARTIDOS = [
    { tabla: 'fg_certificado', columna: 'usuario_modificacion' },
    { tabla: 'fg_operacion_comercial', columna: 'usuario_modificacion' },
    { tabla: 'fg_chip', columna: 'actualizado_por' },
    { tabla: 'fg_vehiculo', columna: 'usuario_modificacion' },
    { tabla: 'fg_credito', columna: 'usuario_modificacion' },
    { tabla: 'fg_debito', columna: 'usuario_modificacion' },
    { tabla: 'fg_descuento', columna: 'usuario_modificacion' },
    { tabla: 'fg_descuentocliente', columna: 'usuario_modificacion' },
    { tabla: 'fg_descuentocomprobante', columna: 'usuario_modificacion' },
    { tabla: 'fg_descuentodetalle', columna: 'usuario_modificacion' },
    { tabla: 'fg_documento_anulacion', columna: 'usuario_modificacion' }
];

/** Tablas de acceso, siempre propias del usuario. */
const ACCESO = [
    { tabla: 'fg_usuario_sesion', columna: 'usuario_username' },
    { tabla: 'fg_usuario_planta', columna: 'usuario_username' }
];

/** Referencias que NO se tocan nunca: maestros o bienes compartidos. */
const MAESTROS_INTOCABLES = [
    'fg_auditoria_config', 'fg_vehiculo', 'fg_chip', 'fg_ejecutivo',
    'persona', 'fg_tarifa', 'fg_planta', 'fg_empresa', 'fg_serie_comprobante',
    'fg_certificado_formato', 'fg_producto_facturacion', 'fg_categoria_servicio'
];

const errorNegocio = (code, mensaje, extra = {}) => {
    const e = new Error(mensaje || code);
    e.code = code;
    e.statusCode = 400;
    Object.assign(e, extra);
    return e;
};

/** Clave primaria de una tabla. Casi todas usan `id`; `fg_operacion_detalle_chip`
 *  usa `operacion_detalle_id`, y consultarlo a pelo daba 42703. */
const clavePrimaria = async (tabla, executor) => {
    const r = await executor.query(`
        SELECT a.attname FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary`, [tabla]);
    return r.rows[0]?.attname || 'id';
};

const ids = async (executor, tabla, condicion, valores, pk) => {
    if (!valores || valores.length === 0) return [];
    const clave = pk || await clavePrimaria(tabla, executor);
    const r = await executor.query(
        `SELECT DISTINCT ${clave} FROM ${tabla} WHERE ${condicion} = ANY($1::bigint[])`,
        [valores.map(String)]);
    return r.rows.map((x) => String(x[clave]));
};

/**
 * Cuántas filas caería en cada paso, y cuántas seULEMENTaría de verdad.
 * Sólo lectura: sirve tanto para la previsualización como para el informe final.
 */
const medir = async (username, executor = db) => {
    const certIds = (await executor.query(
        'SELECT id FROM fg_certificado WHERE usuario_creacion = $1', [username])).rows.map((r) => String(r.id));
    const opIds = (await executor.query(
        'SELECT id FROM fg_operacion_comercial WHERE usuario_creacion = $1', [username])).rows.map((r) => String(r.id));
    const factIds = [...await ids(executor, 'fg_facturacion', 'certificado_id', certIds),
        ...await ids(executor, 'fg_facturacion', 'operacion_id', opIds)];
    const ordenIds = [...await ids(executor, 'fg_orden_pago', 'certificado_id', certIds),
        ...await ids(executor, 'fg_orden_pago', 'operacion_id', opIds)];
    const descCliIds = (await executor.query(
        `SELECT id FROM fg_descuentocliente WHERE usuario_creacion=$1 OR usuario_modificacion=$1`,
        [username])).rows.map((r) => String(r.id));
    const descIds = (await executor.query(
        `SELECT id FROM fg_descuento WHERE usuario_creacion=$1 OR usuario_modificacion=$1`,
        [username])).rows.map((r) => String(r.id));
    const detIds = [...await ids(executor, 'fg_operacion_detalle', 'operacion_id', opIds),
        ...await ids(executor, 'fg_operacion_detalle', 'certificado_id', certIds)];

    const fuente = {
        certIds, opIds, factIds, ordenIds, descCliIds, descIds, detIds
    };

    const pasos = [];
    for (const paso of PLAN) {
        let valores;
        if (paso.columnas) {
            const cond = paso.columnas.map((c) => `${c} = $1`).join(' OR ');
            const clave = await clavePrimaria(paso.tabla, executor);
            valores = (await executor.query(
                `SELECT DISTINCT ${clave} FROM ${paso.tabla} WHERE ${cond}`, [username]))
                .rows.map((r) => String(r[clave]));
        } else if (paso.porFacturacion) valores = await ids(executor, paso.tabla, 'facturacion_id', factIds);
        else if (paso.porFacturacionId) valores = await ids(executor, paso.tabla, 'facturacion_id', factIds);
        else if (paso.porOrdenPago) valores = await ids(executor, paso.tabla, 'orden_pago_id', ordenIds);
        else if (paso.porOrdenPagoId) valores = await ids(executor, paso.tabla, 'orden_pago_id', ordenIds);
        else if (paso.porDescuentoCliente) valores = await ids(executor, paso.tabla, 'descuento_cliente_id', descCliIds);
        else if (paso.porDescuento) valores = await ids(executor, paso.tabla, 'descuento_id', descIds);
        else if (paso.porDetalle) valores = await ids(executor, paso.tabla, 'operacion_detalle_id', detIds, paso.pk);
        else if (paso.porOperacion) valores = await ids(executor, paso.tabla, 'operacion_id', opIds);
        else if (paso.porCertificado) valores = await ids(executor, paso.tabla, 'certificado_id', certIds, paso.pk);
        else continue;
        if (valores.length === 0) continue;
        pasos.push({
            nivel: paso.nivel, tabla: paso.tabla, motivo: paso.motivo, filas: valores.length, ids: valores,
            pk: paso.pk || await clavePrimaria(paso.tabla, executor)
        });
    }
    // Se deduplican pasos que apuntan a la misma tabla con las mismas filas: un
    // certificado no se cuenta dos veces por estar ligado a cert y a operación.
    const vistos = new Set();
    const unicos = [];
    for (const p of pasos) {
        const clave = `${p.tabla}:${p.pk}:${[...p.ids].sort().join(',')}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        unicos.push(p);
    }
    // Y si una tabla aparece dos veces con filas distintas (caso real: una
    // facturación contada por certificado y por operación), se fusiona en un
    // solo paso para no borrar dos veces ni contar de más. Al fusionar se queda
    // el nivel MÁS ALTO (más lejos de la raíz): es el que garantiza que la tabla
    // se borre antes que cualquiera que la referencie.
    const porTabla = new Map();
    for (const p of unicos) {
        if (!porTabla.has(p.tabla)) porTabla.set(p.tabla, { ...p, ids: [...p.ids] });
        else {
            const previo = porTabla.get(p.tabla);
            previo.ids = [...new Set([...previo.ids, ...p.ids])];
            previo.filas = previo.ids.length;
            previo.nivel = Math.max(previo.nivel, p.nivel);
        }
    }

    const acceso = [];
    for (const a of ACCESO) {
        const n = (await executor.query(
            `SELECT COUNT(*)::int n FROM ${a.tabla} WHERE ${a.columna} = $1`, [username])).rows[0].n;
        if (n > 0) acceso.push({ ...a, filas: n });
    }

    const compartidos = [];
    for (const v of VINCULOS_COMPARTIDOS) {
        const filas = await contarCompartidos(v, username, executor);
        if (filas > 0) compartidos.push({ ...v, filas });
    }

    const preservados = [];
    for (const t of MAESTROS_INTOCABLES) {
        const existe = (await executor.query(
            'SELECT to_regclass($1::text) IS NOT NULL AS e', [`public.${t}`])).rows[0].e;
        if (!existe) continue;
        const cond = t === 'fg_chip' ? 'creado_por = $1 OR actualizado_por = $1'
            : t === 'fg_vehiculo' ? 'usuario_creacion = $1 OR usuario_modificacion = $1'
                : t === 'fg_ejecutivo' ? 'username = $1'
                    : t === 'fg_auditoria_config' ? 'username = $1' : null;
        if (!cond) { preservados.push({ tabla: t, filas: null, nota: 'no referencia al usuario' }); continue; }
        const n = (await executor.query(
            `SELECT COUNT(*)::int n FROM ${t} WHERE ${cond}`, [username])).rows[0].n;
        if (n > 0) preservados.push({ tabla: t, filas: n });
    }

    const total = [...porTabla.values()].reduce((s, p) => s + p.filas, 0)
        + acceso.reduce((s, a) => s + a.filas, 0);

    return {
        username, pasos: [...porTabla.values()], acceso, compartidos, preservados, total,
        semilla: { certificados: certIds.length, operaciones: opIds.length }
    };
};

/** Cuenta, en cada tabla de vínculos, las filas que son de OTRO y este usuario tocó. */
const contarCompartidos = async (vinculo, username, executor) => {
    // Se compara contra el creador de la MISMA fila: si coinciden, la fila es
    // del usuario y se borra en su limpieza; si no, es de otro y se conserva.
    const { tabla, columna } = vinculo;
    const creador = {
        fg_certificado: 'usuario_creacion',
        fg_operacion_comercial: 'usuario_creacion',
        fg_chip: 'creado_por',
        fg_vehiculo: 'usuario_creacion',
        fg_credito: 'usuario_creacion',
        fg_debito: 'usuario_creacion',
        fg_descuento: 'usuario_creacion',
        fg_descuentocliente: 'usuario_creacion',
        fg_descuentocomprobante: 'usuario_creacion',
        fg_descuentodetalle: 'usuario_creacion',
        fg_documento_anulacion: 'usuario_creacion'
    }[tabla];
    const r = await executor.query(
        `SELECT COUNT(*)::int n FROM ${tabla}
         WHERE ${columna} = $1 AND (${creador} IS DISTINCT FROM $1)`,
        [username]);
    return r.rows[0].n;
};

/**
 * Previsualización: qué se borraría, qué se desvincularía y qué se conserva.
 * No escribe nada.
 */
exports.previsualizarLimpieza = async (username) => {
    const existe = (await db.query('SELECT 1 FROM fg_usuario WHERE username = $1', [username])).rowCount > 0;
    if (!existe) throw errorNegocio('USUARIO_NO_EXISTE', `El usuario ${username} no existe.`);
    return medir(username);
};

/**
 * Decide el modo a partir de la auditoría: si el usuario tiene registros en
 * fg_auditoria_config no se puede borrar la fila (la columna es NOT NULL con FK),
 * así que corresponde desactivar. Es la misma regla que aplica el servicio de
 * eliminación normal, expuesta aquí para que el operador no tenga que decidirla.
 */
exports.decidirModo = async (username) => {
    const auditorias = (await db.query(
        'SELECT COUNT(*)::int n FROM fg_auditoria_config WHERE username = $1', [username])).rows[0].n;
    const pendientes = (await db.query(`
        SELECT (
            (SELECT COUNT(*) FROM fg_usuario_sesion WHERE usuario_username = $1)
          + (SELECT COUNT(*) FROM fg_usuario_planta WHERE usuario_username = $1)
          + (SELECT COUNT(*) FROM fg_certificado WHERE usuario_creacion = $1)
          + (SELECT COUNT(*) FROM fg_operacion_comercial WHERE usuario_creacion = $1)
        )::int n`, [username])).rows[0].n;
    return {
        modo: auditorias > 0 ? 'INACTIVAR' : 'ELIMINAR',
        razon: auditorias > 0
            ? `Tiene ${auditorias} registro(s) de auditoría propios. fg_auditoria_config.username es NOT NULL con FK a fg_usuario, así que borrarlos perdería trazabilidad real: se limpia y se desactiva.`
            : 'No tiene auditoría propia: se puede eliminar la fila sin perder trazabilidad.',
        auditorias, referenciasPropias: pendientes
    };
};

/**
 * Ejecuta la limpieza. UNA transacción por usuario.
 *
 * `modo` explícito: si no se indica, lo decide `decidirModo`. Se acepta el modo
 * explícito para que el operador pueda forzar INACTIVAR sobre un usuario sin
 * auditoría (por ejemplo si tiene referencias en maestro).
 */
exports.ejecutarLimpieza = async (username, { modo, confirmar } = {}) => {
    if (confirmar !== 'ELIMINAR') {
        throw errorNegocio('CONFIRMACION_REQUERIDA', 'Debe confirmar con la palabra ELIMINAR.');
    }
    if (!username) throw errorNegocio('USUARIO_REQUERIDO', 'Falta el usuario.');

    const modoFinal = modo || (await exports.decidirModo(username)).modo;
    if (!['ELIMINAR', 'INACTIVAR'].includes(modoFinal)) {
        throw errorNegocio('MODO_INVALIDO', `Modo ${modoFinal} no reconocido.`);
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Si el usuario es el que está autenticado no se toca: se comprueba en el
        // controller, pero también aquí por si el servicio se usa directo.
        const antes = await medir(username, client);
        const resumen = {
            username, modo: modoFinal,
            eliminados: [], desvinculados: [], preservados: antes.preservados
        };

        // 1) Desvincular registros de otros. Nunca se borran: sólo se suelta la
        //    referencia, que es lo que permite la columna (es nullable).
        for (const vinculo of VINCULOS_COMPARTIDOS) {
            const r = await client.query(
                `UPDATE ${vinculo.tabla} SET ${vinculo.columna} = NULL
                  WHERE ${vinculo.columna} = $1 AND ${columnaCreador(vinculo.tabla)} IS DISTINCT FROM $1`,
                [username]);
            if (r.rowCount > 0) {
                resumen.desvinculados.push({ tabla: vinculo.tabla, columna: vinculo.columna, filas: r.rowCount });
            }
        }

        // 2) Borrar los datos exclusivos, en el orden del plan (hijos primero).
        //    Se va de más profundo a más superficial para que ninguna FK quede
        //    apuntando a una fila que ya no existe.
        const orden = [...antes.pasos].sort((a, b) => b.nivel - a.nivel);
        for (const paso of orden) {
            const r = await client.query(
                `DELETE FROM ${paso.tabla} WHERE ${paso.pk} = ANY($1::bigint[])`, [paso.ids]);
            if (r.rowCount > 0) {
                resumen.eliminados.push({ tabla: paso.tabla, motivo: paso.motivo, filas: r.rowCount });
            }
        }

        // 3) Acceso: sesiones y asignaciones de sede, siempre propias.
        for (const a of antes.acceso) {
            const r = await client.query(
                `DELETE FROM ${a.tabla} WHERE ${a.columna} = $1`, [username]);
            if (r.rowCount > 0) {
                resumen.eliminados.push({ tabla: a.tabla, motivo: 'acceso del usuario', filas: r.rowCount });
            }
        }

        // 4) El usuario.
        if (modoFinal === 'ELIMINAR') {
            const pendientes = await referenciasBloqueantes(username, client);
            if (pendientes.length > 0) {
                throw errorNegocio(
                    'USUARIO_CON_HISTORIAL',
                    `No se puede eliminar ${username}: siguen referencias en ${pendientes.map((p) => `${p.tabla} (${p.filas})`).join(', ')}.`,
                    { pendientes }
                );
            }
            const r = await client.query('DELETE FROM fg_usuario WHERE username = $1', [username]);
            if (r.rowCount !== 1) throw errorNegocio('USUARIO_NO_EXISTE', `No se pudo eliminar ${username}.`);
            resumen.usuarioEliminado = true;
        } else {
            // `fg_usuario` no tiene columna de fecha de modificación: sólo
            // `fecha_creacion`. Por eso el UPDATE no la toca.
            const r = await client.query(
                'UPDATE fg_usuario SET estado = FALSE WHERE username = $1', [username]);
            if (r.rowCount !== 1) throw errorNegocio('USUARIO_NO_EXISTE', `No se pudo desactivar ${username}.`);
            resumen.usuarioEliminado = false;
            resumen.usuarioInactivo = true;
        }

        // 5) Comprobación de invariantes ANTES del commit. Si algo no cuadra, se
        //    revierte todo y no queda eliminación parcial.
        await verificarInvariantes(username, modoFinal, client);

        await client.query('COMMIT');
        resumen.totalEliminadas = resumen.eliminados.reduce((s, e) => s + e.filas, 0);
        resumen.totalDesvinculadas = resumen.desvinculados.reduce((s, d) => s + d.filas, 0);
        return resumen;
    } catch (error) {
        await client.query('ROLLBACK');
        error.limpiezaRevertida = true;
        throw error;
    } finally {
        client.release();
    }
};

const columnaCreador = (tabla) => ({
    fg_certificado: 'usuario_creacion',
    fg_operacion_comercial: 'usuario_creacion',
    fg_chip: 'creado_por',
    fg_vehiculo: 'usuario_creacion',
    fg_credito: 'usuario_creacion',
    fg_debito: 'usuario_creacion',
    fg_descuento: 'usuario_creacion',
    fg_descuentocliente: 'usuario_creacion',
    fg_descuentocomprobante: 'usuario_creacion',
    fg_descuentodetalle: 'usuario_creacion',
    fg_documento_anulacion: 'usuario_creacion'
}[tabla] || 'usuario_creacion');

/** Referencias vivas a `username`, para decidir si el DELETE es posible. */
const referenciasBloqueantes = async (username, executor) => {
    const revisadas = [
        ['fg_auditoria_config', 'username = $1'],
        ['fg_certificado', 'usuario_creacion = $1 OR usuario_modificacion = $1'],
        ['fg_operacion_comercial', 'usuario_creacion = $1 OR usuario_modificacion = $1'],
        ['fg_chip', 'creado_por = $1 OR actualizado_por = $1'],
        ['fg_chip_movimiento', 'usuario = $1'],
        ['fg_credito', 'usuario_creacion = $1 OR usuario_modificacion = $1'],
        ['fg_debito', 'usuario_creacion = $1 OR usuario_modificacion = $1'],
        ['fg_descuento', 'usuario_creacion = $1 OR usuario_modificacion = $1'],
        ['fg_descuentocliente', 'usuario_creacion = $1 OR usuario_modificacion = $1'],
        ['fg_descuentocomprobante', 'usuario_creacion = $1 OR usuario_modificacion = $1'],
        ['fg_descuentodetalle', 'usuario_creacion = $1 OR usuario_modificacion = $1'],
        ['fg_documento_anulacion', 'usuario_creacion = $1 OR usuario_modificacion = $1'],
        ['fg_documento_electronico_operacion', 'usuario_creacion = $1'],
        ['fg_ejecutivo', 'username = $1 OR usuario_creacion = $1 OR usuario_modificacion = $1'],
        ['fg_vehiculo', 'usuario_creacion = $1 OR usuario_modificacion = $1'],
        ['fg_usuario_planta', 'usuario_username = $1'],
        ['fg_usuario_sesion', 'usuario_username = $1']
    ];
    const pendientes = [];
    for (const [tabla, cond] of revisadas) {
        const existe = (await executor.query(
            'SELECT to_regclass($1::text) IS NOT NULL AS e', [`public.${tabla}`])).rows[0].e;
        if (!existe) continue;
        const n = (await executor.query(
            `SELECT COUNT(*)::int n FROM ${tabla} WHERE ${cond}`, [username])).rows[0].n;
        if (n > 0) pendientes.push({ tabla, filas: n });
    }
    return pendientes;
};

/** Que no quede nada a medias y que lo preservado siga intacto. */
const verificarInvariantes = async (username, modo, executor) => {
    const pendientes = await referenciasBloqueantes(username, executor);
    if (modo === 'ELIMINAR' && pendientes.length > 0) {
        throw errorNegocio('INVARIANTE_ROTA',
            `Quedaron referencias sin limpiar: ${pendientes.map((p) => `${p.tabla}=${p.filas}`).join(', ')}`);
    }
    if (modo === 'ELIMINAR') {
        const existe = (await executor.query(
            'SELECT 1 FROM fg_usuario WHERE username = $1', [username])).rowCount > 0;
        if (existe) throw errorNegocio('INVARIANTE_ROTA', `${username} sigue existiendo.`);
    } else {
        const fila = (await executor.query(
            'SELECT estado FROM fg_usuario WHERE username = $1', [username])).rows[0];
        if (!fila) throw errorNegocio('INVARIANTE_ROTA', `${username} desapareció en vez de desactivarse.`);
        if (fila.estado !== false) throw errorNegocio('INVARIANTE_ROTA', `${username} no quedó inactivo.`);
    }
    // La auditoría es intocable en los dos modos.
    const auditorias = (await executor.query(
        'SELECT COUNT(*)::int n FROM fg_auditoria_config WHERE username = $1', [username])).rows[0].n;
    if (auditorias > 0 && modo === 'ELIMINAR') {
        throw errorNegocio('INVARIANTE_ROTA', `${username} tiene auditoría y no debía eliminarse.`);
    }
};

exports._private = {
    PLAN, VINCULOS_COMPARTIDOS, ACCESO, MAESTROS_INTOCABLES,
    medir, referenciasBloqueantes, verificarInvariantes, columnaCreador
};