const configService = require('../services/faregas-config.service');

const erroresConfiguracionServicio = new Set([
    'TIPO_FLUJO_INVALIDO',
    'CERTIFICACION_REQUIERE_CERTIFICADO',
    'CERTIFICADO_BASE_INCOMPATIBLE',
    'CERTIFICADO_BASE_NO_DISPONIBLE',
    'SERVICIO_COMPLEMENTARIO_NO_GENERA_CERTIFICADO',
    'CATEGORIA_NO_DISPONIBLE'
]);

const textoOpcional = (value) => {
    const texto = String(value || '').trim();
    return texto || null;
};

exports.getEmpresas = async (_req, res) => {
    try {
        res.json({ success: true, empresas: await configService.getEmpresas() });
    } catch (_error) {
        res.status(500).json({ success: false, message: 'Error al obtener empresas.' });
    }
};

exports.getSedesEmpresas = async (_req, res) => {
    try {
        res.json({ success: true, sedes: await configService.getSedes() });
    } catch (_error) {
        res.status(500).json({ success: false, message: 'Error al obtener las sedes de empresas.' });
    }
};

exports.crearEmpresa = async (req, res) => {
    try {
        const key = String(req.body.key || '').trim().toUpperCase();
        const nombre = String(req.body.nombre || '').trim();
        const ruc = textoOpcional(req.body.ruc);
        if (!/^[A-Z0-9_]{2,30}$/.test(key)) {
            return res.status(400).json({ success: false, message: 'El código debe tener entre 2 y 30 caracteres: letras, números o guion bajo.' });
        }
        if (!nombre) return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
        if (ruc && !/^\d{11}$/.test(ruc)) {
            return res.status(400).json({ success: false, message: 'El RUC debe contener exactamente 11 dígitos.' });
        }
        await configService.crearEmpresa({
            key, nombre, ruc,
            direccion: textoOpcional(req.body.direccion),
            telefono: textoOpcional(req.body.telefono),
            cuenta_banco_nacion: textoOpcional(req.body.cuenta_banco_nacion)
        }, req.user.username, req.ip);
        res.status(201).json({ success: true, message: 'Empresa creada exitosamente.' });
    } catch (error) {
        const status = error.message === 'EMPRESA_DUPLICADA' ? 409 : 500;
        res.status(status).json({ success: false, message: status === 409 ? 'Ya existe una empresa con ese código o RUC.' : (error.message || 'Error al crear empresa.') });
    }
};

exports.editarEmpresa = async (req, res) => {
    try {
        const nombre = String(req.body.nombre || '').trim();
        const ruc = textoOpcional(req.body.ruc);
        if (!nombre) return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
        if (ruc && !/^\d{11}$/.test(ruc)) {
            return res.status(400).json({ success: false, message: 'El RUC debe contener exactamente 11 dígitos.' });
        }
        await configService.editarEmpresa(req.params.key, {
            nombre,
            ruc,
            direccion: textoOpcional(req.body.direccion),
            telefono: textoOpcional(req.body.telefono),
            cuenta_banco_nacion: textoOpcional(req.body.cuenta_banco_nacion)
        }, req.user.username, req.ip);
        res.json({ success: true, message: 'Empresa actualizada exitosamente.' });
    } catch (error) {
        const status = error.message === 'EMPRESA_NO_ENCONTRADA' ? 404 : 500;
        res.status(status).json({ success: false, message: status === 404 ? 'Empresa no encontrada.' : (error.message || 'Error al editar empresa.') });
    }
};

exports.cambiarEstadoEmpresa = async (req, res) => {
    try {
        if (typeof req.body.activo !== 'boolean') {
            return res.status(400).json({ success: false, message: 'Estado inválido.' });
        }
        await configService.cambiarEstadoEmpresa(
            req.params.key,
            req.body.activo,
            req.user.username,
            req.ip
        );
        res.json({
            success: true,
            message: `Empresa ${req.body.activo ? 'activada' : 'desactivada'} exitosamente.`
        });
    } catch (error) {
        const mapa = {
            EMPRESA_NO_ENCONTRADA: [404, 'Empresa no encontrada.']
        };
        const [status, message] = mapa[error.message] || [500, error.message || 'Error al cambiar el estado de la empresa.'];
        res.status(status).json({ success: false, message });
    }
};

