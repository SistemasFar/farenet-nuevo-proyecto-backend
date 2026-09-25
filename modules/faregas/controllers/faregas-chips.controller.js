const service = require('../services/faregas-chips.service');
const ventaDirectaValidacionService = require('../services/faregas-venta-directa-validacion.service');
const ventaDirectaFase2Service = require('../services/faregas-venta-directa-fase2.service');

const respond = (res, error) => {
    const mensajes = {
        PRODUCTO_FISCAL_INVALIDO: 'El producto fiscal seleccionado está incompleto. Debe estar activo, habilitado para venta, usar unidad NIU o ZZ y afectación IGV 10.',
        VENTA_REQUIERE_PRODUCTO_FISCAL: 'Para habilitar la venta debe seleccionar un producto fiscal válido para el chip.',
        CHIPS_REQUERIDOS: 'Debe enviar al menos un chip.',
        CHIP_NUMERO_INVALIDO: 'Uno o más códigos de chip no son válidos.',
        CHIP_DUPLICADO: 'El request contiene códigos de chip duplicados.',
        CHIP_NO_ENCONTRADO: 'Uno o más chips no existen.',
        CHIP_OTRA_SEDE: 'Uno o más chips pertenecen a otra sede.',
        CHIP_NO_DISPONIBLE: 'Uno o más chips ya no están disponibles.',
        STOCK_CHIP_NO_PERMITIDO: 'El producto de chip no tiene stock permitido en esta sede.',
        VENTA_CHIP_NO_HABILITADA: 'El producto de chip no está habilitado para venta en esta sede.',
        PRODUCTO_FISCAL_CHIP_INVALIDO: 'El producto fiscal configurado para el chip no es válido.',
        PRECIO_PRODUCTO_INVALIDO: 'El precio configurado del chip no es válido.',
        DATOS_FACTURACION_INVALIDOS: 'Los datos fiscales no permiten emitir el comprobante.',
        DATOS_CLIENTE_REQUERIDOS: 'Complete los datos del cliente.',
        DATOS_CLIENTE_INVALIDOS: 'Los datos del cliente no son válidos.',
        CONDICION_PAGO_INVALIDA: 'La condición de pago no es válida.',
        CONDICION_PAGO_NO_DISPONIBLE: 'La venta directa por crédito aún no está disponible en esta fase.',
        PAGO_INCOMPLETO: 'El pago no cubre el total de la venta.',
        PAGO_EXCEDE_TOTAL: 'El pago no puede superar el total de la venta.',
        TIPO_COMPROBANTE_INVALIDO: 'El tipo de comprobante no es válido.',
        TIPO_PAGO_INVALIDO: 'El medio de pago no es válido.',
        IMPORTE_PAGO_INVALIDO: 'Todos los pagos deben tener un importe mayor a cero.',
        DATOS_TARJETA_INCOMPLETOS: 'Complete la tarjeta y el número de operación.',
        TARJETA_NOT_FOUND: 'La tarjeta seleccionada no existe.',
        DATOS_BANCO_INCOMPLETOS: 'Complete los datos bancarios del pago.',
        CUENTA_BANCARIA_INVALIDA: 'La cuenta bancaria no pertenece a la entidad seleccionada.',
        PLANTA_REQUERIDA: 'No tiene una sede seleccionada.',
        OPERACION_NOT_FOUND: 'La operación de venta no existe.',
        OPERACION_ID_INVALIDO: 'El identificador de la operación no es válido.',
        FECHA_INVALIDA: 'Las fechas deben tener formato AAAA-MM-DD.',
        RANGO_FECHAS_INVALIDO: 'La fecha Desde no puede ser posterior a la fecha Hasta.',
        PLANTA_NO_AUTORIZADA: 'No tiene acceso a la sede de la operación.',
        TIPO_CHIP_NO_ENCONTRADA: 'El tipo de chip no existe.',
        TIPO_CHIP_BLOQUEADO: 'El tipo de chip tiene dependencias que no se pueden eliminar.',
        AMBIENTE_PRODUCCION: 'La limpieza de tipos de chip sólo está disponible en ambiente DEMO o desarrollo.'
    };
    const status = error.status
        || ['CHIP_DUPLICADO','CHIP_NO_DISPONIBLE','CHIP_OTRA_SEDE','CHIP_ASIGNADO_CERTIFICADO','RESERVA_NO_COINCIDE','PRODUCTO_INVENTARIABLE_DUPLICADO','PAGO_INCOMPLETO','PAGO_EXCEDE_TOTAL','VENTA_CHIP_NO_HABILITADA','STOCK_CHIP_NO_PERMITIDO','PRODUCTO_FISCAL_CHIP_INVALIDO','CONDICION_PAGO_NO_DISPONIBLE','TIPO_CHIP_BLOQUEADO','AMBIENTE_PRODUCCION'].includes(error.message) ? 409
        : ['OPERACION_NOT_FOUND','TIPO_CHIP_NO_ENCONTRADO'].includes(error.message) ? 404
        : ['PLANTA_NO_AUTORIZADA'].includes(error.message) ? 403 : 400;
    res.status(status).json({ success:false, codigo:error.message, message:mensajes[error.message] || error.message, detalles:error.detalles });
};

