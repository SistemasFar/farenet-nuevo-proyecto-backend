const dashboardService = require('../services/faregas-dashboard.service');
const faregasAuthService = require('../services/faregas-auth.service');
const db = require('../../../config/database');
const { validarRangoFechasDashboard } = require('../services/faregas-dashboard-fechas.service');

/**
 * Resuelve las plantas autorizadas para el usuario y valida el alcance (GLOBAL vs SEDE)
 */
async function resolverPlantasAutorizadas(req) {
    const { username, perfil_id, planta_key } = req.user;
    
    // Validación de rango de fechas si se envían en la consulta
    const { desde, hasta } = req.query || {};
    if (desde || hasta) {
        const valFechas = validarRangoFechasDashboard(desde || hasta, hasta || desde);
        if (!valFechas.valido) {
            const error = new Error(valFechas.mensaje);
            error.status = 400;
            error.codigo = valFechas.codigo;
            error.fechaMaximaPermitida = valFechas.fechaMaximaPermitida;
            throw error;
        }
    }
    
    // 1. Obtener permisos del perfil en base de datos
    const rPerms = await db.query(
        'SELECT permiso_clave FROM fg_perfil_permiso WHERE perfil_clave = $1',
        [perfil_id]
    );
    const permisos = rPerms.rows.map(r => r.permiso_clave);
    
    const esSupervisor = perfil_id === 'SUPERVISOR';
    const tieneGlobal = permisos.includes('DASHBOARD_GLOBAL') || perfil_id === 'SISTEMAS';
    const tieneSede = permisos.includes('DASHBOARD_SEDE') || tieneGlobal || esSupervisor;
    
    if (!tieneGlobal && !tieneSede) {
        const error = new Error('No tiene permisos para acceder al Dashboard.');
        error.status = 403;
        throw error;
    }
    
    // 2. Obtener todas las plantas autorizadas para el usuario
    const plantasAsignadas = await faregasAuthService.getPlantasPorUsuario(username, perfil_id);
    const keysAutorizadas = plantasAsignadas.map(p => p.key);
    
    // 3. Evaluar el alcance solicitado (query param: alcance=GLOBAL|SEDE, plantaKey, plantas)
    const alcanceSolicitado = (req.query.alcance || (tieneGlobal ? 'GLOBAL' : 'SEDE')).toUpperCase();
    const plantaSolicitada = req.query.plantaKey;
    const plantasSolicitadasRaw = req.query.plantas;
    
    // Si no tiene permiso global pero pide GLOBAL -> 403
    if (!tieneGlobal && alcanceSolicitado === 'GLOBAL' && req.query.alcance && req.query.alcance.toUpperCase() === 'GLOBAL') {
        const error = new Error('No tiene permiso DASHBOARD_GLOBAL para consultar alcance global.');
        error.status = 403;
        throw error;
    }
    
    // Si no tiene permiso global -> forzado a su sede de sesión activa
    if (!tieneGlobal) {
        if (plantaSolicitada && plantaSolicitada !== planta_key) {
            const error = new Error('No tiene autorización para consultar otra sede.');
            error.status = 403;
            throw error;
        }
        // Validar acceso estricto con el servicio auth
        const plantaValida = await faregasAuthService.validarAccesoPlanta(username, perfil_id, planta_key);
        if (!plantaValida) {
            const error = new Error('Sede activa no autorizada para el usuario.');
            error.status = 403;
            throw error;
        }
        return {
            alcance: 'SEDE',
            plantasAutorizadas: [planta_key],
            plantasFiltro: [planta_key],
            plantaActiva: planta_key
        };
    }
    
    // Usuario con permiso global:
    let plantasFiltro = null;
    if (alcanceSolicitado === 'SEDE' || plantaSolicitada) {
        const pKey = plantaSolicitada || planta_key;
        if (!keysAutorizadas.includes(pKey)) {
            const error = new Error(`La sede ${pKey} no está entre sus sedes autorizadas.`);
            error.status = 403;
            throw error;
        }
        plantasFiltro = [pKey];
    } else if (plantasSolicitadasRaw) {
        const listaSolicitada = Array.isArray(plantasSolicitadasRaw)
            ? plantasSolicitadasRaw
            : String(plantasSolicitadasRaw).split(',').map(s => s.trim()).filter(Boolean);
            
        const intersectadas = listaSolicitada.filter(k => keysAutorizadas.includes(k));
        if (intersectadas.length === 0) {
            const error = new Error('Ninguna de las sedes solicitadas está autorizada.');
            error.status = 403;
            throw error;
        }
        plantasFiltro = intersectadas;
    }
    
    return {
        alcance: alcanceSolicitado,
        plantasAutorizadas: keysAutorizadas,
        plantasFiltro,
        plantaActiva: planta_key
    };
}