exports.asignarEmpresaSede = async (req, res) => {
    try {
        const empresaKey = String(req.body.empresa_key || '').trim().toUpperCase();
        if (!empresaKey) return res.status(400).json({ success: false, message: 'La empresa es obligatoria.' });
        await configService.asignarEmpresaSede(req.params.key, empresaKey, req.user.username, req.ip);
        res.json({ success: true, message: 'Empresa asignada a la sede exitosamente.' });
    } catch (error) {
        const mapa = {
            SEDE_NO_ENCONTRADA: [404, 'Sede no encontrada.'],
            EMPRESA_NO_DISPONIBLE: [409, 'La empresa no existe o está inactiva.']
        };
        const [status, message] = mapa[error.message] || [500, error.message || 'Error al asignar empresa.'];
        res.status(status).json({ success: false, message });
    }
};

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
        const { codigo, nombre, categoria_id, tipo_flujo, requiere_certificado, tipo_certificado_clave, modalidad, requiere_vehiculo, orden } = req.body;
        
        if (!codigo || !nombre || !Number.isInteger(Number(categoria_id)) || Number(categoria_id) <= 0) {
            return res.status(400).json({ success: false, message: 'Código, nombre y categoría son obligatorios.' });
        }

        const data = {
            codigo: codigo.toUpperCase().replace(/\s+/g, '_'),
            nombre,
            categoria_id: Number(categoria_id),
            tipo_flujo,
            requiere_certificado: !!requiere_certificado,
            tipo_certificado_clave: requiere_certificado ? tipo_certificado_clave : null,
            modalidad: requiere_certificado ? modalidad : null,
            requiere_vehiculo: !!requiere_vehiculo,
            orden: orden || 0
        };

        await configService.crearServicio(data, req.user.username, req.ip);
        res.json({ success: true, message: 'Servicio creado exitosamente.' });
    } catch (error) {
        const status = erroresConfiguracionServicio.has(error.message) ? 400 : 500;
        res.status(status).json({ success: false, message: error.message || 'Error al crear servicio.' });
    }
};

exports.editarServicio = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, categoria_id, tipo_flujo, requiere_certificado, tipo_certificado_clave, modalidad, requiere_vehiculo, orden } = req.body;
        
        if (!nombre || !Number.isInteger(Number(categoria_id)) || Number(categoria_id) <= 0) {
            return res.status(400).json({ success: false, message: 'El nombre y la categoría son obligatorios.' });
        }

        const data = {
            nombre,
            categoria_id: Number(categoria_id),
            tipo_flujo,
            requiere_certificado: !!requiere_certificado,
            tipo_certificado_clave: requiere_certificado ? tipo_certificado_clave : null,
            modalidad: requiere_certificado ? modalidad : null,
            requiere_vehiculo: !!requiere_vehiculo,
            orden: orden || 0
        };

        await configService.editarServicio(id, data, req.user.username, req.ip);
        res.json({ success: true, message: 'Servicio actualizado exitosamente.' });
    } catch (error) {
        const status = erroresConfiguracionServicio.has(error.message) ? 400 : 500;
        res.status(status).json({ success: false, message: error.message || 'Error al editar servicio.' });
    }
};

// CATEGORÍAS

exports.getCategorias = async (req, res) => {
    try {
        const soloActivas = req.query.activas === 'true';
        const categorias = await configService.getCategorias({ soloActivas });
        res.json({ success: true, categorias });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener categorías.' });
    }
};

exports.crearCategoria = async (req, res) => {
    try {
        const { codigo, nombre, descripcion, orden } = req.body;
        if (!codigo || !nombre) {
            return res.status(400).json({ success: false, message: 'Código y nombre son obligatorios.' });
        }
        const data = {
            codigo: String(codigo).trim().toUpperCase().replace(/\s+/g, '_'),
            nombre: String(nombre).trim(),
            descripcion: descripcion ? String(descripcion).trim() : null,
            orden: Number.isFinite(Number(orden)) ? Number(orden) : 0
        };
        if (!/^[A-Z0-9_]+$/.test(data.codigo)) {
            return res.status(400).json({ success: false, message: 'El código solo admite letras, números y guion bajo.' });
        }
        const id = await configService.crearCategoria(data, req.user.username, req.ip);
        res.status(201).json({ success: true, id, message: 'Categoría creada exitosamente.' });
    } catch (error) {
        res.status(409).json({ success: false, message: error.message || 'Error al crear categoría.' });
    }
};

exports.editarCategoria = async (req, res) => {
    try {
        const { nombre, descripcion, orden } = req.body;
        if (!nombre) {
            return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
        }
        await configService.editarCategoria(Number(req.params.id), {
            nombre: String(nombre).trim(),
            descripcion: descripcion ? String(descripcion).trim() : null,
            orden: Number.isFinite(Number(orden)) ? Number(orden) : 0
        }, req.user.username, req.ip);
        res.json({ success: true, message: 'Categoría actualizada exitosamente.' });
    } catch (error) {
        res.status(409).json({ success: false, message: error.message || 'Error al editar categoría.' });
    }
};

exports.cambiarEstadoCategoria = async (req, res) => {
    try {
        const { activo } = req.body;
        if (typeof activo !== 'boolean') {
            return res.status(400).json({ success: false, message: 'Estado inválido.' });
        }
        await configService.cambiarEstadoCategoria(
            Number(req.params.id), activo, req.user.username, req.ip
        );
        res.json({ success: true, message: `Categoría ${activo ? 'activada' : 'desactivada'} exitosamente.` });
    } catch (error) {
        res.status(409).json({ success: false, message: error.message || 'Error al cambiar estado de categoría.' });
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
