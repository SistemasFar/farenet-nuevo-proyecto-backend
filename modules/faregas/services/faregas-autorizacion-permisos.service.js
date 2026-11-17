const errorPermiso = (status, message) => Object.assign(new Error(message), { status });

// Los permisos de navegación también autorizan las funciones ordinarias de su
// submódulo. Los controles fiscales y administrativos sensibles no están en
// esta tabla y continúan requiriendo su permiso explícito.
const PERMISOS_ORDINARIOS_POR_SUBMODULO = Object.freeze({
    MENU_CHIPS_INVENTARIO: Object.freeze([
        'CHIPS_VER', 'CHIPS_INGRESAR', 'CHIPS_TRANSFERIR', 'CHIPS_BAJA'
    ]),
    MENU_CHIPS_TIPOS: Object.freeze(['CHIPS_VER', 'CHIPS_CONFIGURAR']),
    MENU_CHIPS_VENTAS: Object.freeze(['CHIPS_VER', 'CHIPS_VENDER']),
    MENU_CONFIGURACION_SEDES: Object.freeze(['CONFIGURACION_SEDES']),
    MENU_CONFIGURACION_CATALOGO: Object.freeze([
        'CONFIGURACION_CATEGORIAS', 'CONFIGURACION_PRODUCTOS', 'CONFIGURACION_SERVICIOS'
    ]),
    MENU_CONFIGURACION_TARIFAS: Object.freeze(['CONFIGURACION_TARIFAS']),
    MENU_CONFIGURACION_CORRELATIVOS: Object.freeze(['CONFIGURACION_SERIES']),
    MENU_CONFIGURACION_EMPRESAS: Object.freeze(['CONFIGURACION_EMPRESAS']),
});

const tienePermisoFaregas = (permisos, clave) => {
    const lista = permisos instanceof Set ? permisos : new Set(permisos || []);
    if (lista.has(clave)) return true;
    return Object.entries(PERMISOS_ORDINARIOS_POR_SUBMODULO)
        .some(([submodulo, ordinarios]) => lista.has(submodulo) && ordinarios.includes(clave));
};

async function cargarContextoPermisosFaregas(executor, username) {
    const nombreUsuario = String(username || '').trim();
    if (!nombreUsuario) throw errorPermiso(401, 'Sesión requerida.');

    const usuarioResult = await executor.query(
        'SELECT username, perfil_id, estado FROM public.fg_usuario WHERE username=$1 LIMIT 1',
        [nombreUsuario]
    );
    const usuario = usuarioResult.rows?.[0];
    if (!usuario) throw errorPermiso(401, 'El usuario no existe.');
    if (usuario.estado !== true) throw errorPermiso(403, 'Usuario inactivo.');

    const permisosResult = await executor.query(`
        SELECT pp.permiso_clave
        FROM public.fg_perfil_permiso pp
        JOIN public.fg_permiso p ON p.clave=pp.permiso_clave AND p.activo=TRUE
        WHERE pp.perfil_clave=$1
    `, [usuario.perfil_id]);

    return {
        usuario,
        permisos: new Set((permisosResult.rows || []).map((row) => row.permiso_clave)),
    };
}

module.exports = {
    PERMISOS_ORDINARIOS_POR_SUBMODULO,
    cargarContextoPermisosFaregas,
    tienePermisoFaregas,
};
