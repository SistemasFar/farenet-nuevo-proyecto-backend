const db = require('../../../config/database');
const auditoria = require('./faregas-auditoria.service');
const {
    FAREGAS_PERMISO_ADMINISTRAR_PERFILES,
    PERMISOS_SENSIBLES,
    PERMISOS_SENSIBLES_SET,
    PERMISOS_OBSOLETOS_SET,
    PERMISOS_FAREGAS_GESTIONABLES
} = require('./faregas-permisos-sensibles.constants');

const errorNegocio = (code, statusCode, message, detalles) => {
    const error = new Error(message || code);
    error.code = code;
    error.statusCode = statusCode;
    if (detalles !== undefined) error.detalles = detalles;
    return error;
};

const normalizarLista = (valor, campo) => {
    if (valor === undefined) return undefined;
    if (!Array.isArray(valor)) {
        throw errorNegocio('PERMISOS_INVALIDOS', 400, `${campo} debe ser una lista de claves.`);
    }
    return [...new Set(valor
        .map((clave) => String(clave ?? '').trim())
        .filter(Boolean))];
};

const quitarObsoletos = (lista) => {
    if (lista === undefined) return undefined;
    return lista.filter((clave) => !PERMISOS_OBSOLETOS_SET.has(clave));
};

const extraerSensibles = (lista) => {
    if (!Array.isArray(lista)) return [];
    return lista.filter((clave) => PERMISOS_SENSIBLES_SET.has(clave));
};

const usernameDeActor = (actor) => {
    const username = typeof actor === 'string' ? actor : actor?.username;
    return String(username || '').trim();
};

const recortar = (valor, maximo) => {
    if (valor === undefined || valor === null) return null;
    return String(valor).trim().substring(0, maximo) || null;
};

/**
 * Permisos efectivos de un perfil. Se consulta la base de datos en cada
 * operación: la autorización nunca se decide con lo que diga el token, la
 * sesión o el nombre del perfil.
 */
const cargarPermisosEfectivos = async (executor, perfilClave) => {
    const result = await executor.query(`
        SELECT pp.permiso_clave
        FROM fg_perfil_permiso pp
        JOIN fg_permiso p ON p.clave = pp.permiso_clave AND p.activo = TRUE
        WHERE pp.perfil_clave = $1
    `, [perfilClave]);
    return new Set(result.rows.map((row) => row.permiso_clave));
};

const cargarActorAutorizado = async (executor, actor) => {
    const username = usernameDeActor(actor);
    if (!username) {
        throw errorNegocio('ACTOR_NO_AUTORIZADO', 403, 'No se pudo identificar al usuario que administra los permisos.');
    }

    const result = await executor.query(`
        SELECT username, perfil_id, estado
        FROM fg_usuario
        WHERE username = $1
        LIMIT 1
    `, [username]);
    if (result.rowCount === 0 || !result.rows[0]) {
        throw errorNegocio('ACTOR_NO_AUTORIZADO', 403, 'El usuario administrador no existe.');
    }

    const fila = result.rows[0];
    if (fila.estado !== true) {
        throw errorNegocio('ACTOR_NO_AUTORIZADO', 403, 'El usuario administrador está inactivo.');
    }

    return {
        username: fila.username,
        perfil_id: fila.perfil_id,
        permisos: await cargarPermisosEfectivos(executor, fila.perfil_id)
    };
};

const registrarDenegacion = async ({
    auditoriaService,
    actor,
    perfilClave,
    otorgados,
    revocados,
    codigo,
    mensaje,
    contexto
}) => {
    if (!auditoriaService || typeof auditoriaService.registrarEvento !== 'function') return;
    await auditoriaService.registrarEvento({
        username: usernameDeActor(actor) || null,
        evento: 'PERMISOS_SENSIBLES_DENEGADO',
        exitoso: false,
        mensaje: mensaje || codigo,
        planta_key: contexto?.planta_key || null,
        ip_direccion: contexto?.ip_direccion || null,
        user_agent: contexto?.user_agent || null,
        perfil: contexto?.perfil || null,
        categoria: 'USUARIOS',
        entidad: 'fg_perfil_permiso',
        datos: {
            perfil: perfilClave,
            otorgados,
            revocados,
            resultado: 'DENEGADO',
            codigo
        }
    });
};

