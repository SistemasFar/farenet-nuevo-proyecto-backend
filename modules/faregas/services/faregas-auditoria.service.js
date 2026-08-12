const db = require('../../../config/database');

exports.registrarEvento = async ({ username, evento, exitoso, mensaje, planta_key, ip_direccion, user_agent }) => {
    try {
        await db.query(`
            INSERT INTO fg_auditoria_acceso 
            (username, evento, exitoso, mensaje, planta_key, ip_direccion, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            username || null,
            evento,
            exitoso,
            mensaje || null,
            planta_key || null,
            ip_direccion || null,
            user_agent ? user_agent.substring(0, 1000) : null
        ]);
    } catch (error) {
        console.error("Error crítico al registrar auditoría en FAREGAS:", error);
        // Silenciar el error para que NO tumbe el flujo principal de auth
    }
};

exports.listarAccesos = async (filtros) => {
    const { username, evento, exitoso, fechaInicio, fechaFin } = filtros;
    let query = 'SELECT * FROM fg_auditoria_acceso WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (username) {
        query += ` AND username ILIKE $${paramIndex}`;
        params.push(`%${username}%`);
        paramIndex++;
    }
    
    if (evento) {
        query += ` AND evento = $${paramIndex}`;
        params.push(evento);
        paramIndex++;
    }

    if (exitoso !== undefined && exitoso !== '') {
        query += ` AND exitoso = $${paramIndex}`;
        params.push(exitoso === 'true' || exitoso === true);
        paramIndex++;
    }

    if (fechaInicio) {
        query += ` AND fecha_evento >= $${paramIndex}`;
        params.push(`${fechaInicio} 00:00:00`);
        paramIndex++;
    }

    if (fechaFin) {
        query += ` AND fecha_evento <= $${paramIndex}`;
        params.push(`${fechaFin} 23:59:59`);
        paramIndex++;
    }

    query += ' ORDER BY fecha_evento DESC LIMIT 500';

    const result = await db.query(query, params);
    return result.rows;
};
