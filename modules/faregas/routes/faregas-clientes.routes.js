const express = require('express');
const router = express.Router();
const clientesController = require('../controllers/faregas-clientes.controller');
const jwt = require('jsonwebtoken');
const db = require('../../../config/database');
const vehicleLookupDebug = require('../utils/vehiculo-lookup-debug');

const JWT_SECRET_FAREGAS = process.env.JWT_SECRET_FAREGAS;

const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        if (req.params.placa) vehicleLookupDebug.log('AUTH_ERROR', { errorName: 'AuthError', errorMessage: 'Token requerido', status: 401 });
        return res.status(401).json({ message: 'Token requerido' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET_FAREGAS);
        if (decoded.faregas_flow !== 'authenticated') {
            if (req.params.placa) vehicleLookupDebug.log('AUTH_ERROR', { errorName: 'AuthError', errorMessage: 'Flujo inválido', status: 403 });
            return res.status(403).json({ message: 'Flujo inválido' });
        }
        
        const userDb = await db.query(
            'SELECT estado, perfil_id FROM fg_usuario WHERE username = $1 LIMIT 1', 
            [decoded.username]
        );
        
        if (userDb.rowCount === 0) {
            if (req.params.placa) vehicleLookupDebug.log('AUTH_ERROR', { errorName: 'AuthError', errorMessage: 'Usuario no existe', status: 401 });
            return res.status(401).json({ message: 'Usuario no existe' });
        }
        if (!userDb.rows[0].estado) {
            if (req.params.placa) vehicleLookupDebug.log('AUTH_ERROR', { errorName: 'AuthError', errorMessage: 'Usuario inactivo', status: 403 });
            return res.status(403).json({ message: 'Usuario inactivo' });
        }
        
        req.user = decoded;
        if (req.params.placa) vehicleLookupDebug.log('AUTH_OK');
        next();
    } catch (e) {
        if (req.params.placa) vehicleLookupDebug.logError('AUTH_ERROR', e, 401);
        return res.status(401).json({ message: 'Token inválido o expirado' });
    }
};

// GET /api/faregas/clientes/documento/:tipoDocumento/:nroDocumento
router.get('/documento/:tipoDocumento/:nroDocumento', authMiddleware, clientesController.obtenerClientePorDocumento);

// GET /api/faregas/clientes/autocompletar/:tipoDocumento/:nroDocumento
router.get('/autocompletar/:tipoDocumento/:nroDocumento', authMiddleware, clientesController.autocompletarPersona);

// GET /api/faregas/clientes/vehiculo/:placa
router.get('/vehiculo/:placa', vehicleLookupDebug.beginRequest, authMiddleware, clientesController.consultarVehiculoPorPlaca);

// POST /api/faregas/clientes
router.post('/', authMiddleware, clientesController.crearCliente);

// PATCH /api/faregas/clientes/:id
router.patch('/:id', authMiddleware, clientesController.actualizarCliente);

module.exports = router;
