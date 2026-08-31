const db = require('../../../config/database');
const bcrypt = require('bcryptjs');

const normalizarTexto = (valor) => {
    return String(valor || '').trim();
};

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
        ORDER BY u.username;
    `;
    const result = await db.query(query);
    return result.rows;
};

exports.crearUsuario = async (data, creadorUsername) => {
    const { 
        username, password, perfil_id, estado, sedes, user_type,
        tipoDocumentoKey, nroDocumento, nombres, apellidos, nombreRazonSocial,
        paisKey, departamentoKey, provinciaKey, distritoKey, 
        direccion, email, telefono, personaContacto 
    } = data;
    
    const cleanUsername = normalizarTexto(username);
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
                    estado, usuario_creacion
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
                    usuario_modificacion = EXCLUDED.usuario_creacion,
                    fecha_modificacion = CURRENT_TIMESTAMP
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
                INSERT INTO fg_ejecutivo (nombre, activo, usuario_username)
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
        username, perfil_id, estado, sedes, user_type,
        tipoDocumentoKey, nroDocumento, nombres, apellidos, nombreRazonSocial,
        paisKey, departamentoKey, provinciaKey, distritoKey, 
        direccion, email, telefono, personaContacto 
    } = data;
    const newUsername = normalizarTexto(username);
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
                    estado, usuario_creacion
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
                    usuario_modificacion = EXCLUDED.usuario_creacion,
                    fecha_modificacion = CURRENT_TIMESTAMP
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
            
            const checkEjec = await client.query('SELECT id FROM fg_ejecutivo WHERE usuario_username = $1', [newUsername]);
            if (checkEjec.rowCount > 0) {
                await client.query('UPDATE fg_ejecutivo SET nombre = $1, activo = $2 WHERE usuario_username = $3', [nomToSave, estadoBool, newUsername]);
            } else {
                await client.query(`
                    INSERT INTO fg_ejecutivo (nombre, activo, usuario_username)
                    VALUES ($1, $2, $3)
                `, [nomToSave, estadoBool, newUsername]);
            }
        } else {
            // Si ya no es ejecutivo, lo desactivamos (no eliminamos historicos)
            await client.query('UPDATE fg_ejecutivo SET activo = false WHERE usuario_username = $1', [newUsername]);
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

exports.eliminarUsuario = async (username) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const sesiones = await client.query('SELECT 1 FROM fg_usuario_sesion WHERE usuario_username = $1 LIMIT 1', [username]);
        if (sesiones.rowCount > 0) throw new Error('HAS_SESSIONS');
        await client.query('DELETE FROM fg_usuario_planta WHERE usuario_username = $1', [username]);
        await client.query('DELETE FROM fg_usuario WHERE username = $1', [username]);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

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
