const express = require('express');
const db = require('../../../config/database');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const controller = require('../controllers/faregas-chips.controller');
const router = express.Router();

const permiso = (...claves) => async(req,res,next)=>{
    try{
        const r=await db.query('SELECT 1 FROM fg_perfil_permiso WHERE perfil_clave=$1 AND permiso_clave=ANY($2::varchar[]) LIMIT 1',[req.user.perfil_id,claves]);
        if(!r.rowCount)return res.status(403).json({success:false,message:'No tiene permiso para esta operación de chips.'}); next();
    }catch(e){res.status(500).json({success:false,message:'No se pudo validar el permiso.'});}
};

router.use(authFaregasMiddleware);
router.get('/',permiso('CHIPS_VER'),controller.listar);
router.get('/resumen',permiso('CHIPS_VER'),controller.resumen);
router.get('/disponibilidad/:numeroChip',controller.consultarDisponibilidad);
router.post('/ingresos',permiso('CHIPS_INGRESAR'),controller.ingresar);
router.post('/transferencias',permiso('CHIPS_TRANSFERIR'),controller.transferir);
router.post('/reservas',permiso('CHIPS_VER'),controller.reservar);
router.post('/liberaciones',permiso('CHIPS_VER'),controller.liberar);
router.post('/ventas',permiso('CHIPS_VER'),controller.vender);
router.post('/bajas',permiso('CHIPS_BAJA'),controller.baja);
router.get('/:id/movimientos',permiso('CHIPS_VER'),controller.historial);
module.exports=router;
