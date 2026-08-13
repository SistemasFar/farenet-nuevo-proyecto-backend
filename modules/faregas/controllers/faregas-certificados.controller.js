const service = require('../services/faregas-certificados.service');

exports.obtenerTipos = async (req, res) => {
    try {
        const data = await service.obtenerTiposActivos();
        res.json({ ok: true, data });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.obtenerCorrelativos = async (req, res) => {
    try {
        const filters = {
            plantaKey: req.query.plantaKey,
            tipo: req.query.tipo
        };
        const data = await service.obtenerCorrelativos(filters);
        res.json({ ok: true, data });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.obtenerRangoActivo = async (req, res) => {
    try {
        const { plantaKey, tipo } = req.params;
        const data = await service.obtenerRangoActivo(plantaKey, tipo);
        res.json({ ok: true, data });
    } catch (e) {
        if (e.message === 'RANGO_NOT_FOUND') {
            return res.status(404).json({ ok: false, message: 'No existe un rango activo configurado para la planta y tipo de certificado.' });
        }
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.crearRango = async (req, res) => {
    try {
        const { plantaKey, tipoCertificadoClave, nroInicio, nroMaximo } = req.body;
        
        if (!plantaKey) return res.status(400).json({ ok: false, message: 'plantaKey es obligatorio' });
        if (!tipoCertificadoClave) return res.status(400).json({ ok: false, message: 'tipoCertificadoClave es obligatorio' });
        if (nroInicio === undefined || nroInicio === null) return res.status(400).json({ ok: false, message: 'nroInicio es obligatorio' });
        if (nroMaximo === undefined || nroMaximo === null) return res.status(400).json({ ok: false, message: 'nroMaximo es obligatorio' });
        
        if (!Number.isInteger(nroInicio) || nroInicio <= 0) return res.status(400).json({ ok: false, message: 'nroInicio debe ser entero > 0' });
        if (!Number.isInteger(nroMaximo)) return res.status(400).json({ ok: false, message: 'nroMaximo debe ser entero' });
        if (nroMaximo < nroInicio) return res.status(400).json({ ok: false, message: 'nroMaximo debe ser mayor o igual a nroInicio' });
        
        const result = await service.crearRango(req.body);
        res.status(201).json({ ok: true, data: result });
    } catch (e) {
        if (e.message === 'PLANTA_NOT_FOUND') return res.status(404).json({ ok: false, message: 'La planta indicada no existe' });
        if (e.message === 'TIPO_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El tipo de certificado indicado no existe' });
        if (e.message === 'TIPO_INACTIVO') return res.status(400).json({ ok: false, message: 'El tipo de certificado está inactivo' });
        if (e.message === 'RANGO_ACTIVO_EXISTENTE') return res.status(409).json({ ok: false, message: 'Ya existe un rango activo para esta planta y tipo de certificado.' });
        if (e.message === 'RANGO_SOLAPADO') return res.status(409).json({ ok: false, message: 'El rango ingresado se cruza con un rango histórico existente para esta planta y tipo de certificado.' });
        if (e.message === 'RANGO_DUPLICADO') return res.status(409).json({ ok: false, message: 'Ya existe exactamente el mismo rango histórico (mismo inicio y máximo).' });
        
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.cerrarRango = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await service.cerrarRango(id);
        res.json({ ok: true, message: result.message });
    } catch (e) {
        if (e.message === 'RANGO_NOT_FOUND') {
            return res.status(404).json({ ok: false, message: 'El rango indicado no existe' });
        }
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

// ============================================
// FASE 3: BORRADORES DE CERTIFICADOS
// ============================================

exports.crearBorrador = async (req, res) => {
    try {
        const { tipoCertificadoClave, clienteId, observaciones } = req.body;
        if (!tipoCertificadoClave) return res.status(400).json({ ok: false, message: 'tipoCertificadoClave es obligatorio' });
        
        const data = await service.crearBorrador(req.body, req.user);
        res.status(201).json({ ok: true, data });
    } catch (e) {
        if (e.message === 'TIPO_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El tipo de certificado indicado no existe' });
        if (e.message === 'TIPO_INACTIVO') return res.status(400).json({ ok: false, message: 'El tipo de certificado está inactivo' });
        if (e.message === 'CLIENTE_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El cliente indicado no existe' });
        if (e.message === 'CLIENTE_INACTIVO') return res.status(400).json({ ok: false, message: 'El cliente está inactivo' });
        
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.obtenerBorradorCompleto = async (req, res) => {
    try {
        const { id } = req.params;
        const data = await service.obtenerBorradorCompleto(id, req.user);
        res.status(200).json({ ok: true, data });
    } catch (e) {
        if (e.message === 'CERTIFICADO_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El certificado indicado no existe' });
        if (e.message === 'PLANTA_NO_AUTORIZADA') return res.status(403).json({ ok: false, message: 'No tiene acceso a la planta de este certificado.' });
        
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.actualizarBorrador = async (req, res) => {
    try {
        const { id } = req.params;
        await service.actualizarBorrador(id, req.body, req.user);
        res.status(200).json({ ok: true, message: 'Borrador actualizado correctamente' });
    } catch (e) {
        if (e.message === 'CERTIFICADO_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El certificado indicado no existe' });
        if (e.message === 'PLANTA_NO_AUTORIZADA') return res.status(403).json({ ok: false, message: 'No tiene acceso a la planta de este certificado.' });
        if (e.message === 'CERTIFICADO_NO_EDITABLE') return res.status(409).json({ ok: false, message: 'El certificado ya no se encuentra en estado BORRADOR.' });
        if (e.message === 'TIPO_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El tipo de certificado indicado no existe' });
        if (e.message === 'TIPO_INACTIVO') return res.status(400).json({ ok: false, message: 'El tipo de certificado está inactivo' });
        
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.guardarVehiculoBorrador = async (req, res) => {
    try {
        const { id } = req.params;
        await service.guardarVehiculoBorrador(id, req.body, req.user);
        res.status(200).json({ ok: true, message: 'Snapshot vehicular guardado correctamente' });
    } catch (e) {
        if (e.message === 'CERTIFICADO_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El certificado indicado no existe' });
        if (e.message === 'PLANTA_NO_AUTORIZADA') return res.status(403).json({ ok: false, message: 'No tiene acceso a la planta de este certificado.' });
        if (e.message === 'CERTIFICADO_NO_EDITABLE') return res.status(409).json({ ok: false, message: 'El certificado ya no se encuentra en estado BORRADOR.' });
        
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.agregarTitular = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombreRazonSocial, orden } = req.body;
        if (!nombreRazonSocial) return res.status(400).json({ ok: false, message: 'nombreRazonSocial es obligatorio' });
        if (orden === undefined || orden === null || !Number.isInteger(orden) || orden <= 0) return res.status(400).json({ ok: false, message: 'orden debe ser entero > 0' });

        const titularId = await service.agregarTitular(id, req.body, req.user);
        res.status(201).json({ ok: true, data: { id: titularId } });
    } catch (e) {
        if (e.message === 'CERTIFICADO_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El certificado indicado no existe' });
        if (e.message === 'PLANTA_NO_AUTORIZADA') return res.status(403).json({ ok: false, message: 'No tiene acceso a la planta de este certificado.' });
        if (e.message === 'CERTIFICADO_NO_EDITABLE') return res.status(409).json({ ok: false, message: 'El certificado ya no se encuentra en estado BORRADOR.' });
        if (e.message === 'CLIENTE_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El cliente indicado no existe' });
        if (e.message === 'ORDEN_TITULAR_DUPLICADO') return res.status(409).json({ ok: false, message: 'Ya existe un titular con ese orden en el certificado.' });
        
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.actualizarTitular = async (req, res) => {
    try {
        const { id, titularId } = req.params;
        await service.actualizarTitular(id, titularId, req.body, req.user);
        res.status(200).json({ ok: true, message: 'Titular actualizado correctamente' });
    } catch (e) {
        if (e.message === 'CERTIFICADO_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El certificado indicado no existe' });
        if (e.message === 'TITULAR_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El titular indicado no existe' });
        if (e.message === 'PLANTA_NO_AUTORIZADA') return res.status(403).json({ ok: false, message: 'No tiene acceso a la planta de este certificado.' });
        if (e.message === 'CERTIFICADO_NO_EDITABLE') return res.status(409).json({ ok: false, message: 'El certificado ya no se encuentra en estado BORRADOR.' });
        if (e.message === 'CLIENTE_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El cliente indicado no existe' });
        if (e.message === 'ORDEN_TITULAR_DUPLICADO') return res.status(409).json({ ok: false, message: 'Ya existe un titular con ese orden en el certificado.' });
        
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.eliminarTitular = async (req, res) => {
    try {
        const { id, titularId } = req.params;
        await service.eliminarTitular(id, titularId, req.user);
        res.status(200).json({ ok: true, message: 'Titular eliminado correctamente' });
    } catch (e) {
        if (e.message === 'CERTIFICADO_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El certificado indicado no existe' });
        if (e.message === 'TITULAR_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El titular indicado no existe' });
        if (e.message === 'PLANTA_NO_AUTORIZADA') return res.status(403).json({ ok: false, message: 'No tiene acceso a la planta de este certificado.' });
        if (e.message === 'CERTIFICADO_NO_EDITABLE') return res.status(409).json({ ok: false, message: 'El certificado ya no se encuentra en estado BORRADOR.' });
        
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};
