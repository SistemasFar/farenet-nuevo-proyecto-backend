const service = require('../services/faregas-tarifas-admin.service');

const badRequest = (message) => { const error = new Error(message); error.status = 400; throw error; };
const idPositivo = (value, campo) => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) badRequest(`${campo} inválido.`);
    return id;
};
const precioPositivo = (value) => {
    const precio = Number(value);
    if (!Number.isFinite(precio) || precio <= 0) badRequest('El precio debe ser mayor que cero.');
    return Math.round(precio * 100) / 100;
};
const productoNullable = (value) => {
    if (value === null || value === undefined || value === '') return null;
    return idPositivo(value, 'Producto de facturación');
};
const planta = (value) => {
    const key = String(value || '').trim();
    if (!key) badRequest('La sede es obligatoria.');
    return key;
};
const responderError = (res, error) => {
    const mapa = {
        TARIFA_DUPLICADA: [409, 'El servicio ya tiene una tarifa configurada en esta sede.'],
        TARIFA_NO_ENCONTRADA: [404, 'Tarifa no encontrada.'],
        SEDE_NO_ENCONTRADA: [404, 'Sede no encontrada.'],
        SERVICIO_NO_DISPONIBLE: [409, 'El servicio no está disponible para asignación.'],
        PRODUCTO_NO_ENCONTRADO: [404, 'Producto de facturación no encontrado.'],
        PRODUCTO_INACTIVO: [409, 'No se puede asignar un SKU inactivo.'],
        PRODUCTO_NO_VENTA: [409, 'El SKU debe estar habilitado para venta.'],
        PRODUCTO_UNIDAD_INVALIDA: [409, 'Los servicios de certificación requieren la unidad tributaria ZZ.'],
        PRODUCTO_CODIGO_SUNAT_INVALIDO: [409, 'El código de clasificación SUNAT debe contener 8 dígitos.'],
        PRODUCTO_AFECTACION_IGV_INVALIDA: [409, 'Los servicios gravados de certificación requieren afectación IGV 10.']
    };
    const [status, message] = mapa[error.message] || [error.status || 500, error.message || 'Error interno de tarifas.'];
    res.status(status).json({ success: false, message });
};

exports.listarSedes = async (_req, res) => {
    try { res.json({ success: true, sedes: await service.listarSedes() }); }
    catch (error) { responderError(res, error); }
};
exports.listar = async (req, res) => {
    try {
        const plantaKey = planta(req.query.planta_key);
        const activo = req.query.activo === 'true' ? true : req.query.activo === 'false' ? false : undefined;
        res.json({ success: true, tarifas: await service.listar({
            plantaKey, buscar: String(req.query.buscar || '').trim() || null,
            categoria: String(req.query.categoria || '').trim() || null, activo
        }) });
    } catch (error) { responderError(res, error); }
};
exports.listarServiciosDisponibles = async (req, res) => {
    try { res.json({ success: true, servicios: await service.listarServiciosDisponibles(planta(req.query.planta_key)) }); }
    catch (error) { responderError(res, error); }
};
exports.buscarProductos = async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        res.json({ success: true, productos: q.length < 2 ? [] : await service.buscarProductos(q) });
    } catch (error) { responderError(res, error); }
};
exports.crear = async (req, res) => {
    try {
        if (req.body.activo !== undefined && typeof req.body.activo !== 'boolean') badRequest('Estado inválido.');
        const id = await service.crear({
            planta_key: planta(req.body.planta_key),
            servicio_id: idPositivo(req.body.servicio_id, 'Servicio'),
            precio: precioPositivo(req.body.precio),
            producto_facturacion_id: productoNullable(req.body.producto_facturacion_id),
            activo: req.body.activo ?? true
        }, req.user.username, req.ip);
        res.status(201).json({ success: true, id, message: 'Tarifa asignada correctamente.' });
    } catch (error) { responderError(res, error); }
};
exports.editar = async (req, res) => {
    try {
        if (typeof req.body.activo !== 'boolean') badRequest('Estado inválido.');
        await service.editar(idPositivo(req.params.id, 'Tarifa'), {
            precio: precioPositivo(req.body.precio),
            producto_facturacion_id: productoNullable(req.body.producto_facturacion_id),
            activo: req.body.activo
        }, req.user.username, req.ip);
        res.json({ success: true, message: 'Tarifa actualizada correctamente.' });
    } catch (error) { responderError(res, error); }
};
exports.cambiarEstado = async (req, res) => {
    try {
        if (typeof req.body.activo !== 'boolean') badRequest('Estado inválido.');
        await service.cambiarEstado(idPositivo(req.params.id, 'Tarifa'), req.body.activo, req.user.username, req.ip);
        res.json({ success: true, message: `Tarifa ${req.body.activo ? 'activada' : 'desactivada'} correctamente.` });
    } catch (error) { responderError(res, error); }
};
