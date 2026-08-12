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

        // 2. Insertar plantas si aplica
        if (cleanPerfil !== 'SISTEMAS' && Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                await client.query(`
                    INSERT INTO fg_usuario_planta (usuario_username, plantas_key)
                    VALUES ($1, $2)
                `, [cleanUsername, planta_key]);
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
        // Borrar actuales
        await client.query('DELETE FROM fg_usuario_planta WHERE usuario_username = $1', [newUsername]);
        
        // Insertar nuevas si no es SISTEMAS
        if (cleanPerfil !== 'SISTEMAS' && Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                await client.query(`
                    INSERT INTO fg_usuario_planta (usuario_username, plantas_key)
                    VALUES ($1, $2)
                `, [newUsername, planta_key]);
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
    await db.query(`
        UPDATE fg_usuario
        SET contrasenha = $1
        WHERE username = $2
    `, [hash, username]);
};

exports.obtenerPerfiles = async () => {
    const result = await db.query(`
        SELECT p.clave, p.nombre, p.visible,
               (SELECT COUNT(*) FROM fg_usuario u WHERE u.perfil_id = p.clave) as num_usuarios
        FROM fg_perfil p
        ORDER BY p.clave
    `);
    return result.rows;
};

exports.crearPerfil = async (data) => {
    const { clave, nombre, visible } = data;
    const isVisible = visible === true || visible === 'true';
    await db.query(`
        INSERT INTO fg_perfil (clave, nombre, visible)
        VALUES ($1, $2, $3)
    `, [clave, nombre, isVisible]);
    return { clave };
};

exports.actualizarPerfil = async (clave, data) => {
    const { nombre, visible } = data;
    const isVisible = visible === true || visible === 'true';
    await db.query(`
        UPDATE fg_perfil
        SET nombre = $1, visible = $2
        WHERE clave = $3
    `, [nombre, isVisible, clave]);
    return { clave };
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
