const db = require('../config/database');

const listarAuditoriaAcceso = async (req, res) => {
    try {
        const {
            username,
            evento,
            exitoso,
            fechaInicio,
            fechaFin
        } = req.query;

        const filtros = [];
        const valores = [];

        if (username) {
            valores.push(`%${username.trim()}%`);
            filtros.push(`username ILIKE $${valores.length}`);
        }

        if (evento) {
            valores.push(evento.trim());
            filtros.push(`evento = $${valores.length}`);
        }

        if (exitoso === 'true' || exitoso === 'false') {
            valores.push(exitoso === 'true');
            filtros.push(`exitoso = $${valores.length}`);
        }

        if (fechaInicio) {
            valores.push(fechaInicio);
            filtros.push(`fecha_evento >= $${valores.length}`);
        }

        if (fechaFin) {
            valores.push(fechaFin);
            filtros.push(`fecha_evento <= $${valores.length}`);
        }

        const where = filtros.length > 0
            ? `WHERE ${filtros.join(' AND ')}`
            : '';

        const result = await db.query(
            `
            SELECT
                id,
                username,
                evento,
                exitoso,
                mensaje,
                planta_key,
                ip_direccion,
                user_agent,
                fecha_evento
            FROM auditoria_acceso
            ${where}
            ORDER BY fecha_evento DESC
            LIMIT 200
            `,
            valores
        );

        return res.status(200).json({
            status: 'success',
            data: result.rows
        });

    } catch (error) {
        console.error('❌ Error listando auditoría:', error);

        return res.status(500).json({
            status: 'error',
            message: 'Error al consultar auditoría de acceso.'
        });
    }
};

module.exports = {
    listarAuditoriaAcceso
};