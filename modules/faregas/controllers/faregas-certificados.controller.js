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
        if (e.message === 'TARIFA_REQUERIDA') return res.status(400).json({ ok: false, message: 'tarifaCodigo es obligatorio' });
        if (e.message === 'TARIFA_NO_CONFIGURADA') return res.status(400).json({ ok: false, message: 'Tarifa no configurada para la sede actual' });
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

exports.obtenerCatalogoVerificaciones = async (req, res) => {
    try {
        const catalogo = {
            GNV_ANUAL: [
                { codigo: 'a', orden: 1, descripcion: 'El equipo completo instalado en el vehículo está compuesto con los elementos, partes o piezas registradas en la base de datos del sistema de control de carga de GNV.' },
                { codigo: 'b', orden: 2, descripcion: 'El cilindro y el Kit de montaje no han sido alterados ni se encuentran deteriorados por el uso, ni han sido cambiados.' },
                { codigo: 'c', orden: 3, descripcion: 'Cada uno de los componentes están instalados de manera segura, incluyendo las tuberías de alta y baja presión, y que dichos componentes están ubicados en los sitios originales.' },
                { codigo: 'd', orden: 4, descripcion: 'No existan fugas en los empalmes o uniones.' },
                { codigo: 'e', orden: 5, descripcion: 'Los elementos de cierre actúan herméticamente.' },
                { codigo: 'f', orden: 6, descripcion: 'El sistema de combustión a GNV responda a las características originales recomendadas por el fabricante del vehículo, o el Proveedor de Equipos Completos – PEC.' },
                { codigo: 'g', orden: 7, descripcion: 'Los controles ubicados en el tablero del vehículo responden a las exigencias para los cuales fueron montados.' },
                { codigo: 'h', orden: 8, descripcion: 'Las exigencias sobre ventilación en las distintas zonas de instalación no han sido alteradas, y demás exigencias establecidas por la normativa vigente en la materia.' }
            ],
            GLP_ANUAL: [
                { codigo: '1', orden: 1, descripcion: 'El sistema de combustión a GLP (cilindro y kit de conversión) responde a las características originales recomendadas por el fabricante del vehículo y/o el Proveedor de Equipos Completos de Conversión a GLP (PEC-GLP), cumple con la Norma Técnica Peruana NTP 321.115:2003 y su montaje cumple las exigencias sobre ventilación en las distintas zonas de la instalación.' },
                { codigo: '2', orden: 2, descripcion: 'El vaporizador/regulador cuenta con sistema de corte de gas automático, en caso que el motor deje de funcionar.' },
                { codigo: '3', orden: 3, descripcion: 'El tanque de almacenamiento de GLP ha sido fabricado bajo normas ASME Sección VIII y cumple con las normas dictadas para recipientes a presión, asimismo, cuenta con una válvula check en la entrada de gas, un limitador automático de carga al 80% , una válvula de exceso de presión y una válvula de exceso de flujo.' },
                { codigo: '4', orden: 4, descripcion: 'Los accesorios e insumos (mangueras, tuberías y válvulas) utilizados en la instalación han sido certificados para el uso de GLP y están instalados de manera segura.' },
                { codigo: '5', orden: 5, descripcion: 'Los equipos y accesorios utilizados en la modificación para uso de GLP cumplen con la Norma Técnica Peruana NTP 321.115:2003.' },
                { codigo: '6', orden: 6, descripcion: 'No existan fugas en los empalmes o uniones y los elementos de cierre actúan herméticamente.' },
                { codigo: '7', orden: 7, descripcion: 'Los controles ubicados en el tablero del vehículo responden a las exigencias para los cuales fueron montados.' }
            ]
        };
        res.json(catalogo);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
};

// ============================================
// FASE 3: BORRADORES DE CERTIFICADOS
// ============================================

exports.obtenerBorradores = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 10;
        const search = String(req.query.search || '').trim();
        const fechaDesde = String(req.query.fechaDesde || '').trim();
        const fechaHasta = String(req.query.fechaHasta || '').trim();
        const data = await service.obtenerBorradores(page, pageSize, search, req.user, { fechaDesde, fechaHasta });
        res.status(200).json({ ok: true, ...data });
    } catch (e) {
        if (e.message === 'FECHA_INVALIDA') return res.status(400).json({ ok: false, message: 'La fecha indicada no es válida.' });
        if (e.message === 'RANGO_FECHAS_INCOMPLETO') return res.status(400).json({ ok: false, message: 'Debe indicar las fechas Desde y Hasta.' });
        if (e.message === 'RANGO_FECHAS_INVALIDO') return res.status(400).json({ ok: false, message: 'La fecha Desde no puede ser posterior a la fecha Hasta.' });
        res.status(500).json({ ok: false, message: e.message });
    }
};