/**
 * Autorización única para crear o editar perfiles: el actor debe tener el
 * permiso MENU_USUARIOS, el mismo que protege la ruta de Usuarios. Se consulta
 * la base de datos dentro de la transacción y nunca se decide por el nombre del
 * perfil ni por lo que diga el token.
 */
exports.verificarAutorizacionPerfiles = async ({
    executor = db,
    actor,
    contexto = {},
    perfilClave = null,
    auditoriaService = auditoria
} = {}) => {
    let cargado;
    try {
        cargado = await cargarActorAutorizado(executor, actor);
    } catch (error) {
        await registrarDenegacion({
            auditoriaService,
            actor,
            perfilClave,
            otorgados: [],
            revocados: [],
            codigo: error.code,
            mensaje: error.message,
            contexto
        });
        throw error;
    }

    if (!cargado.permisos.has(FAREGAS_PERMISO_ADMINISTRAR_PERFILES)) {
        const error = errorNegocio(
            'PERFILES_NO_AUTORIZADO',
            403,
            'No tiene permiso para administrar perfiles (MENU_USUARIOS).'
        );
        await registrarDenegacion({
            auditoriaService,
            actor: cargado,
            perfilClave,
            otorgados: [],
            revocados: [],
            codigo: error.code,
            mensaje: error.message,
            contexto
        });
        throw error;
    }

    return cargado;
};

/**
 * Valida que las claves enviadas por el editor de perfiles existan, estén
 * activas y pertenezcan al catálogo administrable (módulos MENU + permisos
 * FAREGAS explícitamente gestionables).
 */
