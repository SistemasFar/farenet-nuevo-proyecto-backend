const configService = require('../services/faregas-config.service');

exports.getSedes = async (req, res) => {
    try {
        const sedes = await configService.getSedes();
        res.json({ success: true, sedes });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener sedes.' });
    }
};

exports.crearSede = async (req, res) => {
    try {
        const { key, nombre, direccion, telefono } = req.body;
        if (!key || !nombre) return res.status(400).json({ success: false, message: 'Código y nombre son obligatorios.' });
        
        await configService.crearSede({ key, nombre, direccion, telefono }, req.user.username, req.ip);
        res.json({ success: true, message: 'Sede creada exitosamente (Inactiva por defecto).' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Error al crear sede.' });
    }
};

exports.editarSede = async (req, res) => {
    try {
        const { key } = req.params;
        const { nombre, direccion, telefono } = req.body;
        if (!nombre) return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
        
        await configService.editarSede(key, { nombre, direccion, telefono }, req.user.username, req.ip);
        res.json({ success: true, message: 'Sede actualizada exitosamente.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Error al editar sede.' });
    }
};

exports.cambiarEstadoSede = async (req, res) => {
    try {
        const { key } = req.params;
        const { activo } = req.body;
        if (typeof activo !== 'boolean') return res.status(400).json({ success: false, message: 'Estado inválido.' });
        
        await configService.cambiarEstadoSede(key, activo, req.user.username, req.ip);
        res.json({ success: true, message: `Sede ${activo ? 'activada' : 'desactivada'} exitosamente.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Error al cambiar estado.' });
    }
};

// SERVICIOS

exports.getServicios = async (req, res) => {
    try {
        const servicios = await configService.getServicios();
        res.json({ success: true, servicios });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener servicios.' });
    }
};

exports.crearServicio = async (req, res) => {
    try {
        const { codigo, nombre, familia, requiere_certificado, tipo_certificado_clave, modalidad, requiere_vehiculo, orden } = req.body;
        
        if (!codigo || !nombre || !familia) {
            return res.status(400).json({ success: false, message: 'Código, nombre y familia son obligatorios.' });
        }

        const data = {
            codigo: codigo.toUpperCase().replace(/\s+/g, '_'),
            nombre,
            familia,
            requiere_certificado: !!requiere_certificado,
            tipo_certificado_clave: requiere_certificado ? tipo_certificado_clave : null,
            modalidad: requiere_certificado ? modalidad : null,
            requiere_vehiculo: !!requiere_vehiculo,
            orden: orden || 0
        };

        await configService.crearServicio(data, req.user.username, req.ip);
        res.json({ success: true, message: 'Servicio creado exitosamente.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Error al crear servicio.' });
    }
};

exports.editarServicio = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, familia, requiere_certificado, tipo_certificado_clave, modalidad, requiere_vehiculo, orden } = req.body;
        
        if (!nombre || !familia) {
            return res.status(400).json({ success: false, message: 'El nombre y familia son obligatorios.' });
        }

        const data = {
            nombre,
            familia,
            requiere_certificado: !!requiere_certificado,
            tipo_certificado_clave: requiere_certificado ? tipo_certificado_clave : null,
            modalidad: requiere_certificado ? modalidad : null,
            requiere_vehiculo: !!requiere_vehiculo,
            orden: orden || 0
        };

        await configService.editarServicio(id, data, req.user.username, req.ip);
        res.json({ success: true, message: 'Servicio actualizado exitosamente.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Error al editar servicio.' });
    }
};

exports.cambiarEstadoServicio = async (req, res) => {
    try {
        const { id } = req.params;
        const { activo } = req.body;
        if (typeof activo !== 'boolean') return res.status(400).json({ success: false, message: 'Estado inválido.' });
        
        await configService.cambiarEstadoServicio(id, activo, req.user.username, req.ip);
        res.json({ success: true, message: `Servicio ${activo ? 'activado' : 'desactivado'} exitosamente.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Error al cambiar estado de servicio.' });
    }
};
