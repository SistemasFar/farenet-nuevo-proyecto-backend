const db = require('../config/database');

const normalizarTexto = (valor) => {
    return String(valor || '').trim();
};

const obtenerIpCliente = (req) => {
    return (
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        req.ip ||
        null
    );
};

const obtenerUserAgent = (req) => {
    return req.headers['user-agent'] || null;
};

const registrarAuditoriaAcceso = async ({
    req,
    username = null,
    evento,
    exitoso,
    mensaje = null,
    plantaKey = null
}) => {
    try {
        await db.query(
            `
            INSERT INTO auditoria_acceso
            (
                username,
                evento,
                exitoso,
                mensaje,
                planta_key,
                ip_direccion,
                user_agent
            )
            VALUES
            (
                $1, $2, $3, $4, $5, $6, $7
            )
            `,
            [
                username ? normalizarTexto(username) : null,
                evento,
                exitoso,
                mensaje,
                plantaKey ? normalizarTexto(plantaKey) : null,
                obtenerIpCliente(req),
                obtenerUserAgent(req)
            ]
        );
    } catch (error) {
        console.error('❌ Error registrando auditoría de acceso:', error.message);
    }
};

module.exports = {
    registrarAuditoriaAcceso
};