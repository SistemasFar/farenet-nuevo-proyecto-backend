const db = require('../../../config/database');
const bcrypt = require('bcryptjs');
const accesoSedesService = require('./faregas-acceso-sedes.service');

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
