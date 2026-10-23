const faregasAuthService = require('../services/faregas-auth.service');
const faregasAuditoriaService = require('../services/faregas-auditoria.service');
const jwt = require('jsonwebtoken');

const JWT_SECRET_FAREGAS = process.env.JWT_SECRET_FAREGAS;
if (!JWT_SECRET_FAREGAS) throw new Error("CRITICAL: JWT_SECRET_FAREGAS missing in env");

exports.validar = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            valido: false,
            message: "Usuario y contraseña son requeridos."
        });
    }

    try {
        const result = await faregasAuthService.validarFaregas(username, password);

        if (!result.valido) {
            return res.status(401).json({
                valido: false,
                message: "Credenciales inválidas"
            });
        }

        return res.status(200).json({
            valido: true,
            empresa: {
                key: "FAREGAS",
                nombre: "FAREGAS S.A.C."
            },
            user: result.user
        });

    } catch (error) {
        console.error("Error en validar FAREGAS:", error);
        return res.status(500).json({
            valido: false,
            message: "Error interno en validación FAREGAS."
        });
    }
};

exports.login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Usuario y contraseña son requeridos." });
    }

    try {
        const result = await faregasAuthService.validarFaregas(username, password);

        if (!result.valido) {
            await faregasAuditoriaService.registrarEvento({
                username: username,
                evento: 'LOGIN',
                exitoso: false,
                mensaje: 'Credenciales inválidas',
                ip_direccion: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                user_agent: req.headers['user-agent']
            });
            return res.status(401).json({ message: "Credenciales inválidas" });
        }

        const user = result.user;
        const plantas = await faregasAuthService.getPlantasPorUsuario(user.username, user.perfil_id);
        const permisos = await faregasAuthService.getPermisosPorPerfil(user.perfil_id);

        // Pre-token FAREGAS
        const preToken = jwt.sign(
            { 
                username: user.username, 
                perfil_id: user.perfil_id,
                faregas_flow: 'pre-select'
            },
            JWT_SECRET_FAREGAS,
            { expiresIn: '15m' }
        );

        await faregasAuditoriaService.registrarEvento({
            username: user.username,
            evento: 'LOGIN',
            exitoso: true,
            mensaje: 'Login exitoso pendiente de selección de sede',
            ip_direccion: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            user_agent: req.headers['user-agent']
        });

        return res.status(200).json({
            user: { ...user, permisos },
            plantas,
            preToken
        });

    } catch (error) {
        console.error("Error en login FAREGAS:", error);
        await faregasAuditoriaService.registrarEvento({
            username: username,
            evento: 'LOGIN',
            exitoso: false,
            mensaje: error.message || 'Error interno en login FAREGAS',
            ip_direccion: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            user_agent: req.headers['user-agent']
        });
        return res.status(500).json({ message: "Error interno en login FAREGAS." });
    }
};