exports.validarPermisosGestionables = async ({
    executor = db,
    permisos,
    permisosSensibles,
    perfilClave = null
} = {}) => {
    const permisosNormalizados = normalizarLista(permisos, 'permisos');
    const sensiblesNormalizados = normalizarLista(permisosSensibles, 'permisosSensibles');
    const permisosVigentes = quitarObsoletos(permisosNormalizados);
    const sensiblesVigentes = quitarObsoletos(sensiblesNormalizados);

    // Si el cliente sólo envió la clave obsoleta, se trata como una lista no
    // enviada: se conserva lo persistido en lugar de borrar todos los permisos.
    // Una lista vacía explícita sí significa "dejar el perfil sin permisos".
    const listaPermisos = permisosNormalizados?.length > 0 && permisosVigentes.length === 0
        ? undefined
        : permisosVigentes;
    const listaSensibles = sensiblesNormalizados?.length > 0 && sensiblesVigentes.length === 0
        ? undefined
        : sensiblesVigentes;

    const solicitados = [...new Set([
        ...(listaPermisos || []),
        ...(listaSensibles || [])
    ])];
    if (solicitados.length === 0) {
        return {
            permisos: listaPermisos,
            permisosSensibles: listaSensibles,
            permisosGestionables: listaPermisos
        };
    }

    // Primero se comprueba que todas las claves existan y estén activas. Así el
    // error distingue una clave inexistente/inactiva de una clave válida que no
    // pertenece al catálogo que administra este editor.
    const catalogoResult = await executor.query(`
        SELECT clave, activo
        FROM fg_permiso
        WHERE clave = ANY($1::varchar[])
    `, [solicitados]);
    const filasCatalogo = new Map(
        catalogoResult.rows.map((row) => [row.clave, row])
    );
    const noDisponibles = solicitados.filter((clave) => {
        const fila = filasCatalogo.get(clave);
        return !fila || fila.activo !== true;
    });
    if (noDisponibles.length > 0) {
        throw errorNegocio(
            'PERMISOS_NO_DISPONIBLES',
            400,
            'Uno o más permisos no están registrados o no están activos.',
            { claves: noDisponibles }
        );
    }

    // Catálogo autorizado del editor: módulos de menú + permisos FAREGAS que el
    // editor administra explícitamente. Debe coincidir con `obtenerPermisos`.
    const gestionablesResult = await executor.query(`
        SELECT clave
        FROM fg_permiso
        WHERE activo = TRUE
          AND (
              modulo = 'MENU'
              OR clave = ANY($1::varchar[])
          )
    `, [PERMISOS_FAREGAS_GESTIONABLES]);
    const permitidas = new Set(
        gestionablesResult.rows.map((row) => row.clave)
    );

    // El editor envía la lista completa del perfil. Puede incluir permisos
    // históricos u operativos que este editor no muestra ni administra. Si ya
    // estaban asignados, se toleran para conservarlos; nunca se usan para
    // conceder una clave nueva fuera del catálogo autorizado.
    const existentes = new Set();
    if (perfilClave) {
        const existentesResult = await executor.query(`
            SELECT permiso_clave
            FROM fg_perfil_permiso
            WHERE perfil_clave = $1
              AND permiso_clave = ANY($2::varchar[])
        `, [perfilClave, solicitados]);
        for (const row of existentesResult.rows) {
            existentes.add(row.permiso_clave);
        }
    }

    const noGestionables = solicitados.filter(
        (clave) => !permitidas.has(clave) && !existentes.has(clave)
    );
    if (noGestionables.length > 0) {
        throw errorNegocio(
            'PERMISOS_NO_GESTIONABLES',
            400,
            'Uno o más permisos válidos no se administran desde el editor de perfiles.',
            { claves: noGestionables }
        );
    }

    if (listaSensibles) {
        const noSensibles = listaSensibles.filter((clave) => !PERMISOS_SENSIBLES_SET.has(clave));
        if (noSensibles.length > 0) {
            throw errorNegocio(
                'PERMISOS_SENSIBLES_INVALIDOS',
                400,
                'La lista de permisos sensibles contiene claves que no son sensibles.',
                { claves: noSensibles }
            );
        }
    }

    // La lista completa (`permisos`) es la fuente de verdad del editor. Si el
    // cliente además envía `permisosSensibles`, se une para no descartar nunca
    // una clave sensible enviada explícitamente.
    const sensiblesEfectivos = listaSensibles === undefined
        ? (listaPermisos === undefined ? undefined : extraerSensibles(listaPermisos))
        : [...new Set([...listaSensibles, ...extraerSensibles(listaPermisos || [])])];

    // Sólo estas claves se escriben. Las que ya existían fuera del catálogo se
    // dejan intactas; no se borran ni se vuelven a insertar.
    const permisosGestionables = listaPermisos === undefined
        ? undefined
        : listaPermisos.filter((clave) => permitidas.has(clave));

    return {
        permisos: listaPermisos,
        permisosSensibles: sensiblesEfectivos,
        permisosGestionables
    };
};

/**
 * Aplica el diff de permisos sensibles de un perfil dentro de la transacción
 * que ya abrió el servicio de usuarios. El llamador debe haber bloqueado la
 * fila de `fg_perfil` con FOR UPDATE (actualización) o estar dentro de la misma
 * transacción que acaba de crear el perfil.
 *
 * Contrato:
 *   - `permisosSensibles === undefined`: no se toca ningún permiso sensible. Es
 *     lo que permite editar otros campos del perfil sin borrar privilegios
 *     existentes.
 *   - `permisosSensibles` presente: se compara contra lo persistido y se
 *     conceden/revocan exactamente las claves indicadas.
 *   - La autorización es MENU_USUARIOS, el permiso que ya controla la
 *     administración de perfiles. No existe una autorización sensible adicional.
 */
