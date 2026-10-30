const PERMISO_ACCESO_GLOBAL_SEDES = 'FAREGAS_ACCESO_GLOBAL_SEDES';

const normalizar = (valor) => String(valor ?? '').trim();

const tieneAccesoGlobal = async (executor, perfilId) => {
    const perfil = normalizar(perfilId);
    if (!perfil) return false;
    const result = await executor.query(`
        SELECT TRUE AS acceso_global, pp.permiso_clave
        FROM fg_perfil_permiso pp
        JOIN fg_permiso p
          ON p.clave = pp.permiso_clave
         AND p.activo = TRUE
        WHERE pp.perfil_clave = $1
          AND pp.permiso_clave = $2
        LIMIT 1
    `, [perfil, PERMISO_ACCESO_GLOBAL_SEDES]);
    return result.rows.some((row) => (
        row.acceso_global === true
        || row.permiso_clave === PERMISO_ACCESO_GLOBAL_SEDES
    ));
};

const obtenerPlantasAutorizadas = async (executor, {
    username,
    perfilId,
    empresaKey = null
}) => {
    const usuario = normalizar(username);
    const perfil = normalizar(perfilId);
    if (!usuario || !perfil) return [];
    const global = await tieneAccesoGlobal(executor, perfil);
    const result = global
        ? await executor.query(`
            SELECT p.key, p.nombre, p.empresa_key
            FROM fg_planta p
            WHERE p.activo = TRUE
              AND ($1::varchar IS NULL OR p.empresa_key = $1)
            ORDER BY p.nombre
        `, [empresaKey])
        : await executor.query(`
            SELECT DISTINCT p.key, p.nombre, p.empresa_key
            FROM fg_usuario_planta up
            JOIN fg_perfil_planta pp
              ON pp.planta_key = up.plantas_key
             AND pp.perfil_clave = $2
            JOIN fg_planta p
              ON p.key = up.plantas_key
             AND p.activo = TRUE
            WHERE up.usuario_username = $1
              AND ($3::varchar IS NULL OR p.empresa_key = $3)
            ORDER BY p.nombre
        `, [usuario, perfil, empresaKey]);
    return result.rows;
};

const obtenerAccesoPlanta = async (executor, {
    username,
    perfilId,
    plantaKey,
    empresaKey = null
}) => {
    const planta = normalizar(plantaKey);
    if (!planta) return null;
    const autorizadas = await obtenerPlantasAutorizadas(executor, {
        username,
        perfilId,
        empresaKey
    });
    return autorizadas.find((item) => String(item.key) === planta) || null;
};

module.exports = {
    PERMISO_ACCESO_GLOBAL_SEDES,
    tieneAccesoGlobal,
    obtenerPlantasAutorizadas,
    obtenerAccesoPlanta
};
