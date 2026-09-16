const service = require('../services/faregas-chips.service');

const respond = (res, error) => {
    const mensajes = {
        PRODUCTO_FISCAL_INVALIDO: 'El producto fiscal seleccionado está incompleto. Debe estar activo, habilitado para venta, usar unidad NIU o ZZ y afectación IGV 10.',
        VENTA_REQUIERE_PRODUCTO_FISCAL: 'Para habilitar la venta debe seleccionar un producto fiscal válido para el chip.'
    };
    const status = ['CHIP_DUPLICADO','CHIP_NO_DISPONIBLE','CHIP_ASIGNADO_CERTIFICADO','RESERVA_NO_COINCIDE','PRODUCTO_INVENTARIABLE_DUPLICADO'].includes(error.message) ? 409
        : ['PLANTA_NO_AUTORIZADA'].includes(error.message) ? 403 : 400;
    res.status(status).json({ success:false, codigo:error.message, message:mensajes[error.message] || error.message, detalles:error.detalles });
};

exports.listar = async(req,res)=>{try{res.json({success:true,...await service.listar({plantaKey:req.user.planta_key,...req.query},req.user)});}catch(e){respond(res,e);}};
exports.resumen = async(req,res)=>{try{res.json({success:true,resumen:await service.resumen(req.user.planta_key,req.user,req.query.productoInventariableId)});}catch(e){respond(res,e);}};
exports.listarProductosInventariables = async(req,res)=>{try{res.json({success:true,productos:await service.listarProductosInventariables(req.user.planta_key,req.user)});}catch(e){respond(res,e);}};
exports.catalogosProductosInventariables = async(req,res)=>{try{res.json({success:true,...await service.catalogosProductosInventariables(req.user.planta_key,req.user)});}catch(e){respond(res,e);}};
exports.crearProductoInventariable = async(req,res)=>{try{res.status(201).json({success:true,producto:await service.crearProductoInventariable(req.body,req.user,req.ip)});}catch(e){respond(res,e);}};
exports.editarProductoInventariable = async(req,res)=>{try{res.json({success:true,producto:await service.editarProductoInventariable(Number(req.params.id),req.body,req.user,req.ip)});}catch(e){respond(res,e);}};
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
