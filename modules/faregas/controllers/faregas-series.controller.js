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
const entorno = (value) => {
    const result = texto(value, 'Entorno');
    if (!['DEMO', 'PRODUCCION'].includes(result)) fallo('Entorno inválido.');
    return result;
};
const proveedor = (value) => {
    const result = texto(value, 'Proveedor de emisión');
    if (!['LEGACY', 'NUBEFACT'].includes(result)) fallo('Proveedor de emisión inválido.');
    return result;
};
const referenciaPorTipo = (tipoComprobante) => {
    if (tipoComprobante.endsWith('_FACTURA')) return '01';
    if (tipoComprobante.endsWith('_BOLETA')) return '03';
    return null;
};
const validarSerie = (value, tipoComprobante) => {
    const serie = texto(value, 'Serie');
    const prefijoEsperado = tipoComprobante === 'FACTURA'
        ? 'F'
        : tipoComprobante === 'BOLETA'
            ? 'B'
            : tipoComprobante.includes('_FACTURA') ? 'F' : 'B';
    if (!/^[A-Z0-9]{4}$/.test(serie) || !serie.startsWith(prefijoEsperado)) {
        fallo(`La serie debe tener exactamente 4 caracteres alfanumericos y comenzar con ${prefijoEsperado}.`);
    }
    return serie;
};
const responder = (res, error) => {
    const mapa = {
        SEDE_NO_ENCONTRADA: [404, 'Sede no encontrada.'],
        SERIE_NO_ENCONTRADA: [404, 'Serie no encontrada.'],
        SERIE_DUPLICADA: [409, 'La serie ya existe para esta sede y tipo de comprobante.'],
        SERIE_PREDETERMINADA_DUPLICADA: [409, 'Ya existe una serie activa predeterminada para esta sede, tipo, proveedor y entorno.'],
        SERIE_NUBEFACT_EMPRESA_DUPLICADA: [409, 'La empresa ya tiene registrada esta serie Nubefact para el mismo tipo de comprobante.'],
        MIGRACION_NUBEFACT_PENDIENTE: [409, 'Primero debe aplicarse la migración tributaria de Nubefact aprobada.'],
        SERIE_NO_CONFIGURADA: [409, 'No existe una serie activa predeterminada para esta sede y tipo.'],
        SERIE_NO_AUTOGENERADA: [409, 'La serie predeterminada no está configurada como autogenerada.'],
        SERIE_NO_APTA_PRODUCCION: [409, 'La serie debe estar activa, predeterminada y autogenerada.'],
        SERIE_NUMERO_CONFIRMADO_MENOR: [409, 'El último número confirmado no puede ser menor al correlativo registrado.']
    };
    const [status, message] = mapa[error.message] || [error.status || 500, error.message || 'Error interno de series.'];
    res.status(status).json({ success: false, message });
};

exports.listarSedes = async (_req, res) => {
    try { res.json({ success: true, sedes: await service.listarSedes() }); } catch (error) { responder(res, error); }
};

/**
 * Listado del MAESTRO de series para Configuración. A diferencia de
 * `listar`, la sede es un filtro opcional: sin `planta_key` devuelve el
 * maestro completo, que es lo que necesita la exportación a Excel.
 */
exports.listarMaestro = async (req, res) => {
    try {
        const plantaKey = String(req.query.planta_key || '').trim() || null;
        const activo = req.query.activo === 'true' ? true : req.query.activo === 'false' ? false : undefined;
        // Filtro de origen: NUBEFACT frente al conjunto LEGACY (DMS + internas).
        const origen = ['LEGACY', 'NUBEFACT'].includes(String(req.query.proveedor || '').toUpperCase())
            ? String(req.query.proveedor).toUpperCase() : null;
        const entornoParam = ['DEMO', 'PRODUCCION'].includes(String(req.query.entorno || '').toUpperCase())
            ? String(req.query.entorno).toUpperCase() : null;
        // Se devuelve también el estado de la migración para que la pantalla
        // no tenga que consultarlo aparte: es el mismo dato que ya expone
        // `GET /series`.
        const [series, migracionNubefactAplicada] = await Promise.all([
            service.listarMaestro({
                plantaKey,
                tipo: tipo(req.query.tipo, true),
                activo,
                buscar: String(req.query.buscar || '').trim() || null,
                soloDms: req.query.solo_dms === 'true' || req.query.solo_dms === '1',
                origen,
                entorno: entornoParam
            }),
            service.migracionNubefactAplicada()
        ]);
        res.json({ success: true, series, migracionNubefactAplicada });
    } catch (error) { responder(res, error); }
};

