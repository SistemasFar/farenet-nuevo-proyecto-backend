const service = require('../services/faregas-series.service');

const tipos = new Set([
    'FACTURA',
    'BOLETA',
    'NOTA_CREDITO_FACTURA',
    'NOTA_CREDITO_BOLETA',
    'NOTA_DEBITO_FACTURA',
    'NOTA_DEBITO_BOLETA'
]);
const fallo = (message) => { const error = new Error(message); error.status = 400; throw error; };
const texto = (value, campo) => {
    const result = String(value || '').trim().toUpperCase();
    if (!result) fallo(`${campo} es obligatorio.`);
    return result;
};
const tipo = (value, opcional = false) => {
    if (opcional && !value) return null;
    const result = texto(value, 'Tipo de comprobante');
    if (!tipos.has(result)) fallo('Tipo de comprobante inválido.');
    return result;
};
const id = (value) => {
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result <= 0) fallo('Identificador de serie inválido.');
    return result;
};
const booleano = (value, campo, defecto) => {
    if (value === undefined) {
        if (defecto === undefined) fallo(`${campo} es obligatorio.`);
        return defecto;
    }
    if (typeof value !== 'boolean') fallo(`${campo} debe ser booleano.`);
    return value;
};
const ultimoNumero = (value) => {
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result < 0) fallo('El último número debe ser un entero mayor o igual a cero.');
    return result;
};
const responder = (res, error) => {
    const mapa = {
        SEDE_NO_ENCONTRADA: [404, 'Sede no encontrada.'],
        SERIE_NO_ENCONTRADA: [404, 'Serie no encontrada.'],
        SERIE_DUPLICADA: [409, 'La serie ya existe para esta sede y tipo de comprobante.'],
        SERIE_PREDETERMINADA_DUPLICADA: [409, 'Ya existe una serie activa predeterminada para esta sede y tipo.'],
        SERIE_NO_CONFIGURADA: [409, 'No existe una serie activa predeterminada para esta sede y tipo.'],
        SERIE_NO_AUTOGENERADA: [409, 'La serie predeterminada no está configurada como autogenerada.']
    };
    const [status, message] = mapa[error.message] || [error.status || 500, error.message || 'Error interno de series.'];
    res.status(status).json({ success: false, message });
};

exports.listarSedes = async (_req, res) => {
    try { res.json({ success: true, sedes: await service.listarSedes() }); } catch (error) { responder(res, error); }
};
exports.listar = async (req, res) => {
    try {
        const plantaKey = texto(req.query.planta_key, 'Sede');
        const activo = req.query.activo === 'true' ? true : req.query.activo === 'false' ? false : undefined;
        res.json({ success: true, series: await service.listar({
            plantaKey, tipo: tipo(req.query.tipo, true), activo,
            buscar: String(req.query.buscar || '').trim() || null
        }) });
    } catch (error) { responder(res, error); }
};
exports.crear = async (req, res) => {
    try {
        const serie = texto(req.body.serie, 'Serie');
        if (serie.length > 30) fallo('La serie admite como máximo 30 caracteres.');
        const serieId = await service.crear({
            planta_key: texto(req.body.planta_key, 'Sede'),
            tipo_comprobante: tipo(req.body.tipo_comprobante), serie,
            ultimo_numero: ultimoNumero(req.body.ultimo_numero),
            es_predeterminada: booleano(req.body.es_predeterminada, 'Predeterminada', false),
            autogenerada: booleano(req.body.autogenerada, 'Autogenerada', true),
            contingencia: booleano(req.body.contingencia, 'Contingencia', false),
            activo: booleano(req.body.activo, 'Estado', true)
        }, req.user.username, req.ip);
        res.status(201).json({ success: true, id: serieId, message: 'Serie creada correctamente.' });
    } catch (error) { responder(res, error); }
};
exports.editar = async (req, res) => {
    try {
        await service.editar(id(req.params.id), {
            es_predeterminada: booleano(req.body.es_predeterminada, 'Predeterminada'),
            autogenerada: booleano(req.body.autogenerada, 'Autogenerada'),
            contingencia: booleano(req.body.contingencia, 'Contingencia')
        }, req.user.username, req.ip);
        res.json({ success: true, message: 'Serie actualizada correctamente.' });
    } catch (error) { responder(res, error); }
};
exports.cambiarEstado = async (req, res) => {
    try {
        await service.cambiarEstado(id(req.params.id), booleano(req.body.activo, 'Estado'), req.user.username, req.ip);
        res.json({ success: true, message: `Serie ${req.body.activo ? 'activada' : 'desactivada'} correctamente.` });
    } catch (error) { responder(res, error); }
};
