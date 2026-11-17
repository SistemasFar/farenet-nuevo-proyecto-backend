const db = require('../../../config/database');
const bcrypt = require('bcryptjs');
const authService = require('./faregas-auth.service');

const MAX_USUARIOS_POR_LOTE = 100;
const MIN_LONGITUD_TEMPORAL = 24;

const errorCredenciales = (statusCode, code, message) => Object.assign(new Error(message), {
    statusCode,
    code,
});

const validarSolicitud = (credenciales, bcryptApi, authApi) => {
    if (!Array.isArray(credenciales) || credenciales.length === 0) {
        throw errorCredenciales(400, 'CREDENCIALES_REQUERIDAS', 'Seleccione al menos un usuario.');
    }
    if (credenciales.length > MAX_USUARIOS_POR_LOTE) {
        throw errorCredenciales(400, 'LOTE_DEMASIADO_GRANDE', `El lote no puede superar ${MAX_USUARIOS_POR_LOTE} usuarios.`);
    }

    const nombres = new Set();
    const claves = new Set();
    return credenciales.map((item) => {
        const username = String(item?.username || '').trim();
        const password = typeof item?.password === 'string' ? item.password : '';
        if (!username || username.length > 255) {
            throw errorCredenciales(400, 'USUARIO_INVALIDO', 'El lote contiene un username inválido.');
        }
        if (nombres.has(username.toLowerCase())) {
            throw errorCredenciales(400, 'USUARIO_DUPLICADO', 'El lote contiene usernames repetidos.');
        }
        nombres.add(username.toLowerCase());

        if (password.length < MIN_LONGITUD_TEMPORAL || password.length > 128) {
            throw errorCredenciales(400, 'CONTRASENA_TEMPORAL_INVALIDA', 'Cada contraseña temporal debe tener entre 24 y 128 caracteres.');
        }
        if (claves.has(password)) {
            throw errorCredenciales(400, 'CONTRASENAS_REPETIDAS', 'Cada usuario debe recibir una contraseña diferente.');
        }
        claves.add(password);

        const politica = authApi.validarPoliticaPassword(password, username);
        if (!politica?.valido) {
            throw errorCredenciales(400, 'POLITICA_PASSWORD_INVALIDA', politica?.mensaje || 'Una contraseña temporal no cumple la política de seguridad.');
        }

        return {
            username,
            hash: bcryptApi.hashSync(password, 10),
        };
    });
};

/**
 * Reemplaza credenciales de cuentas FAREGAS activas en una sola transacción.
 * Las contraseñas en texto plano solo atraviesan esta llamada y nunca se
 * devuelven, registran ni guardan en la base de datos.
 */
const restablecerCredencialesTemporales = async (
    credenciales,
    { pool = db, bcryptApi = bcrypt, authApi = authService } = {},
) => {
    const credencialesHash = validarSolicitud(credenciales, bcryptApi, authApi);
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const nombres = credencialesHash.map((item) => item.username);
        const usuarios = await client.query(`
            SELECT username, estado
            FROM public.fg_usuario
            WHERE username = ANY($1::varchar[])
            ORDER BY username
            FOR UPDATE
        `, [nombres]);

        if (usuarios.rowCount !== credencialesHash.length) {
            throw errorCredenciales(409, 'USUARIO_NO_DISPONIBLE', 'Uno o más usuarios ya no existen. No se modificó ninguna contraseña.');
        }
        const inactivos = usuarios.rows.filter((usuario) => usuario.estado !== true);
        if (inactivos.length) {
            throw errorCredenciales(409, 'USUARIO_INACTIVO', 'El lote contiene cuentas inactivas. No se modificó ninguna contraseña.');
        }

        const resultados = [];
        for (const credencial of credencialesHash) {
            const actualizacion = await client.query(`
                UPDATE public.fg_usuario
                SET contrasenha = $1
                WHERE username = $2 AND estado = TRUE
            `, [credencial.hash, credencial.username]);

            if (actualizacion.rowCount !== 1) {
                throw errorCredenciales(409, 'ACTUALIZACION_INCOMPLETA', 'No se pudo actualizar el lote completo. Se revirtieron los cambios.');
            }

            const sesionesRevocadas = await authApi.revocarSesionesUsuario(credencial.username, client);
            resultados.push({ username: credencial.username, sesionesRevocadas });
        }

        await client.query('COMMIT');
        return resultados;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) { /* conserva el error original */ }
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    MAX_USUARIOS_POR_LOTE,
    MIN_LONGITUD_TEMPORAL,
    restablecerCredencialesTemporales,
};
