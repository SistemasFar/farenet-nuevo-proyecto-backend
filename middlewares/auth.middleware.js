const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authMiddleware = async (req, res, next) => {
    try {
        const authDisabled = process.env.AUTH_DISABLED === 'true' && process.env.NODE_ENV !== 'production';

        if (authDisabled) {
            req.user = {
                username: process.env.TEST_USERNAME || 'mchavez',
                perfilId: process.env.TEST_PERFIL || 'administrador',
                plantaKey: process.env.TEST_PLANTA || '201',
                isTestAuth: true
            };

            console.warn(
                `[AUTH_DISABLED] Autenticación humana desactivada en entorno de pruebas. Usuario=${req.user.username}, Planta=${req.user.plantaKey}`
            );

            return next();
        }

        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'No autenticado. Token ausente o formato inválido.' });
        }

        const token = authHeader.split(' ')[1];

        if (!process.env.JWT_SECRET) {
            return res.status(500).json({ message: 'Error interno de configuración de seguridad.' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ message: 'Sesión inválida o expirada.' });
        }

        // Validación estricta en BD
        const sessionResult = await db.query(`
            SELECT s.isactive, s.refresh_expires_utc, u.estado 
            FROM usuario_sesion s
            JOIN usuario u ON u.username = s.usuario_username
            WHERE s.jwt_jti = $1 
              AND s.session_jti = $2
              AND s.usuario_username = $3
            LIMIT 1
        `, [decoded.jti, decoded.sessionJti, decoded.username]);

        if (sessionResult.rowCount === 0) {
            return res.status(401).json({ message: 'Sesión no encontrada.' });
        }

        const { isactive, refresh_expires_utc, estado } = sessionResult.rows[0];

        if (!isactive) {
            return res.status(401).json({ message: 'La sesión fue cerrada o está inactiva.' });
        }

        if (new Date(refresh_expires_utc) <= new Date()) {
            return res.status(401).json({ message: 'La sesión ha expirado completamente.' });
        }

        if (!estado) {
            return res.status(403).json({ message: 'El usuario está inactivo o bloqueado.' });
        }

        // Llenar req.user
        req.user = {
            username: decoded.username,
            perfilId: decoded.perfilId,
            plantaKey: decoded.plantaKey,
            sessionJti: decoded.sessionJti,
            jwtJti: decoded.jti
        };

        next();

    } catch (error) {
        console.error("❌ Error en authMiddleware:", error);
        return res.status(500).json({ message: 'Error interno verificando la sesión.' });
    }
};

module.exports = authMiddleware;
