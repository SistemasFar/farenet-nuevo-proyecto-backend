const dashboardService = require('../services/faregas-dashboard.service');
const reporteFinancieroService = require('../services/faregas-reporte-financiero.service');
const documentosEmitidosExtendidoService = require('../services/faregas-documentos-emitidos-extendido.service');
const resumenMensualFacturacionService = require('../services/faregas-resumen-mensual-facturacion.service');
const registroVentasTributarioService = require('../services/faregas-registro-ventas-tributario.service');
const { tienePermisoFaregas } = require('../services/faregas-autorizacion-permisos.service');

const { resolverPlantasAutorizadas } = require('../services/faregas-dashboard-acceso.service');

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
        
        // Los permisos efectivos vigentes fueron cargados por el servicio
        // central de acceso, incluyendo el estado activo del catálogo.
        const puedeExportar = tienePermisoFaregas(req.user?.faregas_permisos_efectivos, 'DASHBOARD_EXPORTAR');
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

exports.obtenerReporteFinanciero = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        if (!tienePermisoFaregas(req.user?.faregas_permisos_efectivos, 'DASHBOARD_EXPORTAR')) {
            return res.status(403).json({ success: false, message: 'No tiene permiso para exportar reportes del Dashboard.' });
        }

        const { desde, hasta } = req.query;
        const data = await reporteFinancieroService.obtenerReporteFinanciero({
            plantasAutorizadas, plantasFiltro, desde, hasta, username: req.user.username
        });
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerReporteFinanciero');
    }
};

exports.obtenerDocumentosEmitidosExtendido = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        if (!tienePermisoFaregas(req.user?.faregas_permisos_efectivos, 'DASHBOARD_EXPORTAR')) {
            return res.status(403).json({ success: false, message: 'No tiene permiso para exportar reportes del Dashboard.' });
        }

        const { desde, hasta } = req.query;
        const data = await documentosEmitidosExtendidoService.obtenerDocumentosEmitidosExtendido({
            plantasAutorizadas, plantasFiltro, desde, hasta
        });
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerDocumentosEmitidosExtendido');
    }
};

exports.obtenerResumenMensualFacturacion = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        if (!tienePermisoFaregas(req.user?.faregas_permisos_efectivos, 'DASHBOARD_EXPORTAR')) {
            return res.status(403).json({ success: false, message: 'No tiene permiso para exportar reportes del Dashboard.' });
        }
        const { desde, hasta } = req.query;
        const data = await resumenMensualFacturacionService.obtenerResumenMensualFacturacion({
            plantasAutorizadas, plantasFiltro, desde, hasta
        });
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerResumenMensualFacturacion');
    }
};

exports.obtenerRegistroVentasTributario = async (req, res) => {
    try {
        const { plantasAutorizadas, plantasFiltro } = await resolverPlantasAutorizadas(req);
        if (!tienePermisoFaregas(req.user?.faregas_permisos_efectivos, 'DASHBOARD_EXPORTAR')) {
            return res.status(403).json({ success: false, message: 'No tiene permiso para exportar reportes del Dashboard.' });
        }
        const { desde, hasta } = req.query;
        const data = await registroVentasTributarioService.obtenerRegistroVentasTributario({ plantasAutorizadas, plantasFiltro, desde, hasta });
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return manejarErrorDashboard(res, error, 'obtenerRegistroVentasTributario');
    }
};
