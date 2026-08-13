const express = require('express');
const router = express.Router();
const controller = require('../controllers/faregas-certificados.controller');
const jwt = require('jsonwebtoken');
const db = require('../../../config/database');

const JWT_SECRET_FAREGAS = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';

const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Token requerido' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET_FAREGAS);
        if (decoded.faregas_flow !== 'authenticated') {
            return res.status(403).json({ message: 'Flujo inválido' });
        }
        
        const userDb = await db.query(
            'SELECT estado, perfil_id FROM fg_usuario WHERE username = $1 LIMIT 1', 
            [decoded.username]
        );
        
        if (userDb.rowCount === 0) {
            return res.status(401).json({ message: 'Usuario no existe' });
        }
        if (!userDb.rows[0].estado) {
            return res.status(403).json({ message: 'Usuario inactivo' });
        }
        
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ message: 'Token inválido o expirado' });
    }
};

router.use(authMiddleware);

router.get('/tipos', controller.obtenerTipos);
router.get('/correlativos', controller.obtenerCorrelativos);
router.get('/correlativos/:plantaKey/:tipo', controller.obtenerRangoActivo);
router.post('/correlativos', controller.crearRango);
router.patch('/correlativos/:id/cerrar', controller.cerrarRango);

// FASE 3: BORRADORES DE CERTIFICADOS
router.post('/borradores', controller.crearBorrador);
router.get('/borradores/:id', controller.obtenerBorradorCompleto);
router.patch('/borradores/:id', controller.actualizarBorrador);

router.put('/borradores/:id/vehiculo', controller.guardarVehiculoBorrador);

router.post('/borradores/:id/titulares', controller.agregarTitular);
router.patch('/borradores/:id/titulares/:titularId', controller.actualizarTitular);
router.delete('/borradores/:id/titulares/:titularId', controller.eliminarTitular);

module.exports = router;
