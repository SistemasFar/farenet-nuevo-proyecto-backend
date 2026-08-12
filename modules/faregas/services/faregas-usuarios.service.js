const db = require('../../../config/database');
const bcrypt = require('bcryptjs');

const normalizarTexto = (valor) => {
    return String(valor || '').trim();
};

exports.obtenerUsuarios = async () => {
    const query = `
        SELECT u.username, u.perfil_id, u.estado, u.user_type,
               COALESCE(
                   (SELECT json_agg(json_build_object('key', p.key, 'nombre', p.nombre))
                    FROM fg_usuario_planta up
                    JOIN fg_planta p ON p.key = up.plantas_key
                    WHERE up.usuario_username = u.username),
                   '[]'::json
               ) as sedes
        FROM fg_usuario u
        ORDER BY u.username;
    `;
    const result = await db.query(query);
    return result.rows;
};

exports.crearUsuario = async (data) => {
    const { username, password, perfil_id, estado, sedes } = data;
    const cleanUsername = normalizarTexto(username);
    const hash = bcrypt.hashSync(password, 10);
    const cleanPerfil = perfil_id === '' ? null : perfil_id;
    const estadoBool = estado === true || estado === 'true';

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Insertar usuario
        await client.query(`
            INSERT INTO fg_usuario (username, contrasenha, perfil_id, estado, user_type)
            VALUES ($1, $2, $3, $4, 'FAREGAS')
        `, [cleanUsername, hash, cleanPerfil, estadoBool]);

        if (cleanPerfil !== 'SISTEMAS' && Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                const check = await client.query('SELECT 1 FROM fg_perfil_planta WHERE perfil_clave = $1 AND planta_key = $2', [cleanPerfil, planta_key]);
                if (check.rowCount === 0) {
                    throw new Error(`Planta ${planta_key} no permitida para el perfil ${cleanPerfil}`);
                }
                await client.query('INSERT INTO fg_usuario_planta (usuario_username, plantas_key) VALUES ($1, $2)', [cleanUsername, planta_key]);
            }
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

exports.actualizarUsuario = async (oldUsername, data) => {
    const { username, perfil_id, estado, sedes } = data;
    const newUsername = normalizarTexto(username);
    const cleanPerfil = perfil_id === '' ? null : perfil_id;
    const estadoBool = estado === true || estado === 'true';

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Check si newUsername existe (y no es el mismo)
        if (newUsername !== oldUsername) {
            const r = await client.query('SELECT 1 FROM fg_usuario WHERE username = $1', [newUsername]);
            if (r.rowCount > 0) {
                throw new Error('USERNAME_EXISTS');
            }
        }

        // UPDATE (PostgreSQL on update cascade manejara fk fg_usuario_planta y fg_usuario_sesion)
        await client.query(`
            UPDATE fg_usuario 
            SET username = $1, perfil_id = $2, estado = $3
            WHERE username = $4
        `, [newUsername, cleanPerfil, estadoBool, oldUsername]);

        // Actualizar plantas
        if (cleanPerfil === 'SISTEMAS') {
            await client.query('DELETE FROM fg_usuario_planta WHERE usuario_username = $1', [newUsername]);
        } else {
            await client.query('DELETE FROM fg_usuario_planta WHERE usuario_username = $1', [newUsername]);
            if (Array.isArray(sedes) && sedes.length > 0) {
                for (const planta_key of sedes) {
                    const check = await client.query('SELECT 1 FROM fg_perfil_planta WHERE perfil_clave = $1 AND planta_key = $2', [cleanPerfil, planta_key]);
                    if (check.rowCount === 0) {
                        throw new Error(`Planta ${planta_key} no permitida para el perfil ${cleanPerfil}`);
                    }
                    await client.query('INSERT INTO fg_usuario_planta (usuario_username, plantas_key) VALUES ($1, $2)', [newUsername, planta_key]);
                }
            }
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
        
        // 1. Actualizar contraseña en FAREGAS
        const resFaregas = await client.query(`
            UPDATE fg_usuario
            SET contrasenha = $1
            WHERE username = $2
        `, [hash, username]);

        // Si el usuario no existe en FAREGAS, abortar
        if (resFaregas.rowCount === 0) {
            throw new Error('USER_NOT_FOUND');
        }

        // 2. Sincronizar contraseña en FARENET si el usuario existe
        await client.query(`
            UPDATE usuario
            SET contrasenha = $1
            WHERE username = $2
        `, [hash, username]);
        // No es error si en FARENET rowCount es 0 (usuario solo FAREGAS)

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

        // Actualizar sedes
        await client.query('DELETE FROM fg_perfil_planta WHERE perfil_clave = $1', [clave]);
        if (Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                await client.query('INSERT INTO fg_perfil_planta (perfil_clave, planta_key) VALUES ($1, $2)', [clave, planta_key]);
            }
        }

        // Limpiar asignaciones de sedes inválidas de los usuarios
        await client.query(`
            DELETE FROM fg_usuario_planta up
            USING fg_usuario u
            WHERE up.usuario_username = u.username
              AND u.perfil_id = $1
              AND up.plantas_key NOT IN (
                  SELECT planta_key FROM fg_perfil_planta WHERE perfil_clave = $1
              )
        `, [clave]);

        // Actualizar permisos (sólo MENU)
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
        if (e.code === '23503') { // foreign_key_violation
            throw new Error('IN_USE');
        }
        throw e;
    }
};

exports.obtenerPlantas = async () => {
    const result = await db.query('SELECT key, nombre FROM fg_planta ORDER BY nombre');
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
        if (sesiones.rowCount > 0) {
            throw new Error('HAS_SESSIONS');
        }
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
