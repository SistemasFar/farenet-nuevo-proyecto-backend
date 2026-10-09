const db = require('../../../config/database');
const bcrypt = require('bcryptjs');
const paginacion = require('./faregas-paginacion.rules');
const validacion = require('./faregas-usuarios-validacion.service');

// El trim de los campos vive en `faregas-usuarios-validacion.service`, que es
// quien devuelve los valores ya normalizados y validados. Aquí no se normaliza
// nada por separado: lo que se guarda es exactamente lo que se comprobó.

exports.obtenerUsuarios = async () => {
    const query = `
        SELECT u.username, u.perfil_id, u.estado, u.user_type, u.persona_nrodocumentoidentidad,
               p.tipodocumentoidentidad_key as "tipoDocumentoKey", td.nombre as "tipoDocumentoNombre",
               p.nrodocumentoidentidad as "nroDocumento",
               p.nombres, p.apellidos, p.nombrerazonsocial as "nombreRazonSocial",
               p.pais_key as "paisKey", pais.nombre as "paisNombre",
               p.departamento_key as "departamentoKey", dep.nombre as "departamentoNombre",
               p.provincia_key as "provinciaKey", prov.nombre as "provinciaNombre",
               p.distrito_key as "distritoKey", dis.nombre as "distritoNombre",
               p.direccion, p.email, p.telefono, p.persona_contacto as "personaContacto",
               COALESCE(
                   (SELECT json_agg(json_build_object('key', up.plantas_key, 'nombre', pl.nombre))
                    FROM fg_usuario_planta up
                    JOIN fg_planta pl ON pl.key = up.plantas_key
                    WHERE up.usuario_username = u.username),
                   '[]'::json
               ) as sedes
        FROM fg_usuario u
        LEFT JOIN persona p ON u.persona_nrodocumentoidentidad = p.nrodocumentoidentidad
        LEFT JOIN tipodocumentoidentidad td ON p.tipodocumentoidentidad_key = td.key
        LEFT JOIN pais ON p.pais_key = pais.key
        LEFT JOIN departamento dep ON p.departamento_key = dep.key
        LEFT JOIN provincia prov ON p.provincia_key = prov.key
        LEFT JOIN distrito dis ON p.distrito_key = dis.key
        ORDER BY u.username
    `;
    const result = await db.query(query);
    return result.rows;
};

/**
 * Listado paginado de usuarios. Es un catalogo maestro: NO se filtra por fecha,
 * solo se pagina. Se mantiene el ORDER BY por usuario.
 */
exports.obtenerUsuariosPaginado = async (filtros = {}) => {
    const { page, limit, offset } = paginacion.normalizarPaginacion(filtros);
    const condiciones = [];
    const valores = [];
    const agregar = (sql, valor) => {
        valores.push(valor);
        condiciones.push(sql.replace('?', `$${valores.length}`));
    };
    if (filtros.buscar) {
        valores.push(`%${filtros.buscar}%`);
        const patron = `$${valores.length}`;
        condiciones.push(
            `(u.username ILIKE ${patron} OR COALESCE(p.nombrerazonsocial, '') ILIKE ${patron})`
        );
    }
    if (filtros.perfil_id) agregar('u.perfil_id = ?', filtros.perfil_id);
    if (filtros.estado === true || filtros.estado === false) agregar('u.estado = ?', filtros.estado);

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const joins = `
        FROM fg_usuario u
        LEFT JOIN persona p ON u.persona_nrodocumentoidentidad = p.nrodocumentoidentidad
    `;

    const conteo = await db.query(
        `SELECT COUNT(*)::int AS total ${joins} ${where}`,
        valores
    );

    const result = await db.query(`
        SELECT u.username, u.perfil_id, u.estado, u.user_type, u.persona_nrodocumentoidentidad,
        COALESCE(
        (SELECT json_agg(json_build_object('key', up.plantas_key, 'nombre', pl.nombre))
        FROM fg_usuario_planta up
        JOIN fg_planta pl ON pl.key = up.plantas_key
        WHERE up.usuario_username = u.username),
        '[]'::json
        ) as sedes
        ${joins} ${where}
        ORDER BY u.username
        LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}
    `, [...valores, limit, offset]);

    return paginacion.respuestaPaginada(
        result.rows,
        Number(conteo.rows[0]?.total || 0),
        page,
        limit
    );
};