function manejarErrorDashboard(res, error, contexto) {
    console.error(`Error en dashboard.${contexto}:`, error);
    const status = error.status || 500;
    const body = {
        success: false,
        message: error.message
    };
    if (error.codigo) body.codigo = error.codigo;
    if (error.fechaMaximaPermitida) body.fechaMaximaPermitida = error.fechaMaximaPermitida;
    return res.status(status).json(body);
}

exports.obtenerResumen = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, tipoCertificado, tipoDuplicado, productoId } = req.query;
        
        const data = await dashboardService.obtenerResumenDashboard({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            tipoCertificado,
            tipoDuplicado,
            productoId: productoId ? Number(productoId) : undefined
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerResumen');
    }
};

exports.obtenerSedes = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, tipoCertificado, tipoDuplicado, productoId } = req.query;
        
        const plantasAConsultar = plantasFiltro || plantasAutorizadas;
        const data = await dashboardService.obtenerDetalleSedes({
            plantasAutorizadas: plantasAConsultar,
            desde,
            hasta,
            tipoCertificado,
            tipoDuplicado,
            productoId: productoId ? Number(productoId) : undefined
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerSedes');
    }
};

exports.obtenerCertificados = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, pagina, limite, estado, tipoCertificado, usuario } = req.query;
        
        const data = await dashboardService.obtenerDetalleCertificados({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            pagina,
            limite,
            estado,
            tipoCertificado,
            usuario
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerCertificados');
    }
};

exports.obtenerDuplicados = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, pagina, limite, tipoCertificado, tipoDuplicado } = req.query;

        const data = await dashboardService.obtenerDetalleDuplicados({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            pagina,
            limite,
            tipoCertificado,
            tipoDuplicado
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerDuplicados');
    }
};

exports.obtenerProductos = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, pagina, limite, productoId } = req.query;
        
        const data = await dashboardService.obtenerDetalleProductos({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            pagina,
            limite,
            productoId: productoId ? Number(productoId) : undefined
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerProductos');
    }
};

exports.obtenerComprobantes = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, pagina, limite, tipoComprobante, estado } = req.query;
        
        const data = await dashboardService.obtenerDetalleComprobantes({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            pagina,
            limite,
            tipoComprobante,
            estado
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerComprobantes');
    }
};

exports.obtenerPagos = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, pagina, limite, medioPago } = req.query;
        
        const data = await dashboardService.obtenerDetallePagos({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            pagina,
            limite,
            medioPago
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerPagos');
    }
};

exports.obtenerDescuentos = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, pagina, limite } = req.query;
        
        const data = await dashboardService.obtenerDetalleDescuentos({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            pagina,
            limite
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerDescuentos');
    }
};

exports.obtenerUsuarios = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, productoId } = req.query;
        
        const data = await dashboardService.obtenerDetalleUsuarios({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            productoId: productoId ? Number(productoId) : undefined
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerUsuarios');
    }
};

exports.obtenerExportacion = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, tipoCertificado, tipoDuplicado } = req.query;
        
        // Verificar permiso explícito de exportación
        const rPerms = await db.query(
            'SELECT 1 FROM fg_perfil_permiso WHERE perfil_clave = $1 AND permiso_clave = \'DASHBOARD_EXPORTAR\'',
            [req.user.perfil_id]
        );
        const puedeExportar = rPerms.rowCount > 0 || req.user.perfil_id === 'SISTEMAS' || req.user.perfil_id === 'SUPERVISOR';
        if (!puedeExportar) {
            return res.status(403).json({ success: false, message: 'No tiene permiso para exportar reportes del Dashboard.' });
        }
        
        const data = await dashboardService.obtenerDatosExportacion({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            tipoCertificado,
            tipoDuplicado,
            username: req.user.username
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerExportacion');
    }
};