exports.crearBorrador = async (req, res) => {
    try {
        const { tarifaCodigo, clienteId, observaciones } = req.body;
        if (!tarifaCodigo) return res.status(400).json({ ok: false, message: 'tarifaCodigo es obligatorio' });
        
        const data = await service.crearBorrador(req.body, req.user);
        res.status(201).json({ ok: true, data });
    } catch (e) {
        if (e.message === 'TARIFA_REQUERIDA') return res.status(400).json({ ok: false, message: 'tarifaCodigo es obligatorio' });
        if (e.message === 'TARIFA_NO_CONFIGURADA') return res.status(400).json({ ok: false, message: 'Tarifa no configurada para la sede actual' });
        if (e.message === 'SERVICIO_NO_CERTIFICACION') return res.status(409).json({ ok: false, message: 'El servicio seleccionado no pertenece al flujo de certificación.' });
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
        if (e.message === 'DATOS_PREVIOS_NO_EDITABLES') return res.status(409).json({ ok: false, message: 'No se pueden modificar servicio o datos técnicos después de confirmar el pago o la facturación.' });
        if (e.message === 'TARIFA_REQUERIDA') return res.status(400).json({ ok: false, message: 'tarifaCodigo es obligatorio' });
        if (e.message === 'TARIFA_NO_CONFIGURADA') return res.status(400).json({ ok: false, message: 'Tarifa no configurada para la sede actual' });
        if (e.message === 'SERVICIO_NO_CERTIFICACION') return res.status(409).json({ ok: false, message: 'El servicio seleccionado no pertenece al flujo de certificación.' });
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
        if (e.message === 'DATOS_PREVIOS_NO_EDITABLES') return res.status(409).json({ ok: false, message: 'Los datos técnicos ya no se pueden modificar porque la facturación del certificado ya fue iniciada.' });
        
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

// ============================================
// FASE 4: DATOS ESPECÍFICOS DE CERTIFICADOS
// ============================================

// GNV
exports.guardarGNV = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await service.guardarGNV(req.params.id, req.body, userContext);
        res.json({ ok: true, message: 'Datos GNV guardados correctamente' });
    } catch (error) {
        console.error('Error en guardarGNV:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.guardarGNVComponentes = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await service.guardarGNVComponentes(req.params.id, req.body.componentes, userContext);
        res.json({ ok: true, message: 'Componentes GNV guardados' });
    } catch (error) {
        console.error('Error en guardarGNVComponentes:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.actualizarPasoBorrador = async (req, res) => {
    try {
        const data = await service.actualizarPasoBorrador(req.params.id, req.body.pasoActual, req.user);
        res.status(200).json({ ok: true, data });
    } catch (e) {
        if (e.message === 'CERTIFICADO_NOT_FOUND') return res.status(404).json({ ok: false, message: 'El certificado indicado no existe' });
        if (e.message === 'PLANTA_NO_AUTORIZADA') return res.status(403).json({ ok: false, message: 'No tiene acceso a la planta de este certificado.' });
        if (e.message === 'CERTIFICADO_NO_EDITABLE') return res.status(409).json({ ok: false, message: 'El certificado ya no se encuentra en estado BORRADOR.' });
        if (e.message === 'DATOS_PREVIOS_NO_EDITABLES') return res.status(409).json({ ok: false, message: 'Los datos técnicos ya no son editables después de confirmar el pago o la facturación.' });
        if (e.message === 'PASO_INVALIDO') return res.status(400).json({ ok: false, message: 'El paso indicado no es válido.' });
        if (e.message === 'TRANSICION_PASO_INVALIDA') return res.status(409).json({ ok: false, message: 'No se puede omitir un paso sin guardar el anterior.' });
        console.error(e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.guardarGNVVerificaciones = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await service.guardarGNVVerificaciones(req.params.id, req.body.verificaciones, userContext);
        res.json({ ok: true, message: 'Verificaciones GNV guardadas' });
    } catch (error) {
        console.error('Error en guardarGNVVerificaciones:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.obtenerGNV = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        const data = await service.obtenerGNV(req.params.id, userContext);
        res.json({ ok: true, data });
    } catch (error) {
        console.error('Error en obtenerGNV:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

// GLP
exports.guardarGLP = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await service.guardarGLP(req.params.id, req.body, userContext);
        res.json({ ok: true, message: 'Datos GLP guardados' });
    } catch (error) {
        console.error('Error en guardarGLP:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.guardarGLPComponentes = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await service.guardarGLPComponentes(req.params.id, req.body.componentes, userContext);
        res.json({ ok: true, message: 'Componentes GLP guardados' });
    } catch (error) {
        console.error('Error en guardarGLPComponentes:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.guardarGLPVerificaciones = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await service.guardarGLPVerificaciones(req.params.id, req.body.verificaciones, userContext);
        res.json({ ok: true, message: 'Verificaciones GLP guardadas' });
    } catch (error) {
        console.error('Error en guardarGLPVerificaciones:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.obtenerGLP = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        const data = await service.obtenerGLP(req.params.id, userContext);
        res.json({ ok: true, data });
    } catch (error) {
        console.error('Error en obtenerGLP:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

// CONFORMIDAD
exports.guardarConformidad = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await service.guardarConformidad(req.params.id, req.body, userContext);
        res.json({ ok: true, message: 'Datos Conformidad guardados' });
    } catch (error) {
        console.error('Error en guardarConformidad:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.obtenerConformidad = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        const data = await service.obtenerConformidad(req.params.id, userContext);
        res.json({ ok: true, data });
    } catch (error) {
        console.error('Error en obtenerConformidad:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

// TALLERES
exports.obtenerTalleresActivos = async (req, res) => {
    try {
        const data = await service.obtenerTalleresActivos();
        res.json({ ok: true, data });
    } catch (error) {
        console.error('Error en obtenerTalleresActivos:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};


exports.validarEmision = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await certificadosService.validarEmision(id, req.user);
        res.json({ ok: true, data: result });
    } catch (error) {
        if (error.message === 'CERTIFICADO_NOT_FOUND' || error.message === 'PLANTA_NO_AUTORIZADA') {
            return res.status(403).json({ ok: false, message: 'No autorizado o no encontrado' });
        }
        res.status(500).json({ ok: false, message: error.message });
    }
};

exports.emitir = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await certificadosService.emitirCertificado(id, req.user);
        res.json({ ok: true, data: result });
    } catch (error) {
        if (error.message === 'CERTIFICADO_NOT_FOUND' || error.message === 'PLANTA_NO_AUTORIZADA') {
            return res.status(403).json({ ok: false, message: 'No autorizado o no encontrado' });
        }
        if (['NO_VALIDO_PARA_EMISION', 'NO_EXISTE_RANGO_ACTIVO', 'RANGO_AGOTADO', 'FORMATO_NUMERO_NO_CONFIGURADO'].includes(error.message)) {
            return res.status(400).json({ ok: false, codigo: error.message, message: error.message });
        }
        res.status(500).json({ ok: false, message: error.message });
    }
};

exports.obtenerPrevisualizacion = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await service.obtenerPrevisualizacion(id, req.user);
        res.json({ ok: true, data: result });
    } catch (error) {
        if (error.message === 'FORMATO_PREVIEW_PENDIENTE') {
            return res.status(400).json({
                ok: false,
                codigo: 'FORMATO_PREVIEW_PENDIENTE',
                message: 'El formato oficial de previsualización para esta modalidad aún está pendiente.'
            });
        }
        if (error.message === 'CERTIFICADO_NOT_FOUND' || error.message === 'PLANTA_NO_AUTORIZADA') {
            return res.status(403).json({ ok: false, message: 'No autorizado o no encontrado' });
        }
        res.status(500).json({ ok: false, message: error.message });
    }
};

