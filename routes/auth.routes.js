const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

/**
 * @openapi
 * /auth/login:
 * post:
 * summary: Iniciar sesión del operador (HU001 - Paso 1)
 * description: Valida las credenciales con Bcrypt en PostgreSQL y retorna las sedes asignadas.
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * required:
 * - username
 * - password
 * properties:
 * username:
 * type: string
 * example: mchavez
 * password:
 * type: string
 * example: "76052066"
 * responses:
 * 200:
 * description: Autenticación exitosa. Retorna el listado de plantas.
 * 401:
 * description: Credenciales incorrectas o usuario inactivo.
 * 500:
 * description: Error interno del servidor.
 */
router.post('/login', authController.login);

/**
 * @openapi
 * /auth/confirmar-planta:
 * post:
 * summary: Confirmar sede operativa (HU001 - Paso 2)
 * description: Registra la auditoría en la tabla 'sesion_usuario' con estado activo y genera los tokens JWT.
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * required:
 * - username
 * - plantaKey
 * properties:
 * username:
 * type: string
 * example: mchavez
 * plantaKey:
 * type: string
 * example: "25"
 * responses:
 * 200:
 * description: Sede confirmada y sesión registrada en PostgreSQL.
 * 400:
 * description: Faltan parámetros obligatorios.
 * 500:
 * description: Error al insertar en la base de datos.
 */
router.post('/confirmar-planta', authController.confirmarPlanta);

/**
 * @openapi
 * /auth/logout:
 * post:
 * summary: Cerrar sesión del operador (HU002)
 * description: Realiza el cierre lógico cambiando el estado de 'activo' a false en la tabla 'sesion_usuario'.
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * required:
 * - username
 * properties:
 * username:
 * type: string
 * example: mchavez
 * responses:
 * 200:
 * description: Cierre de sesión exitoso en la base de datos.
 * 500:
 * description: Error al actualizar el estado en PostgreSQL.
 */
router.post('/logout', authController.logout);

module.exports = router;