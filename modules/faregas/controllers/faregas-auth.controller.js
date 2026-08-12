const faregasAuthService = require('../services/faregas-auth.service');
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
            return res.status(401).json({ message: "Credenciales inválidas" });
        }

        const user = result.user;
        const plantas = await faregasAuthService.getPlantasPorUsuario(user.username, user.perfil_id);

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

        return res.status(200).json({
            user,
            plantas,
            preToken
        });

    } catch (error) {
        console.error("Error en login FAREGAS:", error);
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
            return res.status(401).json({ message: "Usuario inválido o inactivo." });
        }
        
        const currentPerfilId = userDb.rows[0].perfil_id;

        const planta = await faregasAuthService.validarAccesoPlanta(username, currentPerfilId, plantaKey);
        
        if (!planta) {
            return res.status(403).json({ message: "No tiene acceso a esta planta." });
        }

        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        
        const sesion = await faregasAuthService.crearSesion(username, plantaKey, ip, userAgent);

        const finalToken = jwt.sign(
            {
                username: username,
                perfil_id: currentPerfilId,
                user_type: userDb.rows[0].user_type,
                session_jti: sesion.session_jti,
                planta_key: planta.key,
                faregas_flow: 'authenticated'
            },
            JWT_SECRET_FAREGAS,
            { expiresIn: '8h' }
        );

        return res.status(200).json({
            user: {
                username: username,
                perfil_id: currentPerfilId,
                user_type: userDb.rows[0].user_type
            },
            plantaSeleccionada: planta,
            esSistemas: currentPerfilId === 'SISTEMAS',
            accessToken: finalToken
        });

    } catch (error) {
        console.error("Error en confirmarPlanta FAREGAS:", error);
        return res.status(401).json({ message: "Token inválido o expirado." });
    }
};
