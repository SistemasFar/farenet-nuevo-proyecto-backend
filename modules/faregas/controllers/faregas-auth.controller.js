const faregasAuthService = require('../services/faregas-auth.service');
const faregasAuditoriaService = require('../services/faregas-auditoria.service');
const jwt = require('jsonwebtoken');

const JWT_SECRET_FAREGAS = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';

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
