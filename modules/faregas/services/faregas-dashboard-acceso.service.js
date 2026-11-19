const db = require('../../../config/database');
const accesoSedes = require('./faregas-acceso-sedes.service');
const { validarRangoFechasDashboard } = require('./faregas-dashboard-fechas.service');
const { tienePermisoFaregas } = require('./faregas-autorizacion-permisos.service');
const fallo = (status, message) => Object.assign(new Error(message), { status });

// Lectura básica universal; GLOBAL amplía únicamente a las sedes autorizadas.
async function resolverPlantasAutorizadas(req, executor = db) {
    const { username, planta_key: plantaActiva, faregas_flow: flujo } = req.user || {};
    if (!username) throw fallo(401, 'Sesión requerida.');
    if (flujo !== 'authenticated' || !plantaActiva) throw fallo(403, 'Seleccione una sede antes de consultar el Dashboard.');
    const usuario = (await executor.query('SELECT perfil_id, estado FROM fg_usuario WHERE username=$1', [username])).rows[0];
    if (!usuario) throw fallo(401, 'El usuario no existe.');
    if (!usuario.estado) throw fallo(403, 'Usuario inactivo.');
    // El token no puede conservar un perfil administrativo que ya fue retirado.
    req.user = { ...req.user, perfil_id: usuario.perfil_id };
    const query = req.query || {};
    if (query.desde || query.hasta) {
        const fechas = validarRangoFechasDashboard(query.desde || query.hasta, query.hasta || query.desde);
        if (!fechas.valido) throw Object.assign(fallo(400, fechas.mensaje), { codigo: fechas.codigo, fechaMaximaPermitida: fechas.fechaMaximaPermitida });
    }
    const permisos = (await executor.query(`SELECT pp.permiso_clave FROM fg_perfil_permiso pp
        JOIN fg_permiso p ON p.clave=pp.permiso_clave AND p.activo=TRUE WHERE pp.perfil_clave=$1`, [usuario.perfil_id])).rows;
    const permisosClaves = permisos.map(p => p.permiso_clave);
    req.user = { ...req.user, faregas_permisos_efectivos: new Set(permisosClaves) };
    const tieneAccesoDashboard = tienePermisoFaregas(permisosClaves, 'MENU_DASHBOARD');
    if (!tieneAccesoDashboard) throw fallo(403, 'No tiene permiso para consultar el Dashboard.');
    const global = tienePermisoFaregas(permisosClaves, 'DASHBOARD_GLOBAL');
    const plantas = await accesoSedes.obtenerPlantasAutorizadas(executor, { username, perfilId: usuario.perfil_id });
    const autorizadas = plantas.map(p => String(p.key));
    if (!autorizadas.includes(String(plantaActiva))) throw fallo(403, 'Sede activa no autorizada para el usuario.');
    const alcance = String(query.alcance || (global ? 'GLOBAL' : 'SEDE')).toUpperCase();
    if (!['GLOBAL','SEDE'].includes(alcance)) throw fallo(400, 'Alcance de Dashboard inválido.');
    if (!global && alcance === 'GLOBAL') throw fallo(403, 'No tiene permiso DASHBOARD_GLOBAL para consultar alcance global.');
    const lista = query.plantas === undefined ? [] : (Array.isArray(query.plantas) ? query.plantas : String(query.plantas).split(',')).map(x=>String(x).trim()).filter(Boolean);
    const seleccion = query.plantaKey ? [String(query.plantaKey)] : lista;
    // No ignorar silenciosamente filtros de sedes ajenas, tampoco en GLOBAL.
    const disponibles = global ? autorizadas : [String(plantaActiva)];
    if ([...seleccion, ...lista].some(p=>!disponibles.includes(p))) throw fallo(403, 'No tiene autorización para consultar alguna de las sedes solicitadas.');
    const filtro = seleccion.length ? [...new Set(seleccion)] : (alcance === 'SEDE' ? [String(plantaActiva)] : autorizadas);
    return { alcance, plantasAutorizadas: disponibles, plantasFiltro: filtro, plantaActiva };
}
module.exports = { resolverPlantasAutorizadas };
