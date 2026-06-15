const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

/**
 * @openapi
 * /auth/login:
 * post:
 * summary: Iniciar sesión del operador (HU001 - Paso 1)
 * description: Valida las credenciales con Bcrypt en PostgreSQL y retorna solo las sedes asignadas al usuario.
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
 * description: Autenticación exitosa. Si tiene una sede ingresa directo; si tiene varias retorna selector.
 * 400:
 * description: Usuario y contraseña requeridos.
 * 401:
 * description: Credenciales incorrectas o usuario inactivo.
 * 403:
 * description: Usuario sin sedes asignadas.
 * 500:
 * description: Error interno del servidor.
 */
router.post('/login', authController.login);

/**
 * @openapi
 * /auth/confirmar-planta:
 * post:
 * summary: Confirmar sede operativa seleccionada (HU006)
 * description: Valida que el usuario tenga acceso a la sede seleccionada y registra la sesión activa.
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
 * 403:
 * description: El usuario no tiene acceso a la sede seleccionada.
 * 500:
 * description: Error al insertar en la base de datos.
 */
router.post('/confirmar-planta', authController.confirmarPlanta);

/**
 * @openapi
 * /auth/cambiar-planta:
 * post:
 * summary: Cambiar sede activa durante la sesión (HU006)
 * description: Permite cambiar la sede de trabajo del usuario validando que tenga acceso a la nueva sede.
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
 * example: "26"
 * responses:
 * 200:
 * description: Sede cambiada correctamente.
 * 400:
 * description: Usuario y sede son obligatorios.
 * 403:
 * description: El usuario no tiene acceso a la sede seleccionada.
 * 500:
 * description: Error al cambiar de sede.
 */
router.post('/cambiar-planta', authController.cambiarPlanta);

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
router.post('/validar-sesion', authController.validarSesion);
router.post('/refresh-sesion', authController.refrescarSesion);
router.get('/permisos/:username', authController.obtenerPermisos);
router.put('/change-password', authController.changePassword);
module.exports = router;