exports.confirmarPlanta = async (req, res) => {
    const { plantaKey } = req.body;
    const authHeader = req.headers.authorization;

    if (!plantaKey) {
        return res.status(400).json({ message: "La planta es requerida." });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "Pre-token requerido." });
    }

    const preToken = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(preToken, JWT_SECRET_FAREGAS);

        if (decoded.faregas_flow !== 'pre-select') {
            return res.status(401).json({ message: "Token inválido para esta operación." });
        }

        const { username, perfil_id } = decoded;

        const result = await faregasAuthService.validarFaregas(username, ''); // Validar usuario actual no aplica con password vacío a menos que implementemos una db call pura
        // Necesitamos leer usuario directamente
        const db = require('../../../config/database');
        const userDb = await db.query('SELECT * FROM fg_usuario WHERE username=$1 AND estado=true LIMIT 1', [username]);
        if(userDb.rowCount === 0) {
            await faregasAuditoriaService.registrarEvento({
                username: username,
                evento: 'CONFIRMAR_PLANTA',
                exitoso: false,
                mensaje: 'Usuario inválido o inactivo',
                planta_key: plantaKey,
                ip_direccion: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                user_agent: req.headers['user-agent']
            });
            return res.status(401).json({ message: "Usuario inválido o inactivo." });
        }
        
        const currentPerfilId = userDb.rows[0].perfil_id;

        const planta = await faregasAuthService.validarAccesoPlanta(username, currentPerfilId, plantaKey);
        
        if (!planta) {
            await faregasAuditoriaService.registrarEvento({
                username: username,
                evento: 'CONFIRMAR_PLANTA',
                exitoso: false,
                mensaje: 'No tiene acceso a esta planta',
                planta_key: plantaKey,
                ip_direccion: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                user_agent: req.headers['user-agent']
            });
            return res.status(403).json({ message: "No tiene acceso a esta planta." });
        }

        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        
        const sesion = await faregasAuthService.crearSesion(username, plantaKey, ip, userAgent);

        const permisos = await faregasAuthService.getPermisosPorPerfil(currentPerfilId);

        const finalToken = jwt.sign(
            {
                username: username,
                perfil_id: currentPerfilId,
                user_type: userDb.rows[0].user_type,
                session_jti: sesion.session_jti,
                planta_key: planta.key,
                permisos: permisos,
                faregas_flow: 'authenticated'
            },
            JWT_SECRET_FAREGAS,
            { expiresIn: '8h' }
        );

        await faregasAuditoriaService.registrarEvento({
            username: username,
            evento: 'CONFIRMAR_PLANTA',
            exitoso: true,
            mensaje: 'Sede operativa confirmada correctamente',
            planta_key: planta.key,
            ip_direccion: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            user_agent: req.headers['user-agent']
        });

        return res.status(200).json({
            user: {
                username: username,
                perfil_id: currentPerfilId,
                user_type: userDb.rows[0].user_type,
                permisos: permisos
            },
            plantaSeleccionada: planta,
            esSistemas: currentPerfilId === 'SISTEMAS',
            accessToken: finalToken
        });

    } catch (error) {
        console.error("Error en confirmarPlanta FAREGAS:", error);
        
        // Attempt to extract username from token for the audit if available
        let auditUsername = null;
        if (preToken) {
            try { const dec = jwt.decode(preToken); if (dec && dec.username) auditUsername = dec.username; } catch(e){}
        }

        await faregasAuditoriaService.registrarEvento({
            username: auditUsername,
            evento: 'CONFIRMAR_PLANTA',
            exitoso: false,
            mensaje: error.message || 'Token inválido o expirado',
            planta_key: plantaKey,
            ip_direccion: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            user_agent: req.headers['user-agent']
        });
        return res.status(401).json({ message: "Token inválido o expirado." });
    }
};

exports.cambiarPlanta = async (req, res) => {
    const { plantaKey } = req.body;
    const authHeader = req.headers.authorization;

    if (!plantaKey) {
        return res.status(400).json({ message: "La planta es requerida." });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "Token requerido." });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET_FAREGAS);

        if (decoded.faregas_flow !== 'authenticated') {
            return res.status(401).json({ message: "Token inválido para esta operación." });
        }

        const { username, perfil_id } = decoded;

        // Necesitamos leer usuario directamente
        const db = require('../../../config/database');
        const userDb = await db.query('SELECT * FROM fg_usuario WHERE username=$1 AND estado=true LIMIT 1', [username]);
        if(userDb.rowCount === 0) {
            await faregasAuditoriaService.registrarEvento({
                username: username,
                evento: 'CAMBIO_PLANTA',
                exitoso: false,
                mensaje: 'Usuario inválido o inactivo',
                planta_key: plantaKey,
                ip_direccion: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                user_agent: req.headers['user-agent']
            });
            return res.status(401).json({ message: "Usuario inválido o inactivo." });
        }
        
        const currentPerfilId = userDb.rows[0].perfil_id;

        const planta = await faregasAuthService.validarAccesoPlanta(username, currentPerfilId, plantaKey);
        
        if (!planta) {
            await faregasAuditoriaService.registrarEvento({
                username: username,
                evento: 'CAMBIO_PLANTA',
                exitoso: false,
                mensaje: 'No tiene acceso a esta planta',
                planta_key: plantaKey,
                ip_direccion: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                user_agent: req.headers['user-agent']
            });
            return res.status(403).json({ message: "No tiene acceso a esta planta." });
        }

        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        
        const sesion = await faregasAuthService.crearSesion(username, plantaKey, ip, userAgent);

        const permisos = await faregasAuthService.getPermisosPorPerfil(currentPerfilId);

        const finalToken = jwt.sign(
            {
                username: username,
                perfil_id: currentPerfilId,
                user_type: userDb.rows[0].user_type,
                session_jti: sesion.session_jti,
                planta_key: planta.key,
                permisos: permisos,
                faregas_flow: 'authenticated'
            },
            JWT_SECRET_FAREGAS,
            { expiresIn: '8h' }
        );

        await faregasAuditoriaService.registrarEvento({
            username: username,
            evento: 'CAMBIO_PLANTA',
            exitoso: true,
            mensaje: 'Cambio de sede operativa confirmado correctamente',
            planta_key: planta.key,
            ip_direccion: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            user_agent: req.headers['user-agent']
        });

        return res.status(200).json({
            user: {
                username: username,
                perfil_id: currentPerfilId,
                user_type: userDb.rows[0].user_type,
                permisos: permisos
            },
            plantaSeleccionada: planta,
            esSistemas: currentPerfilId === 'SISTEMAS',
            accessToken: finalToken
        });

    } catch (error) {
        console.error("Error en cambiarPlanta FAREGAS:", error);
        
        let auditUsername = null;
        if (token) {
            try { const dec = jwt.decode(token); if (dec && dec.username) auditUsername = dec.username; } catch(e){}
        }

        await faregasAuditoriaService.registrarEvento({
            username: auditUsername,
            evento: 'CAMBIO_PLANTA',
            exitoso: false,
            mensaje: error.message || 'Token inválido o expirado',
            planta_key: plantaKey,
            ip_direccion: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            user_agent: req.headers['user-agent']
        });
        return res.status(401).json({ message: "Token inválido o expirado." });
    }
};

