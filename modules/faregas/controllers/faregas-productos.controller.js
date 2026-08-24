const productosService = require('../services/faregas-productos.service');

const textoNullable = (value) => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    return String(value).trim();
};

const numeroNullable = (value, campo) => {
    if (value === null || value === undefined || value === '') return null;
    const numero = Number(value);
    if (!Number.isFinite(numero) || numero < 0) {
        const error = new Error(`${campo} debe ser un número mayor o igual a cero.`);
        error.status = 400;
        throw error;
    }
    return numero;
};

const booleano = (value, campo, valorDefault) => {
    if (value === undefined) return valorDefault;
    if (typeof value !== 'boolean') {
        const error = new Error(`${campo} debe ser booleano.`);
        error.status = 400;
        throw error;
    }
    return value;
};

const idProducto = (value) => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        const error = new Error('Identificador de producto inválido.');
        error.status = 400;
        throw error;
    }
    return id;
};

const normalizar = (body, { crear = false } = {}) => {
    const codigoSku = textoNullable(body.codigo_sku);
    const descripcion = textoNullable(body.descripcion);
    if (crear && !codigoSku) {
        const error = new Error('El código SKU es obligatorio.');
        error.status = 400;
        throw error;
    }
    if (!descripcion) {
        const error = new Error('La descripción es obligatoria.');
        error.status = 400;
        throw error;
    }
    const afectacion = textoNullable(body.tipo_afectacion_igv);
    if (afectacion && !/^\d{2}$/.test(afectacion)) {
        const error = new Error('El tipo de afectación IGV debe contener dos dígitos.');
        error.status = 400;
        throw error;
    }
    return {
        ...(crear ? { codigo_sku: codigoSku } : {}),
        descripcion,
        tipo_producto: textoNullable(body.tipo_producto),
        categoria_dms: textoNullable(body.categoria_dms),
        cuenta_por_cobrar: textoNullable(body.cuenta_por_cobrar),
        unidad: textoNullable(body.unidad),
        precio_unitario: numeroNullable(body.precio_unitario, 'Precio unitario'),
        precio_referencia: numeroNullable(body.precio_referencia, 'Precio referencia'),
        valor_referencial_unitario: numeroNullable(body.valor_referencial_unitario, 'Valor referencial'),
        codigo_clasificacion_sunat: textoNullable(body.codigo_clasificacion_sunat),
        tipo_afectacion_igv: afectacion,
        porcentaje_isc: numeroNullable(body.porcentaje_isc, 'Porcentaje ISC'),
        disponible_pos: booleano(body.disponible_pos, 'Disponible POS', false),
        es_para_venta: booleano(body.es_para_venta, 'Es para venta', true),
        es_para_compra: booleano(body.es_para_compra, 'Es para compra', false),
        tiene_icbper: booleano(body.tiene_icbper, 'Tiene ICBPER', false),
        ...(crear ? { activo: booleano(body.activo, 'Activo', true) } : {})
    };
};

const responderError = (res, error, fallback) => {
    const mensajes = {
        SKU_DUPLICADO: 'Ya existe un producto con ese código SKU.',
        PRODUCTO_NO_ENCONTRADO: 'Producto no encontrado.'
    };
    res.status(error.status || (error.message === 'SKU_DUPLICADO' ? 409 : 500)).json({
        success: false,
        message: mensajes[error.message] || error.message || fallback
    });
};

exports.listar = async (req, res) => {
    try {
        const convertirBooleano = (value) => value === 'true' ? true : value === 'false' ? false : undefined;
        const productos = await productosService.listar({
            buscar: textoNullable(req.query.buscar),
            estado: convertirBooleano(req.query.activo),
            paraVenta: convertirBooleano(req.query.es_para_venta),
            unidad: textoNullable(req.query.unidad)
        });
        res.json({ success: true, productos });
    } catch (error) {
        responderError(res, error, 'Error al obtener productos.');
    }
};

exports.crear = async (req, res) => {
    try {
        const producto = normalizar(req.body, { crear: true });
        const id = await productosService.crear(producto, req.user.username, req.ip);
        res.status(201).json({ success: true, id, message: 'Producto creado exitosamente.' });
    } catch (error) {
        responderError(res, error, 'Error al crear producto.');
    }
};

exports.editar = async (req, res) => {
    try {
        const producto = normalizar(req.body);
        await productosService.editar(idProducto(req.params.id), producto, req.user.username, req.ip);
        res.json({ success: true, message: 'Producto actualizado exitosamente.' });
    } catch (error) {
        responderError(res, error, 'Error al editar producto.');
    }
};

exports.cambiarEstado = async (req, res) => {
    try {
        if (typeof req.body.activo !== 'boolean') {
            return res.status(400).json({ success: false, message: 'Estado inválido.' });
        }
        await productosService.cambiarEstado(
            idProducto(req.params.id), req.body.activo, req.user.username, req.ip
        );
        res.json({ success: true, message: `Producto ${req.body.activo ? 'activado' : 'desactivado'} exitosamente.` });
    } catch (error) {
        responderError(res, error, 'Error al cambiar estado del producto.');
    }
};