exports.aplicarPermisosSensibles = async ({
    executor = db,
    perfilClave,
    permisosSensibles,
    actor,
    actorAutorizado = null,
    contexto = {},
    auditoriaService = auditoria
} = {}) => {
    const perfil = recortar(perfilClave, 100);
    if (!perfil) throw errorNegocio('PERFIL_INVALIDO', 400, 'El perfil es obligatorio.');

    const solicitados = normalizarLista(permisosSensibles, 'permisosSensibles');

    const actualesResult = await executor.query(`
        SELECT pp.permiso_clave
        FROM fg_perfil_permiso pp
        JOIN fg_permiso p ON p.clave = pp.permiso_clave AND p.activo = TRUE
        WHERE pp.perfil_clave = $1
          AND pp.permiso_clave = ANY($2::varchar[])
    `, [perfil, PERMISOS_SENSIBLES]);
    const actuales = actualesResult.rows.map((row) => row.permiso_clave);
    const actualesSet = new Set(actuales);

    if (solicitados === undefined) {
        return {
            perfil,
            otorgados: [],
            revocados: [],
            permisosSensibles: [...actuales].sort(),
            sinCambios: true
        };
    }

    // Las claves sensibles deben existir y estar activas. Si falta un permiso
    // en el catálogo, el editor recibe un 400 claro en lugar de un error de FK.
    if (solicitados.length > 0) {
        const disponibles = await executor.query(`
            SELECT clave
            FROM fg_permiso
            WHERE activo = TRUE
              AND clave = ANY($1::varchar[])
        `, [solicitados]);
        const disponiblesSet = new Set(disponibles.rows.map((row) => row.clave));
        const noDisponibles = solicitados.filter((clave) => !disponiblesSet.has(clave));
        if (noDisponibles.length > 0) {
            throw errorNegocio(
                'PERMISOS_SENSIBLES_NO_DISPONIBLES',
                400,
                'El permiso sensible no está registrado o está inactivo.',
                { claves: noDisponibles }
            );
        }
    }

    const objetivo = new Set(solicitados);
    const otorgados = [...objetivo].filter((clave) => !actualesSet.has(clave));
    const revocados = [...actualesSet].filter((clave) => !objetivo.has(clave));

    if (otorgados.length === 0 && revocados.length === 0) {
        return {
            perfil,
            otorgados: [],
            revocados: [],
            permisosSensibles: [...objetivo].sort(),
            sinCambios: true
        };
    }

    let actorCargado = actorAutorizado;
    if (!actorCargado) {
        try {
            actorCargado = await cargarActorAutorizado(executor, actor);
        } catch (error) {
            await registrarDenegacion({
                auditoriaService,
                actor,
                perfilClave: perfil,
                otorgados,
                revocados,
                codigo: error.code,
                mensaje: error.message,
                contexto
            });
            throw error;
        }
    }

    if (!actorCargado.permisos.has(FAREGAS_PERMISO_ADMINISTRAR_PERFILES)) {
        const error = errorNegocio(
            'PERFILES_NO_AUTORIZADO',
            403,
            'No tiene permiso para administrar perfiles (MENU_USUARIOS).'
        );
        await registrarDenegacion({
            auditoriaService,
            actor: actorCargado,
            perfilClave: perfil,
            otorgados,
            revocados,
            codigo: error.code,
            mensaje: error.message,
            contexto
        });
        throw error;
    }

    if (revocados.length > 0) {
        await executor.query(`
            DELETE FROM fg_perfil_permiso
            WHERE perfil_clave = $1
              AND permiso_clave = ANY($2::varchar[])
        `, [perfil, revocados]);
    }

    if (otorgados.length > 0) {
        await executor.query(`
            INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
            SELECT $1, clave
            FROM unnest($2::varchar[]) AS clave
            ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING
        `, [perfil, otorgados]);
    }

    // Auditoría dentro de la misma transacción: si la escritura se revierte, el
    // registro tampoco queda; si se confirma, el cambio es trazable.
    await executor.query(`
        INSERT INTO fg_auditoria_config
            (username, entidad, accion, identificador, detalles, planta_key, ip_direccion)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
    `, [
        actorCargado.username,
        'fg_perfil_permiso',
        'ACTUALIZAR_PERMISOS_SENSIBLES',
        perfil,
        JSON.stringify({
            perfil,
            otorgados,
            revocados,
            permisosSensibles: [...objetivo].sort(),
            resultado: 'EXITOSO'
        }),
        recortar(contexto?.planta_key, 20),
        recortar(contexto?.ip_direccion, 50)
    ]);

    return {
        perfil,
        otorgados,
        revocados,
        permisosSensibles: [...objetivo].sort(),
        sinCambios: false
    };
};

exports._private = {
    errorNegocio,
    normalizarLista,
    cargarPermisosEfectivos,
    cargarActorAutorizado,
    registrarDenegacion
};
