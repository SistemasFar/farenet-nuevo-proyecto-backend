const service = require('../services/faregas-chips.service');

const respond = (res, error) => {
    const status = ['CHIP_DUPLICADO','CHIP_NO_DISPONIBLE','RESERVA_NO_COINCIDE'].includes(error.message) ? 409
        : ['PLANTA_NO_AUTORIZADA'].includes(error.message) ? 403 : 400;
    res.status(status).json({ success:false, codigo:error.message, message:error.message, detalles:error.detalles });
};

exports.listar = async(req,res)=>{try{res.json({success:true,...await service.listar({plantaKey:req.user.planta_key,...req.query},req.user)});}catch(e){respond(res,e);}};
exports.resumen = async(req,res)=>{try{res.json({success:true,resumen:await service.resumen(req.user.planta_key,req.user)});}catch(e){respond(res,e);}};
exports.ingresar = async(req,res)=>{try{res.status(201).json({success:true,chips:await service.ingresar({plantaKey:req.user.planta_key,...req.body},req.user)});}catch(e){respond(res,e);}};
exports.transferir = async(req,res)=>{try{res.json({success:true,cantidad:await service.transferir({...req.body,origenKey:req.user.planta_key},req.user)});}catch(e){respond(res,e);}};
exports.reservar = async(req,res)=>{try{res.json({success:true,chip:await service.reservar({plantaKey:req.user.planta_key,...req.body},req.user)});}catch(e){respond(res,e);}};
exports.liberar = async(req,res)=>{try{await service.liberar({plantaKey:req.user.planta_key,...req.body},req.user);res.json({success:true});}catch(e){respond(res,e);}};
exports.vender = async(req,res)=>{try{await service.vender({plantaKey:req.user.planta_key,...req.body},req.user);res.json({success:true});}catch(e){respond(res,e);}};
exports.baja = async(req,res)=>{try{await service.baja({plantaKey:req.user.planta_key,...req.body},req.user);res.json({success:true});}catch(e){respond(res,e);}};
exports.historial = async(req,res)=>{try{res.json({success:true,movimientos:await service.historial(Number(req.params.id),req.user)});}catch(e){respond(res,e);}};