exports.listar = async(req,res)=>{try{res.json({success:true,...await service.listar({plantaKey:req.user.planta_key,...req.query},req.user)});}catch(e){respond(res,e);}};
exports.resumen = async(req,res)=>{try{res.json({success:true,resumen:await service.resumen(req.user.planta_key,req.user,req.query.productoInventariableId)});}catch(e){respond(res,e);}};
exports.listarProductosInventariables = async(req,res)=>{try{res.json({success:true,productos:await service.listarProductosInventariables(req.user.planta_key,req.user)});}catch(e){respond(res,e);}};
exports.catalogosProductosInventariables = async(req,res)=>{try{res.json({success:true,...await service.catalogosProductosInventariables(req.user.planta_key,req.user)});}catch(e){respond(res,e);}};
exports.crearProductoInventariable = async(req,res)=>{try{res.status(201).json({success:true,producto:await service.crearProductoInventariable(req.body,req.user,req.ip)});}catch(e){respond(res,e);}};
exports.editarProductoInventariable = async(req,res)=>{try{res.json({success:true,producto:await service.editarProductoInventariable(Number(req.params.id),req.body,req.user,req.ip)});}catch(e){respond(res,e);}};
exports.impactoProductoInventariable = async(req,res)=>{try{res.json({success:true,impacto:await service.obtenerImpactoTipoChip(Number(req.params.id))});}catch(e){respond(res,e);}};
exports.eliminarProductoInventariable = async(req,res)=>{try{res.json({success:true,resultado:await service.eliminarProductoInventariable(Number(req.params.id),req.user,req.ip)});}catch(e){respond(res,e);}};
exports.consultarDisponibilidad = async(req,res)=>{try{res.json({success:true,chip:await service.consultarDisponibilidad({plantaKey:req.user.planta_key,numeroChip:req.params.numeroChip,certificadoId:req.query.certificadoId},req.user)});}catch(e){respond(res,e);}};
exports.ingresar = async(req,res)=>{try{res.status(201).json({success:true,chips:await service.ingresar({plantaKey:req.user.planta_key,...req.body},req.user)});}catch(e){respond(res,e);}};
exports.transferir = async(req,res)=>{try{res.json({success:true,cantidad:await service.transferir({...req.body,origenKey:req.user.planta_key},req.user)});}catch(e){respond(res,e);}};
exports.reservar = async(req,res)=>{try{res.json({success:true,chip:await service.reservar({plantaKey:req.user.planta_key,...req.body},req.user)});}catch(e){respond(res,e);}};
exports.liberar = async(req,res)=>{try{await service.liberar({plantaKey:req.user.planta_key,...req.body},req.user);res.json({success:true});}catch(e){respond(res,e);}};
exports.vender = async(req,res)=>{try{await service.vender({plantaKey:req.user.planta_key,...req.body},req.user);res.json({success:true});}catch(e){respond(res,e);}};
exports.iniciarVentaSoloChip = async(req,res)=>{try{res.json({success:true,venta:await service.iniciarVentaSoloChip({plantaKey:req.user.planta_key,...req.body},req.user)});}catch(e){respond(res,e);}};
exports.baja = async(req,res)=>{try{await service.baja({plantaKey:req.user.planta_key,...req.body},req.user);res.json({success:true});}catch(e){respond(res,e);}};
exports.historial = async(req,res)=>{try{res.json({success:true,movimientos:await service.historial(Number(req.params.id),req.user)});}catch(e){respond(res,e);}};

exports.listarCatalogoChipsFiscales = async (req, res) => {
    try {
        const chips = await service.listarCatalogoChipsFiscales();
        res.json({ success: true, chips });
    } catch (e) {
        respond(res, e);
    }
};

exports.listarVentas = async (req, res) => {
    try {
        const ventas = await service.listarVentas(req.user.planta_key, req.user, req.query || {});
        res.json({ success: true, ventas });
    } catch (e) {
        respond(res, e);
    }
};

exports.obtenerDetalleVenta = async (req, res) => {
    try {
        const venta = await service.obtenerDetalleVenta(req.params.operacionId, req.user);
        return res.json({ success: true, venta });
    } catch (e) {
        return respond(res, e);
    }
};

exports.validarVentaDirecta = async (req, res) => {
    try {
        const result = await ventaDirectaValidacionService.validarVentaDirecta(
            { chips: req.body?.chips },
            req.user
        );
        return res.json({ success: true, ...result });
    } catch (e) {
        return respond(res, e);
    }
};

exports.crearVentaDirecta = async (req, res) => {
    try {
        const result = await ventaDirectaFase2Service.crearVentaDirectaYEmitir(
            { ...req.body, plantaKey: req.user.planta_key },
            req.user
        );
        return res.status(Number(result.httpStatus) || 200).json(result);
    } catch (e) {
        return respond(res, e);
    }
};
