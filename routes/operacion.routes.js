const express = require('express');
const router = express.Router();

const operacionController = require('../controllers/operacion.controller');

/**
 * HU010 - Panel principal de operación
 *
 * Lista inspecciones por sede con filtros y paginación.
 *
 * Endpoint:
 *
 * GET /api/operacion/inspecciones-dia
 *
 * Ejemplo:
 *
 * /api/operacion/inspecciones-dia
 * ?plantaKey=98
 * &fechaInicio=2026-06-01
 * &fechaFin=2026-06-10
 * &placa=ABC123
 * &estado=FINALIZADO
 * &numeroInspeccion=INS-098-000123456
 * &page=1
 * &pageSize=10
 */
router.get(
  '/inspecciones-dia',
  operacionController.listarInspecciones
);

router.get(
  '/lineas/:plantaKey',
  operacionController.listarLineas
);

module.exports = router;