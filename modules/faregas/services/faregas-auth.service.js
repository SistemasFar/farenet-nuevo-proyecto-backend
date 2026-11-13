const db = require('../../../config/database');
const bcrypt = require('bcryptjs');
const accesoSedesService = require('./faregas-acceso-sedes.service');
const faregasAuditoriaService = require('./faregas-auditoria.service');

const normalizarTexto = (valor) => {
    return String(valor || '').trim();
};

const validarPassword = (passwordPlano, hashBD) => {
    const cleanPassword = normalizarTexto(passwordPlano);
    const cleanHash = normalizarTexto(hashBD);

    if (
        cleanHash.startsWith('$2a$') ||
        cleanHash.startsWith('$2b$') ||
        cleanHash.startsWith('$2y$')
    ) {
        return bcrypt.compareSync(cleanPassword, cleanHash);
    }
    return cleanPassword === cleanHash;
};

exports.validarFaregas = async (username, password) => {
    const cleanUsername = normalizarTexto(username);
    const cleanPassword = normalizarTexto(password);

    const query = `
        SELECT username, contrasenha, perfil_id, estado, user_type
        FROM fg_usuario
        WHERE TRIM(username) = $1
        LIMIT 1
    `;
    const result = await db.query(query, [cleanUsername]);
    const user = result.rows[0];

    if (!user) {
        return { valido: false };
    }

    if (user.estado !== true) {
        return { valido: false };
    }

    const isMatch = validarPassword(cleanPassword, user.contrasenha);
    
    if (isMatch) {
        return {
            valido: true,
            user: {
                username: user.username,
                perfil_id: user.perfil_id,
                estado: user.estado,
                user_type: user.user_type
            }
        };
    }
    
    return { valido: false };
};

exports.getPlantasPorUsuario = async (username, perfilId) => {
    return accesoSedesService.obtenerPlantasAutorizadas(db, {
        username,
        perfilId
    });
};

exports.validarAccesoPlanta = async (username, perfilId, plantaKey) => {
    return accesoSedesService.obtenerAccesoPlanta(db, {
        username,
        perfilId,
        plantaKey
    });
};

exports.getPermisosPorPerfil = async (perfilId) => {
    const query = `
        SELECT p.clave
        FROM fg_perfil_permiso pp
        JOIN fg_permiso p ON p.clave = pp.permiso_clave
        WHERE pp.perfil_clave = $1 AND p.activo = true
    `;
    const r = await db.query(query, [perfilId]);
    return r.rows.map(row => row.clave);
};

exports.crearSesion = async (username, plantaKey, ip, userAgent) => {
    // Generar jti (ID unico)
    const crypto = require('crypto');
    const jwt_jti = crypto.randomBytes(16).toString('hex');
    const session_jti = crypto.randomBytes(16).toString('hex');
    
    // access_expires_utc
    const expiresUtc = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 horas

    const query = `
        INSERT INTO fg_usuario_sesion (
            usuario_username, isactive, server_name, clienteip,
            session_jti, jwt_jti, access_expires_utc, planta_key
        ) VALUES ($1, true, $2, $3, $4, $5, $6, $7)
        RETURNING *
    `;
    const r = await db.query(query, [
        username,
        userAgent ? userAgent.substring(0, 100) : 'FAREGAS-WEB',
        ip ? ip.substring(0, 45) : '0.0.0.0',
        session_jti,
        jwt_jti,
        expiresUtc,
        plantaKey
    ]);

    return r.rows[0];
};

const MIN_PASSWORD_LENGTH = 12;

const errorNegocio = (codigo, statusCode, mensaje) => {
    const error = new Error(mensaje);
    error.codigo = codigo;
    error.statusCode = statusCode;
    return error;
};