exports.crearUsuario = async (data, creadorUsername) => {
    const {
        perfil_id, estado, sedes, user_type,
        password, nombres, apellidos, nombreRazonSocial,
        paisKey, departamentoKey, provinciaKey, distritoKey,
        direccion, email, telefono, personaContacto
    } = data;

    // Ninguna escritura llega a la base sin pasar por la validación. Se valida
    // sobre `data` completo y se usan los valores NORMALIZADOS que devuelve,
    // para que lo que se guarde sea exactamente lo que se comprobó.
    const datosValidados = validacion.exigirDatosValidos(data, { modo: 'crear' });
    const cleanUsername = datosValidados.username;
    const nroDocumento = datosValidados.nroDocumento;
    const tipoDocumentoKey = datosValidados.tipoDocumentoKey;

    const hash = bcrypt.hashSync(password, 10);
    const cleanPerfil = perfil_id === '' ? null : perfil_id;
    const estadoBool = estado === true || estado === 'true';
    const tipoUsr = user_type || 'USER';

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Insert/Update Persona
        if (nroDocumento && tipoDocumentoKey) {
            await client.query(`
                INSERT INTO persona (
                    nrodocumentoidentidad, tipodocumentoidentidad_key,
                    nombres, apellidos, nombrerazonsocial,
                    pais_key, departamento_key, provincia_key, distrito_key,
                    direccion, email, telefono, persona_contacto,
                    estado, usuariocreacion_username
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, $14)
                ON CONFLICT (nrodocumentoidentidad) DO UPDATE SET
                    tipodocumentoidentidad_key = EXCLUDED.tipodocumentoidentidad_key,
                    nombres = EXCLUDED.nombres,
                    apellidos = EXCLUDED.apellidos,
                    nombrerazonsocial = EXCLUDED.nombrerazonsocial,
                    pais_key = EXCLUDED.pais_key,
                    departamento_key = EXCLUDED.departamento_key,
                    provincia_key = EXCLUDED.provincia_key,
                    distrito_key = EXCLUDED.distrito_key,
                    direccion = EXCLUDED.direccion,
                    email = EXCLUDED.email,
                    telefono = EXCLUDED.telefono,
                    persona_contacto = EXCLUDED.persona_contacto,
                    usuariomodi_id = EXCLUDED.usuariocreacion_username,
                    fechmodi = CURRENT_TIMESTAMP
            `, [
                nroDocumento, tipoDocumentoKey, nombres, apellidos, nombreRazonSocial,
                paisKey, departamentoKey, provinciaKey, distritoKey,
                direccion, email, telefono, personaContacto, creadorUsername
            ]);
        }

        // 2. Insertar usuario
        await client.query(`
            INSERT INTO fg_usuario (username, contrasenha, perfil_id, estado, user_type, persona_nrodocumentoidentidad)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [cleanUsername, hash, cleanPerfil, estadoBool, tipoUsr, nroDocumento || null]);

        // 3. Asignar sedes
        if (cleanPerfil !== 'SISTEMAS' && Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                const check = await client.query('SELECT 1 FROM fg_perfil_planta WHERE perfil_clave = $1 AND planta_key = $2', [cleanPerfil, planta_key]);
                if (check.rowCount === 0) {
                    throw new Error(`Planta ${planta_key} no permitida para el perfil ${cleanPerfil}`);
                }
                await client.query('INSERT INTO fg_usuario_planta (usuario_username, plantas_key) VALUES ($1, $2)', [cleanUsername, planta_key]);
            }
        }

        // 4. Ejecutivo
        if (tipoUsr === 'EJECUTIVO') {
            const nomApe = (nombres || '') + ' ' + (apellidos || '');
            const nomToSave = nomApe.trim() || nombreRazonSocial || cleanUsername;
            await client.query(`
                INSERT INTO fg_ejecutivo (nombre, activo, username)
                VALUES ($1, $2, $3)
            `, [nomToSave, estadoBool, cleanUsername]);
        }
        
        await client.query('COMMIT');
        return { username: cleanUsername };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.actualizarUsuario = async (oldUsername, data, modificadorUsername) => {
    const {
        perfil_id, estado, sedes, user_type,
        nombres, apellidos, nombreRazonSocial,
        paisKey, departamentoKey, provinciaKey, distritoKey,
        direccion, email, telefono, personaContacto
    } = data;

    // Mismas reglas que en la creación. `modo: 'editar'` deja pasar la contraseña
    // vacía, que es lo que el formulario ya entendía como "no cambiar".
    const datosValidados = validacion.exigirDatosValidos(data, { modo: 'editar' });
    const newUsername = datosValidados.username;
    const nroDocumento = datosValidados.nroDocumento;
    const tipoDocumentoKey = datosValidados.tipoDocumentoKey;

    const cleanPerfil = perfil_id === '' ? null : perfil_id;
    const estadoBool = estado === true || estado === 'true';
    const tipoUsr = user_type || 'USER';

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        if (newUsername !== oldUsername) {
            const r = await client.query('SELECT 1 FROM fg_usuario WHERE username = $1', [newUsername]);
            if (r.rowCount > 0) throw new Error('USERNAME_EXISTS');
        }

        // 1. Insert/Update Persona
        if (nroDocumento && tipoDocumentoKey) {
            await client.query(`
                INSERT INTO persona (
                    nrodocumentoidentidad, tipodocumentoidentidad_key,
                    nombres, apellidos, nombrerazonsocial,
                    pais_key, departamento_key, provincia_key, distrito_key,
                    direccion, email, telefono, persona_contacto,
                    estado, usuariocreacion_username
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, $14)
                ON CONFLICT (nrodocumentoidentidad) DO UPDATE SET
                    tipodocumentoidentidad_key = EXCLUDED.tipodocumentoidentidad_key,
                    nombres = EXCLUDED.nombres,
                    apellidos = EXCLUDED.apellidos,
                    nombrerazonsocial = EXCLUDED.nombrerazonsocial,
                    pais_key = EXCLUDED.pais_key,
                    departamento_key = EXCLUDED.departamento_key,
                    provincia_key = EXCLUDED.provincia_key,
                    distrito_key = EXCLUDED.distrito_key,
                    direccion = EXCLUDED.direccion,
                    email = EXCLUDED.email,
                    telefono = EXCLUDED.telefono,
                    persona_contacto = EXCLUDED.persona_contacto,
                    usuariomodi_id = EXCLUDED.usuariocreacion_username,
                    fechmodi = CURRENT_TIMESTAMP
            `, [
                nroDocumento, tipoDocumentoKey, nombres, apellidos, nombreRazonSocial,
                paisKey, departamentoKey, provinciaKey, distritoKey,
                direccion, email, telefono, personaContacto, modificadorUsername
            ]);
        }

        // UPDATE
        await client.query(`
            UPDATE fg_usuario 
            SET username = $1, perfil_id = $2, estado = $3, user_type = $4, persona_nrodocumentoidentidad = $5
            WHERE username = $6
        `, [newUsername, cleanPerfil, estadoBool, tipoUsr, nroDocumento || null, oldUsername]);

        // Actualizar plantas
        await client.query('DELETE FROM fg_usuario_planta WHERE usuario_username = $1', [newUsername]);
        if (cleanPerfil !== 'SISTEMAS' && Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                const check = await client.query('SELECT 1 FROM fg_perfil_planta WHERE perfil_clave = $1 AND planta_key = $2', [cleanPerfil, planta_key]);
                if (check.rowCount === 0) {
                    throw new Error(`Planta ${planta_key} no permitida para el perfil ${cleanPerfil}`);
                }
                await client.query('INSERT INTO fg_usuario_planta (usuario_username, plantas_key) VALUES ($1, $2)', [newUsername, planta_key]);
            }
        }

        // 4. Ejecutivo
        if (tipoUsr === 'EJECUTIVO') {
            const nomApe = (nombres || '') + ' ' + (apellidos || '');
            const nomToSave = nomApe.trim() || nombreRazonSocial || newUsername;
            
            const checkEjec = await client.query('SELECT id FROM fg_ejecutivo WHERE username = $1', [newUsername]);
            if (checkEjec.rowCount > 0) {
                await client.query('UPDATE fg_ejecutivo SET nombre = $1, activo = $2 WHERE username = $3', [nomToSave, estadoBool, newUsername]);
            } else {
                await client.query(`
                    INSERT INTO fg_ejecutivo (nombre, activo, username)
                    VALUES ($1, $2, $3)
                `, [nomToSave, estadoBool, newUsername]);
            }
        } else {
            // Si ya no es ejecutivo, lo desactivamos (no eliminamos historicos)
            await client.query('UPDATE fg_ejecutivo SET activo = false WHERE username = $1', [newUsername]);
        }

        await client.query('COMMIT');
        return { username: newUsername };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.cambiarPassword = async (username, password) => {
    const hash = bcrypt.hashSync(password, 10);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const resFaregas = await client.query(`
            UPDATE fg_usuario
            SET contrasenha = $1
            WHERE username = $2
        `, [hash, username]);

        if (resFaregas.rowCount === 0) {
            throw new Error('USER_NOT_FOUND');
        }

        await client.query(`
            UPDATE usuario
            SET contrasenha = $1
            WHERE username = $2
        `, [hash, username]);

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerPerfiles = async () => {
    const result = await db.query(`
        SELECT p.clave, p.nombre, p.visible,
               (SELECT COUNT(*) FROM fg_usuario u WHERE u.perfil_id = p.clave) as num_usuarios,
               COALESCE(
                   (SELECT json_agg(planta_key)
                    FROM fg_perfil_planta pp
                    WHERE pp.perfil_clave = p.clave),
                   '[]'::json
               ) as sedes,
               COALESCE(
                   (SELECT json_agg(permiso_clave)
                    FROM fg_perfil_permiso ppe
                    WHERE ppe.perfil_clave = p.clave),
                   '[]'::json
               ) as permisos
        FROM fg_perfil p
        ORDER BY p.clave
    `);
    return result.rows;
};

exports.crearPerfil = async (data) => {
    const { clave, nombre, visible, sedes, permisos } = data;
    const isVisible = visible === true || visible === 'true';
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        await client.query(`
            INSERT INTO fg_perfil (clave, nombre, visible)
            VALUES ($1, $2, $3)
        `, [clave, nombre, isVisible]);
        
        if (Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                await client.query('INSERT INTO fg_perfil_planta (perfil_clave, planta_key) VALUES ($1, $2)', [clave, planta_key]);
            }
        }

        if (Array.isArray(permisos) && permisos.length > 0) {
            for (const p of permisos) {
                await client.query('INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave) VALUES ($1, $2)', [clave, p]);
            }
        }

        await client.query('COMMIT');
        return { clave };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.actualizarPerfil = async (clave, data) => {
    const { nombre, visible, sedes, permisos } = data;
    const isVisible = visible === true || visible === 'true';
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        await client.query(`
            UPDATE fg_perfil
            SET nombre = $1, visible = $2
            WHERE clave = $3
        `, [nombre, isVisible, clave]);

        await client.query('DELETE FROM fg_perfil_planta WHERE perfil_clave = $1', [clave]);
        if (Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                await client.query('INSERT INTO fg_perfil_planta (perfil_clave, planta_key) VALUES ($1, $2)', [clave, planta_key]);
            }
        }

        await client.query(`
            DELETE FROM fg_usuario_planta up
            USING fg_usuario u
            WHERE up.usuario_username = u.username
              AND u.perfil_id = $1
              AND up.plantas_key NOT IN (
                  SELECT planta_key FROM fg_perfil_planta WHERE perfil_clave = $1
              )
        `, [clave]);

        await client.query(`
            DELETE FROM fg_perfil_permiso 
            WHERE perfil_clave = $1 AND permiso_clave IN (SELECT clave FROM fg_permiso WHERE modulo = 'MENU')
        `, [clave]);
        
        if (Array.isArray(permisos) && permisos.length > 0) {
            for (const p of permisos) {
                await client.query('INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave) VALUES ($1, $2) ON CONFLICT DO NOTHING', [clave, p]);
            }
        }

        await client.query('COMMIT');
        return { clave };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.eliminarPerfil = async (clave) => {
    if (clave === 'SISTEMAS') {
        throw new Error('NO_DELETE_SISTEMAS');
    }
    try {
        await db.query('DELETE FROM fg_perfil WHERE clave = $1', [clave]);
    } catch (e) {
        if (e.code === '23503') throw new Error('IN_USE');
        throw e;
    }
};

exports.obtenerPlantas = async () => {
    const result = await db.query('SELECT key, nombre, activo FROM fg_planta ORDER BY nombre');
    return result.rows;
};

exports.obtenerPermisos = async () => {
    const result = await db.query("SELECT clave, nombre FROM fg_permiso WHERE modulo = 'MENU' AND activo = true ORDER BY nombre");
    return result.rows;
};

/**
 * Tablas cuyo historial de negocio impide borrar un usuario, con la etiqueta que
 * se muestra al operador. Se deriva de las FK reales hacia `fg_usuario`: 30
 * constraints en 17 tablas, todas `RESTRICT` o `NO ACTION` (ninguna `CASCADE`,
 * para que el historial nunca se borre en silencio).
 *
 * `fg_usuario_sesion` y `fg_usuario_planta` NO aparecen: son dependencias
 * operativas del acceso, no historial, y se limpian antes de intentar el borrado.
 */
const HISTORIAL_USUARIO = [
    { tabla: 'fg_certificado', etiqueta: 'certificados' },
    { tabla: 'fg_operacion_comercial', etiqueta: 'operaciones comerciales' },
    { tabla: 'fg_chip', etiqueta: 'chips' },
    { tabla: 'fg_chip_movimiento', etiqueta: 'movimientos de chip' },
    { tabla: 'fg_vehiculo', etiqueta: 'vehículos' },
    { tabla: 'fg_ejecutivo', etiqueta: 'ejecutivos' },
    { tabla: 'fg_credito', etiqueta: 'créditos' },
    { tabla: 'fg_debito', etiqueta: 'débitos' },
    { tabla: 'fg_descuento', etiqueta: 'descuentos' },
    { tabla: 'fg_descuentocliente', etiqueta: 'descuentos de cliente' },
    { tabla: 'fg_descuentocomprobante', etiqueta: 'descuentos de comprobante' },
    { tabla: 'fg_descuentodetalle', etiqueta: 'detalles de descuento' },
    { tabla: 'fg_documento_anulacion', etiqueta: 'anulaciones de documento' },
    { tabla: 'fg_documento_electronico_operacion', etiqueta: 'documentos electrónicos' },
    { tabla: 'fg_auditoria_config', etiqueta: 'registros de auditoría' }
];

/** Nombres de columna por los que cada tabla referencia al usuario. */
const COLUMNAS_REFERENCIA = {
    fg_certificado: ['usuario_creacion', 'usuario_modificacion'],
    fg_operacion_comercial: ['usuario_creacion', 'usuario_modificacion'],
    fg_chip: ['creado_por', 'actualizado_por'],
    fg_chip_movimiento: ['usuario'],
    fg_vehiculo: ['usuario_creacion', 'usuario_modificacion'],
    fg_ejecutivo: ['username', 'usuario_creacion', 'usuario_modificacion'],
    fg_credito: ['usuario_creacion', 'usuario_modificacion'],
    fg_debito: ['usuario_creacion', 'usuario_modificacion'],
    fg_descuento: ['usuario_creacion', 'usuario_modificacion'],
    fg_descuentocliente: ['usuario_creacion', 'usuario_modificacion'],
    fg_descuentocomprobante: ['usuario_creacion', 'usuario_modificacion'],
    fg_descuentodetalle: ['usuario_creacion', 'usuario_modificacion'],
    fg_documento_anulacion: ['usuario_creacion', 'usuario_modificacion'],
    fg_documento_electronico_operacion: ['usuario_creacion'],
    fg_auditoria_config: ['username']
};

/**
 * Consulta qué historial bloquea a un usuario, para poder decirlo en el mensaje
 * en vez de devolver un 500 genérico. Usa `to_regclass` para no fallar si una
 * tabla llegara a no existir en alguna instalación.
 */
const detectarHistorial = async (username, executor) => {
    const bloqueos = [];
    for (const { tabla, etiqueta } of HISTORIAL_USUARIO) {
        const columnas = COLUMNAS_REFERENCIA[tabla] || ['username'];
        const existe = (await executor.query(
            `SELECT to_regclass($1::text) IS NOT NULL AS existe`, [`public.${tabla}`])).rows[0].existe;
        if (!existe) continue;
        // Los parámetros empiezan en $1: el nombre de la tabla va interpolado en
        // el FROM porque no puede ser un parámetro de binding.
        const condiciones = columnas
            .map((columna, indice) => `${columna} = $${indice + 1}`)
            .join(' OR ');
        const total = (await executor.query(
            `SELECT COUNT(*)::int AS n FROM ${tabla} WHERE ${condiciones}`,
            columnas.map(() => username))).rows[0].n;
        if (total > 0) bloqueos.push({ tabla, etiqueta, total });
    }
    return bloqueos;
};

const errorHistorial = (username, bloqueos) => {
    const error = new Error('HAS_HISTORIAL');
    error.code = 'USUARIO_CON_HISTORIAL';
    error.statusCode = 409;
    error.username = username;
    error.bloqueos = bloqueos;
    return error;
};

exports.eliminarUsuario = async (username) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Las sesiones registradas ya no bloquean el borrado: se cierran. Son
        // dependencias del acceso, no historial de negocio, y dejarlas impedía
        // retirar a un usuario que ya cerró sesión.
        // Ojo con el nombre: en `fg_usuario_sesion` y `fg_usuario_planta` la FK
        // se llama `usuario_username`; sólo `fg_usuario` usa `username` (su PK).
        const sesiones = await client.query(
            'DELETE FROM fg_usuario_sesion WHERE usuario_username = $1 RETURNING id', [username]);
        await client.query('DELETE FROM fg_usuario_planta WHERE usuario_username = $1', [username]);

        // Antes de borrar, se comprueba el historial. Si existe, se aborta con
        // 409 y la transacción se revierte: no se toca ni un registro histórico.
        const bloqueos = await detectarHistorial(username, client);
        if (bloqueos.length > 0) throw errorHistorial(username, bloqueos);

        const eliminado = await client.query(
            'DELETE FROM fg_usuario WHERE username = $1 RETURNING username', [username]);

        await client.query('COMMIT');
        return {
            username: eliminado.rows[0]?.username ?? username,
            sesionesCerradas: sesiones.rowCount,
            sedesEliminadas: true
        };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports._private = { HISTORIAL_USUARIO, COLUMNAS_REFERENCIA, detectarHistorial };

// MAESTROS DE PERSONA Y GEOGRAFIA
exports.getMaestrosPersona = async () => {
    const doc = await db.query("SELECT key, nombre FROM tipodocumentoidentidad ORDER BY nombre");
    const paises = await db.query("SELECT key, nombre FROM pais ORDER BY nombre");
    return {
        tiposDocumentos: doc.rows,
        paises: paises.rows
    };
};

exports.getDepartamentos = async (paisKey) => {
    const res = await db.query("SELECT key, nombre FROM departamento WHERE pais_key = $1 ORDER BY nombre", [paisKey]);
    return res.rows;
};

exports.getProvincias = async (departamentoKey) => {
    const res = await db.query("SELECT key, nombre FROM provincia WHERE departamento_key = $1 ORDER BY nombre", [departamentoKey]);
    return res.rows;
};

exports.getDistritos = async (provinciaKey) => {
    const res = await db.query("SELECT key, nombre FROM distrito WHERE provincia_key = $1 ORDER BY nombre", [provinciaKey]);
    return res.rows;
};
