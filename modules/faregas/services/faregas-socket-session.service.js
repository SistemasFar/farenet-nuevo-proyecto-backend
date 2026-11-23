const { obtenerAccesoPlanta } = require('./faregas-acceso-sedes.service');

const salaNotificacionesFaregas = ({ empresaKey, plantaKey, username }) =>
    'faregas:notificaciones:' + JSON.stringify([empresaKey, plantaKey, username]);

async function obtenerAlcanceSocketFaregas(db, token) {
    const { username, planta_key: plantaKey, session_jti: sessionJti, exp } = token;
    if (token.faregas_flow !== 'authenticated'
        || [username, plantaKey, sessionJti].some(valor => typeof valor !== 'string' || !valor)
        || !Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;

    const result = await db.query(
        'SELECT u.perfil_id, s.access_expires_utc ' +
        'FROM fg_usuario_sesion s JOIN fg_usuario u ON u.username = s.usuario_username ' +
        'WHERE s.session_jti = $1 AND s.usuario_username = $2 AND s.planta_key = $3 ' +
        'AND s.isactive = TRUE AND s.access_expires_utc > NOW() AND u.estado = TRUE LIMIT 1',
        [sessionJti, username, plantaKey]
    );
    const sesion = result.rows[0];
    if (!sesion) return null;
    const planta = await obtenerAccesoPlanta(db, { username, perfilId: sesion.perfil_id, plantaKey });
    const expiraEn = Math.min(exp * 1000, new Date(sesion.access_expires_utc).getTime());
    if (!planta?.empresa_key || !Number.isFinite(expiraEn) || expiraEn <= Date.now()) return null;
    return { username, plantaKey: String(planta.key), empresaKey: String(planta.empresa_key), expiraEn };
}

module.exports = { obtenerAlcanceSocketFaregas, salaNotificacionesFaregas };