/**
 * Renueva únicamente la representación de la sesión del navegador.
 *
 * Los permisos se vuelven a leer desde PostgreSQL y el token conserva la
 * fecha de expiración original. De esta forma una recarga no prolonga la
 * sesión y tampoco depende del snapshot guardado en sessionStorage.
 */
exports.refrescarSesion = async (req, res) => {
    const decoded = req.user;

    if (decoded?.faregas_flow !== 'authenticated' || !decoded?.username || !decoded?.session_jti || !decoded?.planta_key) {
        return res.status(401).json({ message: 'Sesión FAREGAS inválida.' });
    }

    try {
        const db = require('../../../config/database');
        const sessionDb = await db.query(`
            SELECT
                u.username,
                u.perfil_id,
                u.user_type,
                u.estado,
                s.isactive,
                s.access_expires_utc,
                s.planta_key AS session_planta_key
            FROM fg_usuario u
            JOIN fg_usuario_sesion s
              ON s.usuario_username = u.username
             AND s.session_jti = $2
            WHERE u.username = $1
            LIMIT 1
        `, [decoded.username, decoded.session_jti]);

        if (sessionDb.rowCount === 0 || sessionDb.rows[0].estado !== true) {
            return res.status(401).json({ message: 'Usuario o sesión FAREGAS no disponible.' });
        }

        const sesion = sessionDb.rows[0];
        const expira = new Date(sesion.access_expires_utc).getTime();
        if (sesion.isactive !== true || !Number.isFinite(expira) || expira <= Date.now()) {
            return res.status(401).json({ message: 'Sesión FAREGAS expirada.' });
        }

        if (String(sesion.session_planta_key) !== String(decoded.planta_key)) {
            return res.status(401).json({ message: 'La sede de la sesión FAREGAS no coincide.' });
        }

        const planta = await faregasAuthService.validarAccesoPlanta(
            sesion.username,
            sesion.perfil_id,
            sesion.session_planta_key
        );
        if (!planta) {
            return res.status(403).json({ message: 'No tiene acceso a la sede activa.' });
        }

        const permisos = await faregasAuthService.getPermisosPorPerfil(sesion.perfil_id);
        const plantas = await faregasAuthService.getPlantasPorUsuario(sesion.username, sesion.perfil_id);
        const segundosRestantes = Number(decoded.exp) - Math.floor(Date.now() / 1000);
        if (!Number.isFinite(segundosRestantes) || segundosRestantes <= 0) {
            return res.status(401).json({ message: 'Sesión FAREGAS expirada.' });
        }

        const accessToken = jwt.sign(
            {
                username: sesion.username,
                perfil_id: sesion.perfil_id,
                user_type: sesion.user_type,
                session_jti: decoded.session_jti,
                planta_key: planta.key,
                permisos,
                faregas_flow: 'authenticated'
            },
            JWT_SECRET_FAREGAS,
            { expiresIn: segundosRestantes }
        );

        res.set('Cache-Control', 'no-store');
        return res.status(200).json({
            user: {
                username: sesion.username,
                perfil_id: sesion.perfil_id,
                user_type: sesion.user_type,
                permisos
            },
            plantaSeleccionada: planta,
            plantas,
            esSistemas: sesion.perfil_id === 'SISTEMAS',
            accessToken
        });
    } catch (error) {
        console.error('Error en refrescarSesion FAREGAS:', error);
        return res.status(500).json({ message: 'No se pudo actualizar la sesión FAREGAS.' });
    }
};
