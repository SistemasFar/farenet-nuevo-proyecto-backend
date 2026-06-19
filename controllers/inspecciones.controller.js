const inspeccionesService = require('../services/inspecciones.service');
const pool = require('../config/database');


const buscarInspecciones = async (req, res) => {
  try {
    const {
      plantaKey,
      numeroInspeccion,
      placa,
      comprobante,
      cliente,
      fechaInicio,
      fechaFin,
      estado,
      page = 1,
      pageSize = 10
    } = req.query;

    if (!plantaKey) {
      return res.status(400).json({
        status: 'error',
        message: 'El parámetro plantaKey es obligatorio'
      });
    }

    const result = await inspeccionesService.buscarInspecciones({
      plantaKey,
      numeroInspeccion,
      placa,
      comprobante,
      cliente,
      fechaInicio,
      fechaFin,
      estado,
      page: Number(page),
      pageSize: Number(pageSize)
    });

    return res.json({
      status: 'success',
      plantaKey,
      ...result
    });
  } catch (error) {
    console.error('Error en buscarInspecciones:', error);

    return res.status(500).json({
      status: 'error',
      message: 'Error al buscar inspecciones registradas'
    });
  }
};

const cajaService = require('../services/caja.service');
const pagoService = require('../services/pago.service');
const vehiculoService = require('../services/vehiculo.service');

const guardarInspeccion = async (req, res) => {
  try {
    const { formCaja, pagosAgregados, formVehiculo } = req.body;
    console.log("Datos recibidos para guardar la inspección:", req.body);
    
    // Procesar cada sección de forma independiente
    const resCaja = await cajaService.guardarCaja(formCaja);
    const resPago = await pagoService.guardarPago(pagosAgregados);
    const resVehiculo = await vehiculoService.guardarVehiculo(formVehiculo, formCaja);
    
    // Aquí implementaremos la lógica de guardado de la inspección final
    
    return res.status(200).json({
      status: 'success',
      message: 'Inspección guardada correctamente (Arquitectura desacoplada)',
      data: {
        caja: resCaja,
        pago: resPago,
        vehiculo: resVehiculo
      }
    });
  } catch (error) {
    console.error('Error al guardar inspección:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Error al guardar la inspección en la base de datos'
    });
  }
};

const guardarBorrador = async (req, res) => {
  try {
    const { idBorrador, currentStepIndex, plantaKey, formCaja, formVehiculo } = req.body;
    
    let nroInspeccion = idBorrador;

    // Si no hay idBorrador, generamos uno nuevo y hacemos INSERT
    if (!nroInspeccion) {
      const pKey = plantaKey || '201';
      
      const numResult = await pool.query(
        `SELECT COALESCE(MAX(SPLIT_PART(nrodocumentoinspeccion, '-', 3)::INTEGER), 0) + 1 AS next_num
         FROM inspeccion WHERE SPLIT_PART(nrodocumentoinspeccion, '-', 2) = $1`,
        [pKey]
      );
      
      const nextNum = numResult.rows[0].next_num;
      const nextNumVal = String(nextNum).padStart(9, '0');
      nroInspeccion = `INS-${pKey}-${nextNumVal}`;

      console.log('--- POST BORRADOR --- generated nroInspeccion:', nroInspeccion);

      // Insertar en inspeccion
      await pool.query(
        `INSERT INTO inspeccion (
          nrodocumentoinspeccion, posicion, estado, fechcreacion, inspeccionestado_key, indicedesaprobado
        ) VALUES ($1, $2, true, NOW(), 'PROCESO', 0)`,
        [nroInspeccion, currentStepIndex]
      );

      const lineaResult = await pool.query(
        `SELECT key FROM linea WHERE planta_key = $1 LIMIT 1`,
        [pKey]
      );
      const randomLinea = lineaResult.rows.length > 0 ? lineaResult.rows[0].key : null;

      // Obtener el siguiente ID de comprobante
      const compRes = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM comprobante`);
      const nextCompId = compRes.rows[0].next_id;

      // Insertar un comprobante temporal para que listarInspecciones lo encuentre
      const placa = formCaja?.placa || formVehiculo?.placa || '-';
      await pool.query(
        `INSERT INTO comprobante (
          id, nrocomprobante, inspeccion_nrodocumentoinspeccion, placamotor, cliente_nrodocumentoidentidad, linea_key, fechcreacion,
          importetotal, totaldscto, totalsindscto
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), 0, 0, 0)`,
        [nextCompId, `BORRADOR-${nextNum}`, nroInspeccion, placa, '-', randomLinea]
      );
    } else {
      // Si ya existe, hacemos UPDATE de la posición y placa
      await pool.query(
        `UPDATE inspeccion SET posicion = $1, fechmodi = NOW() WHERE nrodocumentoinspeccion = $2`,
        [currentStepIndex, nroInspeccion]
      );
      
      const placa = formCaja?.placa || formVehiculo?.placa || '-';
      await pool.query(
        `UPDATE comprobante SET placamotor = $1 WHERE inspeccion_nrodocumentoinspeccion = $2`,
        [placa, nroInspeccion]
      );
    }

    // Guardar el estado JSON en la tabla borrador_estado
    const estadoJson = JSON.stringify({
      currentStepIndex,
      plantaKey,
      formCaja,
      formVehiculo,
      pagosAgregados: req.body.pagosAgregados || [],
      isConsultado: req.body.isConsultado,
      documentoPago: req.body.documentoPago,
      precioSubtotal: req.body.precioSubtotal,
      descuento: req.body.descuento,
      precioTotal: req.body.precioTotal,
      documentoDescuento: req.body.documentoDescuento
    });

    await pool.query(`
      INSERT INTO borrador_estado (inspeccion_id, estado_json)
      VALUES ($1, $2)
      ON CONFLICT (inspeccion_id)
      DO UPDATE SET estado_json = EXCLUDED.estado_json
    `, [nroInspeccion, estadoJson]);
    
    return res.status(200).json({
      status: 'success',
      message: 'Borrador guardado',
      data: {
        idBorrador: nroInspeccion
      }
    });
  } catch (error) {
    console.error('Error al guardar borrador:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Error al guardar el borrador',
      error: error.message
    });
  }
};

const obtenerBorrador = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT estado_json FROM borrador_estado WHERE inspeccion_id = $1`,
      [id]
    );

    let data = null;
    if (result.rows.length > 0) {
      data = JSON.parse(result.rows[0].estado_json);
    }

    return res.status(200).json({
      status: 'success',
      data
    });
  } catch (error) {
    console.error('Error al recuperar borrador:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Error al recuperar borrador',
      error: error.message
    });
  }
};

const eliminarBorrador = async (req, res) => {
  try {
    const { id } = req.params;

    // Eliminar de las 3 tablas
    await pool.query('DELETE FROM borrador_estado WHERE inspeccion_id = $1', [id]);
    await pool.query('DELETE FROM comprobante WHERE inspeccion_nrodocumentoinspeccion = $1', [id]);
    await pool.query('DELETE FROM inspeccion WHERE nrodocumentoinspeccion = $1', [id]);

    return res.status(200).json({
      status: 'success',
      message: 'Borrador eliminado correctamente'
    });
  } catch (error) {
    console.error('Error al eliminar borrador:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Error al eliminar borrador',
      error: error.message
    });
  }
};

module.exports = {
  buscarInspecciones,
  guardarInspeccion,
  guardarBorrador,
  obtenerBorrador,
  eliminarBorrador
};