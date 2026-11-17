const error = (code, message, statusCode = 409, detalles) =>
    Object.assign(new Error(message), { code, statusCode, detalles });
const actorUsername = actor => typeof actor === 'string' ? actor : actor?.username;

// Serializa las bajas y cambios de rol/estado, incluidos UPDATE concurrentes.
const bloquearCuentas = client => client.query('LOCK TABLE public.fg_usuario IN SHARE ROW EXCLUSIVE MODE');
const esAdministrador = async (client, perfil) => (await client.query(`
    SELECT 1 FROM fg_perfil_permiso pp JOIN fg_permiso p ON p.clave=pp.permiso_clave
    WHERE pp.perfil_clave=$1 AND pp.permiso_clave='MENU_USUARIOS' AND p.activo=TRUE
`, [perfil])).rowCount > 0;

const protegerCuenta = async (client, usuario, actor, { estado = false, perfil = usuario.perfil_id } = {}) => {
    if (actorUsername(actor) === usuario.username && !estado) {
        throw error('AUTO_ELIMINACION_PROHIBIDA', 'No puedes eliminar ni desactivar tu propia cuenta.');
    }
    if (!usuario.estado || !await esAdministrador(client, usuario.perfil_id)) return;
    if (estado && await esAdministrador(client, perfil)) return;
    const otros = await client.query(`SELECT 1 FROM fg_usuario u
        WHERE u.estado=TRUE AND u.username<>$1 AND EXISTS (
          SELECT 1 FROM fg_perfil_permiso pp JOIN fg_permiso p ON p.clave=pp.permiso_clave
          WHERE pp.perfil_clave=u.perfil_id AND pp.permiso_clave='MENU_USUARIOS' AND p.activo=TRUE
        ) LIMIT 1`, [usuario.username]);
    if (!otros.rowCount) throw error('ULTIMO_ADMIN', 'No se puede retirar la última cuenta activa con permiso para administrar usuarios.');
};

// Se marca revocada para conservar el acceso histórico; la eliminación física
// de una cuenta sin historial elimina sus sesiones en la misma transacción.
const revocarSesiones = (client, username) => client.query(`UPDATE fg_usuario_sesion
    SET isactive=FALSE, revoked_at_utc=COALESCE(revoked_at_utc, CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
        logouttime_utc=COALESCE(logouttime_utc, CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), refresh_token_hash=NULL
    WHERE usuario_username=$1`, [username]);

module.exports = { error, actorUsername, bloquearCuentas, esAdministrador, protegerCuenta, revocarSesiones };