const validarPoliticaPassword = (password, username = '') => {
    const pwd = String(password || '');
    if (pwd.length < MIN_PASSWORD_LENGTH) {
        return {
            valido: false,
            mensaje: `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
        };
    }

    const tieneMayuscula = /[A-Z]/.test(pwd);
    const tieneMinuscula = /[a-z]/.test(pwd);
    const tieneNumeroOSimbolo = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd);

    if (!tieneMayuscula || !tieneMinuscula || !tieneNumeroOSimbolo) {
        return {
            valido: false,
            mensaje: 'La nueva contraseña debe contener al menos una mayúscula, una minúscula y un número o símbolo.'
        };
    }

    const triviales = [
        '123456789012', '1234567890123', 'password1234', 'contrasena123',
        'faregas2026*', 'faregas2026**', 'qwertyuiop12', 'admin1234567'
    ];
    if (triviales.includes(pwd.toLowerCase())) {
        return {
            valido: false,
            mensaje: 'La nueva contraseña es demasiado predecible o trivial. Elija una más segura.'
        };
    }

    if (username && pwd.toLowerCase().includes(username.toLowerCase())) {
        return {
            valido: false,
            mensaje: 'La nueva contraseña no puede contener el nombre de usuario.'
        };
    }

    return { valido: true };
};

const intentosFallidos = new Map();
const MAX_INTENTOS_PASSWORD = 5;
const VENTANA_BLOQUEO_MS = 15 * 60 * 1000;

const verificarBloqueoIntentos = (username) => {
    const registro = intentosFallidos.get(username);
    if (!registro) return;
    if (registro.bloqueadoHasta && registro.bloqueadoHasta > Date.now()) {
        const minutosRestantes = Math.ceil((registro.bloqueadoHasta - Date.now()) / 60000);
        throw errorNegocio(
            'RATE_LIMIT_EXCEEDED',
            429,
            `Demasiados intentos fallidos. Intente nuevamente en ${minutosRestantes} minuto(s).`
        );
    }
    if (registro.bloqueadoHasta && registro.bloqueadoHasta <= Date.now()) {
        intentosFallidos.delete(username);
    }
};

const registrarIntentoFallido = (username) => {
    let registro = intentosFallidos.get(username);
    const now = Date.now();
    if (!registro || (now - registro.primerFallo > VENTANA_BLOQUEO_MS)) {
        registro = { count: 1, primerFallo: now, bloqueadoHasta: null };
    } else {
        registro.count += 1;
        if (registro.count >= MAX_INTENTOS_PASSWORD) {
            registro.bloqueadoHasta = now + VENTANA_BLOQUEO_MS;
        }
    }
    intentosFallidos.set(username, registro);
};

const limpiarIntentosFallidos = (username) => {
    intentosFallidos.delete(username);
};

exports.validarPoliticaPassword = validarPoliticaPassword;
exports.limpiarIntentosFallidos = limpiarIntentosFallidos;

exports.revocarSesionesUsuario = async (username, client = db) => {
    const query = `
        UPDATE fg_usuario_sesion
        SET isactive = false,
            revoked_at_utc = timezone('UTC'::text, now()),
            logouttime_utc = timezone('UTC'::text, now())
        WHERE usuario_username = $1 AND isactive = true
        RETURNING id
    `;
    const res = await client.query(query, [username]);
    return res.rowCount;
};

exports.cambiarContrasenhaUsuario = async ({
    username,
    contrasenhaActual,
    contrasenhaNueva,
    confirmarContrasenha,
    ip,
    userAgent,
    sessionJti,
    plantaKey,
    executor = null,
    auditoria = faregasAuditoriaService
}) => {
    const cleanUsername = normalizarTexto(username);
    const cleanActual = normalizarTexto(contrasenhaActual);
    const cleanNueva = normalizarTexto(contrasenhaNueva);
    const cleanConfirmar = normalizarTexto(confirmarContrasenha);

    if (!cleanUsername) {
        throw errorNegocio('USUARIO_REQUERIDO', 400, 'Usuario no especificado.');
    }

    if (!cleanActual || !cleanNueva || !cleanConfirmar) {
        throw errorNegocio('CAMPOS_INCOMPLETOS', 400, 'Todos los campos de contraseña son obligatorios.');
    }

    if (cleanNueva !== cleanConfirmar) {
        throw errorNegocio('CONFIRMACION_NO_COINCIDE', 400, 'La nueva contraseña y su confirmación no coinciden.');
    }

    // 1. Verificar bloqueo por fuerza bruta
    verificarBloqueoIntentos(cleanUsername);

    // 2. Validar política de seguridad de la nueva contraseña
    const chequeoPolitica = validarPoliticaPassword(cleanNueva, cleanUsername);
    if (!chequeoPolitica.valido) {
        throw errorNegocio('POLITICA_PASSWORD_INVALIDA', 400, chequeoPolitica.mensaje);
    }

    const client = executor || await db.connect();
    const esTransaccionPropia = !executor;

    try {
        if (esTransaccionPropia) await client.query('BEGIN');

        // 3. Buscar al usuario y verificar estado
        const userRes = await client.query(`
            SELECT username, contrasenha, perfil_id, estado, user_type
            FROM fg_usuario
            WHERE TRIM(username) = $1
            LIMIT 1
        `, [cleanUsername]);

        if (userRes.rowCount === 0) {
            throw errorNegocio('USUARIO_NO_EXISTE', 404, 'Usuario no encontrado en FAREGAS.');
        }

        const user = userRes.rows[0];
        if (user.estado !== true) {
            throw errorNegocio('USUARIO_INACTIVO', 403, 'El usuario se encuentra inactivo.');
        }

        // 4. Verificar contraseña actual con bcryptjs
        const actualValida = validarPassword(cleanActual, user.contrasenha);
        if (!actualValida) {
            registrarIntentoFallido(cleanUsername);
            await auditoria.registrarEvento({
                username: cleanUsername,
                evento: 'CAMBIO_CONTRASENA',
                exitoso: false,
                mensaje: 'Intento de cambio de contraseña con contraseña actual incorrecta',
                categoria: 'SEGURIDAD',
                entidad: 'fg_usuario',
                planta_key: plantaKey || null,
                ip_direccion: ip || null,
                user_agent: userAgent || null,
                perfil: user.perfil_id || null,
                datos: { motivo: 'PASSWORD_ACTUAL_INCORRECTA' }
            });

            throw errorNegocio('PASSWORD_ACTUAL_INCORRECTA', 400, 'La contraseña actual es incorrecta.');
        }

        // 5. Confirmar que la nueva contraseña sea diferente de la anterior
        const esMismaPassword = validarPassword(cleanNueva, user.contrasenha);
        if (esMismaPassword) {
            throw errorNegocio('PASSWORD_IDENTICA', 400, 'La nueva contraseña debe ser diferente de la contraseña actual.');
        }

        // Limpiar contador de intentos fallidos
        limpiarIntentosFallidos(cleanUsername);

        // 6. Generar hash bcrypt seguro
        const nuevoHash = bcrypt.hashSync(cleanNueva, 10);

        // 7. Actualizar exclusivamente fg_usuario.contrasenha
        const updateRes = await client.query(`
            UPDATE fg_usuario
            SET contrasenha = $1
            WHERE TRIM(username) = $2
        `, [nuevoHash, cleanUsername]);

        if (updateRes.rowCount === 0) {
            throw errorNegocio('ERROR_ACTUALIZACION', 500, 'No se pudo actualizar la contraseña.');
        }

        // 8. Revocar todas las sesiones activas en fg_usuario_sesion para este usuario
        const sesionesRevocadas = await exports.revocarSesionesUsuario(cleanUsername, client);

        // 9. Registrar evento de auditoría
        await auditoria.registrarEvento({
            username: cleanUsername,
            evento: 'CAMBIO_CONTRASENA',
            exitoso: true,
            mensaje: 'Cambio de contraseña exitoso y revocación de sesiones activas',
            categoria: 'SEGURIDAD',
            entidad: 'fg_usuario',
            planta_key: plantaKey || null,
            ip_direccion: ip || null,
            user_agent: userAgent || null,
            perfil: user.perfil_id || null,
            datos: {
                sesiones_revocadas: sesionesRevocadas,
                session_jti: sessionJti || null
            }
        });

        if (esTransaccionPropia) await client.query('COMMIT');

        return {
            success: true,
            sesionesRevocadas,
            mensaje: 'Contraseña actualizada correctamente.'
        };
    } catch (err) {
        if (esTransaccionPropia) {
            try { await client.query('ROLLBACK'); } catch (_) {}
        }
        throw err;
    } finally {
        if (esTransaccionPropia) client.release();
    }
};