exports.listar = async (req, res) => {
    try {
        const plantaKey = texto(req.query.planta_key, 'Sede');
        const activo = req.query.activo === 'true' ? true : req.query.activo === 'false' ? false : undefined;
        // Filtros de proveedor y ambiente para la vista de series NUBEFACT.
        // Se aplican en el backend: la vista nunca debe recibir filas LEGACY.
        const proveedor = ['LEGACY', 'NUBEFACT'].includes(String(req.query.proveedor || '').toUpperCase())
            ? String(req.query.proveedor).toUpperCase() : null;
        const entornoParam = ['DEMO', 'PRODUCCION'].includes(String(req.query.entorno || '').toUpperCase())
            ? String(req.query.entorno).toUpperCase() : null;
        const [series, migracionNubefactAplicada] = await Promise.all([service.listar({
            plantaKey, tipo: tipo(req.query.tipo, true), activo,
            buscar: String(req.query.buscar || '').trim() || null,
            proveedor, entorno: entornoParam
        }), service.migracionNubefactAplicada()]);
        res.json({ success: true, series, migracionNubefactAplicada });
    } catch (error) { responder(res, error); }
};
/** Metadato DMS: texto opcional. Si no viene, queda NULL (no pisa nada). */
const metadatoOpcional = (value) => {
    if (value === undefined || value === null) return null;
    const result = String(value).trim();
    return result === '' ? null : result;
};
/** Los 6 campos de metadato DMS, tal cual llegan (texto o null). */
const metadatoDms = (body) => [
    'nombre_dms', 'codigo_local_dms', 'nombre_local_dms',
    'telefono_local_dms', 'correo_local_dms', 'direccion_comercial_dms'
].reduce((result, campo) => {
    if (Object.prototype.hasOwnProperty.call(body, campo)) result[campo] = metadatoOpcional(body[campo]);
    return result;
}, {});
exports.crear = async (req, res) => {
    try {
        const tipoComprobante = tipo(req.body.tipo_comprobante);
        const serie = validarSerie(req.body.serie, tipoComprobante);
        const serieId = await service.crear({
            planta_key: texto(req.body.planta_key, 'Sede'),
            tipo_comprobante: tipoComprobante, serie,
            ultimo_numero: ultimoNumero(req.body.ultimo_numero),
            es_predeterminada: booleano(req.body.es_predeterminada, 'Predeterminada', false),
            autogenerada: booleano(req.body.autogenerada, 'Autogenerada', true),
            contingencia: booleano(req.body.contingencia, 'Contingencia', false),
            activo: booleano(req.body.activo, 'Estado', true),
            proveedor_emision: proveedor(req.body.proveedor_emision || 'NUBEFACT'),
            entorno_emision: entorno(req.body.entorno_emision),
            tipo_documento_referencia: referenciaPorTipo(tipoComprobante),
            serie_pos: booleano(req.body.serie_pos, 'Serie POS', false),
            ...metadatoDms(req.body)
        }, req.user.username, req.ip);
        res.status(201).json({ success: true, id: serieId, message: 'Serie creada correctamente.' });
    } catch (error) { responder(res, error); }
};
exports.editar = async (req, res) => {
    try {
        const cuerpo = { ...metadatoDms(req.body) };
        for (const [campo, etiqueta] of [
            ['es_predeterminada', 'Predeterminada'], ['autogenerada', 'Autogenerada'],
            ['contingencia', 'Contingencia'], ['serie_pos', 'Serie POS']
        ]) {
            if (req.body[campo] !== undefined) cuerpo[campo] = booleano(req.body[campo], etiqueta);
        }
        if (Object.prototype.hasOwnProperty.call(req.body, 'tipo_documento_referencia')) {
            cuerpo.tipo_documento_referencia = metadatoOpcional(req.body.tipo_documento_referencia);
        }
        // ultimo_numero es opcional en la edición del maestro: si llega, el
        // servicio aplica MAX(actual, recibido) para no retroceder.
        if (req.body.ultimo_numero !== undefined && req.body.ultimo_numero !== null) {
            cuerpo.ultimo_numero = ultimoNumero(req.body.ultimo_numero);
        }
        await service.editar(id(req.params.id), cuerpo, req.user.username, req.ip);
        res.json({ success: true, message: 'Serie actualizada correctamente.' });
    } catch (error) { responder(res, error); }
};
exports.cambiarEstado = async (req, res) => {
    try {
        await service.cambiarEstado(id(req.params.id), booleano(req.body.activo, 'Estado'), req.user.username, req.ip);
        res.json({ success: true, message: `Serie ${req.body.activo ? 'activada' : 'desactivada'} correctamente.` });
    } catch (error) { responder(res, error); }
};

exports.confirmarProduccion = async (req, res) => {
    try {
        const confirmada = booleano(req.body.confirmada, 'Confirmación');
        const numeroConfirmado = ultimoNumero(req.body.numero_inicial_confirmado);
        const sistemaOrigen = texto(req.body.sistema_origen, 'Sistema de origen');
        const fechaCorte = String(req.body.fecha_corte || '').trim();
        if (confirmada && (!fechaCorte || Number.isNaN(Date.parse(fechaCorte)))) fallo('La fecha de corte es inválida.');
        await service.confirmarProduccion(id(req.params.id), {
            confirmada,
            numero_inicial_confirmado: numeroConfirmado,
            sistema_origen: sistemaOrigen,
            fecha_corte: fechaCorte || null
        }, req.user.username, req.ip);
        res.json({ success: true, message: confirmada ? 'Serie confirmada para producción.' : 'Confirmación productiva revocada.' });
    } catch (error) { responder(res, error); }
};
