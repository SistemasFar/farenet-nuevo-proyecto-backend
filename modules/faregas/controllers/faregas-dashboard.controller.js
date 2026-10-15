const dashboardService = require('../services/faregas-dashboard.service');
const faregasAuthService = require('../services/faregas-auth.service');
const db = require('../../../config/database');

/**
 * Resuelve las plantas autorizadas para el usuario y valida el alcance (GLOBAL vs SEDE)
 */
async function resolverPlantasAutorizadas(req) {
    const { username, perfil_id, planta_key } = req.user;
    
    // 1. Obtener permisos del perfil en base de datos
    const rPerms = await db.query(
        'SELECT permiso_clave FROM fg_perfil_permiso WHERE perfil_clave = $1',
        [perfil_id]
    );
    const permisos = rPerms.rows.map(r => r.permiso_clave);
    
    const tieneGlobal = permisos.includes('DASHBOARD_GLOBAL') || perfil_id === 'SISTEMAS';
    const tieneSede = permisos.includes('DASHBOARD_SEDE') || tieneGlobal;
    
    if (!tieneGlobal && !tieneSede) {
        const error = new Error('No tiene permisos para acceder al Dashboard.');
        error.status = 403;
        throw error;
    }
    
    // 2. Obtener todas las plantas autorizadas para el usuario
    const plantasAsignadas = await faregasAuthService.getPlantasPorUsuario(username, perfil_id);
    const keysAutorizadas = plantasAsignadas.map(p => p.key);
    
    // 3. Evaluar el alcance solicitado (query param: alcance=GLOBAL|SEDE, plantaKey, plantas)
    const alcanceSolicitado = (req.query.alcance || 'GLOBAL').toUpperCase();
    const plantaSolicitada = req.query.plantaKey;
    const plantasSolicitadasRaw = req.query.plantas;
    
    // Si no tiene permiso global pero pide GLOBAL -> 403
    if (!tieneGlobal && alcanceSolicitado === 'GLOBAL') {
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

exports.obtenerResumen = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, tipoCertificado } = req.query;
        
        const data = await dashboardService.obtenerResumenDashboard({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            tipoCertificado
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Error en dashboard.obtenerResumen:', error);
        return res.status(error.status || 500).json({ success: false, message: error.message });
    }
};

exports.obtenerSedes = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta } = req.query;
        
        const plantasAConsultar = plantasFiltro || plantasAutorizadas;
        const data = await dashboardService.obtenerDetalleSedes({
            plantasAutorizadas: plantasAConsultar,
            desde,
            hasta
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Error en dashboard.obtenerSedes:', error);
        return res.status(error.status || 500).json({ success: false, message: error.message });
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
        console.error('Error en dashboard.obtenerCertificados:', error);
        return res.status(error.status || 500).json({ success: false, message: error.message });
    }
};

exports.obtenerProductos = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta, pagina, limite } = req.query;
        
        const data = await dashboardService.obtenerDetalleProductos({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            pagina,
            limite
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Error en dashboard.obtenerProductos:', error);
        return res.status(error.status || 500).json({ success: false, message: error.message });
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
        console.error('Error en dashboard.obtenerComprobantes:', error);
        return res.status(error.status || 500).json({ success: false, message: error.message });
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
        console.error('Error en dashboard.obtenerPagos:', error);
        return res.status(error.status || 500).json({ success: false, message: error.message });
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
        console.error('Error en dashboard.obtenerDescuentos:', error);
        return res.status(error.status || 500).json({ success: false, message: error.message });
    }
};

exports.obtenerUsuarios = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta } = req.query;
        
        const data = await dashboardService.obtenerDetalleUsuarios({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Error en dashboard.obtenerUsuarios:', error);
        return res.status(error.status || 500).json({ success: false, message: error.message });
    }
};

exports.obtenerExportacion = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        const { desde, hasta } = req.query;
        
        // Verificar permiso explícito de exportación
        const rPerms = await db.query(
            'SELECT 1 FROM fg_perfil_permiso WHERE perfil_clave = $1 AND permiso_clave = \'DASHBOARD_EXPORTAR\'',
            [req.user.perfil_id]
        );
        if (rPerms.rowCount === 0 && req.user.perfil_id !== 'SISTEMAS') {
            return res.status(403).json({ success: false, message: 'No tiene permiso para exportar reportes del Dashboard.' });
        }
        
        const data = await dashboardService.obtenerDatosExportacion({
            plantasAutorizadas,
            plantasFiltro,
            desde,
            hasta,
            username: req.user.username
        });
        
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Error en dashboard.obtenerExportacion:', error);
        return res.status(error.status || 500).json({ success: false, message: error.message });
    }
};
