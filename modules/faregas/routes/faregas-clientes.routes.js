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
        
        req.user = { ...decoded, perfil_id: userDb.rows[0].perfil_id };
        if (req.params.placa) vehicleLookupDebug.log('AUTH_OK');
        next();
    } catch (e) {
        if (req.params.placa) vehicleLookupDebug.logError('AUTH_ERROR', e, 401);
        return res.status(401).json({ message: 'Token inválido o expirado' });
    }
};

const permisoConsultarClientes = async (req, res, next) => {
    try {
        const permiso = await db.query(`
            SELECT 1
            FROM fg_perfil_permiso
            WHERE perfil_clave = $1
              AND permiso_clave = 'MENU_FACTURACION_COMPROBANTES'
            LIMIT 1
        `, [req.user.perfil_id]);
        if (permiso.rowCount === 0) {
            return res.status(403).json({ ok: false, message: 'No tiene permiso para consultar clientes de facturación.' });
        }
        return next();
    } catch (e) {
        console.error('Error al validar permiso de clientes:', e);
        return res.status(500).json({ ok: false, message: 'No se pudo validar el permiso de clientes.' });
    }
};

// GET /api/faregas/clientes
router.get('/', authMiddleware, permisoConsultarClientes, clientesController.listarClientes);

// GET /api/faregas/clientes/documento/:tipoDocumento/:nroDocumento
router.get('/documento/:tipoDocumento/:nroDocumento', authMiddleware, clientesController.obtenerClientePorDocumento);

// GET /api/faregas/clientes/autocompletar/:tipoDocumento/:nroDocumento
router.get('/autocompletar/:tipoDocumento/:nroDocumento', authMiddleware, clientesController.autocompletarPersona);
router.get('/consultar-documento', authMiddleware, clientesController.consultarDocumento);
router.get('/consultar-documento/:documento', authMiddleware, clientesController.consultarDocumento);

// GET /api/faregas/clientes/vehiculo/:placa
router.get('/vehiculo/:placa', vehicleLookupDebug.beginRequest, authMiddleware, clientesController.consultarVehiculoPorPlaca);

// POST /api/faregas/clientes
router.post('/', authMiddleware, clientesController.crearCliente);

// PATCH /api/faregas/clientes/:id
router.patch('/:id', authMiddleware, clientesController.actualizarCliente);

module.exports = router;
