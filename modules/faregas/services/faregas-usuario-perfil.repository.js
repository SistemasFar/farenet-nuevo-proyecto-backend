const TABLA_PERFIL = 'public.fg_usuario_perfil';

const estaDisponible = async (queryable) => {
    const resultado = await queryable.query(
        "SELECT to_regclass('public.fg_usuario_perfil') IS NOT NULL AS disponible"
    );
    return resultado.rows?.[0]?.disponible === true;
};

const errorMigracionPendiente = () => {
    const error = new Error(
        'La administración independiente de perfiles requiere aplicar la migración FAREGAS fg_usuario_perfil. No se modificó ninguna persona de FARENET.'
    );
    error.code = 'MIGRACION_PERFIL_FAREGAS_PENDIENTE';
    error.statusCode = 503;
    return error;
};

module.exports = { TABLA_PERFIL, estaDisponible, errorMigracionPendiente };
