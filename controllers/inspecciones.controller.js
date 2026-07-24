const inspeccionesService = require('../services/inspecciones.service');
const pool = require('../config/database');
const { guardarInspeccionTransaccion } = require('../services/guardar_inspeccion.service');
const { guardarDuplicadoTransaccion } = require('../services/guardar_duplicado.service');
const inspeccionesProcesoService = require('../services/inspecciones_proceso.service');
const anularService = require('../services/anular_inspeccion.service');
const errorImpresionService = require('../services/error_impresion.service');
const traspasoResultadosService = require('../services/traspaso_resultados.service');
const mtcService = require('../services/mtc.service');


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
    const bodyData = req.body;
    console.log("Datos recibidos para guardar la inspección:", Object.keys(bodyData));
    
    // Ejecutar transacción
    const resultado = await guardarInspeccionTransaccion(bodyData);
    
    return res.status(200).json({
      status: 'success',
      message: 'Inspección guardada correctamente',
      data: resultado
    });
  } catch (error) {
    console.error('Error al guardar inspección:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Error al procesar la inspección',
      error: error.message
    });
  }
};

const generarNroInspeccion = async (req, res) => {
  try {
    const { plantaKey } = req.params;
    if (!plantaKey) {
      return res.status(400).json({ status: 'error', message: 'plantaKey requerido' });
    }
    const nro = await inspeccionesProcesoService.generarNroInspeccion(plantaKey);
    res.json({ status: 'success', nrodocumentoinspeccion: nro });
  } catch (error) {
    console.error('Error generarNroInspeccion:', error);
    res.status(500).json({ status: 'error', message: 'Error al generar NRO Inspección', error: error.message });
  }
};

const guardarProceso = async (req, res) => {
  try {
    const bodyData = req.body;
    const resultado = await inspeccionesProcesoService.guardarProceso(bodyData);
    res.json(resultado);
  } catch (error) {
    console.error('Error guardarProceso:', error);
    res.status(200).json({ ok: false, message: error.message, status: 'error', posicionActual: req.body.posicionActual });
  }
};

const anularInspeccion = async (req, res) => {
  try {
    const { nrodocumentoinspeccion } = req.body;
    if (!nrodocumentoinspeccion) {
      return res.status(400).json({ status: 'error', message: 'nrodocumentoinspeccion requerido' });
    }
    const resultado = await inspeccionesProcesoService.anularInspeccion(nrodocumentoinspeccion);
    res.json(resultado);
  } catch (error) {
    console.error('Error anularInspeccion:', error);
    res.status(500).json({ status: 'error', message: 'Error al anular inspección', error: error.message });
  }
};

const anularInspeccionCompleta = async (req, res) => {
  try {
    const { nrodocumentoinspeccion } = req.params;
    const { motivo, observacion } = req.body;
    // req.user podria no tener session si auth esta deshabilitado, fallback 'sistemas'
    const username = req.user?.username || 'sistemas';

    if (!nrodocumentoinspeccion) {
      return res.status(400).json({ ok: false, message: 'nrodocumentoinspeccion requerido' });
    }

    const resultado = await anularService.anularInspeccionConMotivo(nrodocumentoinspeccion, motivo, observacion, username);
    res.json(resultado);
  } catch (error) {
    console.error('Error anularInspeccionCompleta:', error);
    res.status(400).json({ ok: false, message: error.message || 'Error al anular inspección' });
  }
};

const errorImpresion = async (req, res) => {
  try {
    const { nrodocumentoinspeccion } = req.params;
    const { motivo, observacion } = req.body;
    const username = req.user?.username || 'sistemas';

    if (!nrodocumentoinspeccion) {
      return res.status(400).json({ ok: false, message: 'nrodocumentoinspeccion requerido' });
    }
    if (!observacion || observacion.length < 5) {
      return res.status(400).json({ ok: false, message: 'La observación debe tener más de 5 caracteres' });
    }

    const resultado = await errorImpresionService.errorImpresion(nrodocumentoinspeccion, observacion, motivo, username);
    res.json(resultado);
  } catch (error) {
    console.error('Error errorImpresion:', error);
    res.status(400).json({ ok: false, message: error.message || 'Error al reportar impresión fallida' });
  }
};

const consultarVehiculoYCaja = async (req, res) => {
  try {
    const { placa, concepto, categoria, tipoInspeccion, tipoCertificado, tipoAutorizacion, plantaKey } = req.body;

    if (!placa || !concepto || !plantaKey) {
      return res.status(400).json({ status: 'error', message: 'Placa, concepto y planta son obligatorios' });
    }

    const resultado = await inspeccionesService.consultarVehiculoYCajaService({
      placa, concepto, plantaKey, categoria, tipoInspeccion, tipoCertificado, tipoAutorizacion
    });

    res.json({
      status: 'success',
      data: resultado
    });
  } catch (error) {
    console.error('Error al consultar vehiculo/caja:', error);
    if (error.message && error.message.includes('No puede haber duplicados')) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    res.status(500).json({ status: 'error', message: 'Error interno del servidor', error: error.message });
  }
};

const buscarDescuentos = async (req, res) => {
  try {
    const { documento, concepto, placaContexto, soloDniCodigo } = req.query;

    if (!documento || !concepto) {
      return res.status(400).json({ status: 'error', message: 'El documento y el concepto son obligatorios' });
    }

    const descuentos = await inspeccionesService.buscarDescuentosService({ 
      documento, 
      concepto, 
      placaContexto, 
      soloDniCodigo 
    });

    res.json({
      status: 'success',
      data: descuentos
    });
  } catch (error) {
    console.error('Error al buscar descuentos:', error);
    res.status(500).json({ status: 'error', message: 'Error interno del servidor al buscar descuentos', error: error.message });
  }
};

const consumirDescuento = async (req, res) => {
  try {
    const { source_table, source_id } = req.body;
    console.log(`=== CONSUMIR DESCUENTO === table: ${source_table}, id: ${source_id}`);

    if (!source_table || !source_id) {
      return res.status(400).json({ status: 'error', message: 'Faltan datos del descuento a consumir' });
    }

    const resultado = await inspeccionesService.consumirDescuentoService({ source_table, source_id });
    console.log('Resultado consumirDescuento:', resultado);
    res.json({
      status: 'success',
      data: resultado
    });
  } catch (error) {
    console.error('Error al consumir descuento:', error);
    res.status(500).json({ status: 'error', message: 'Error interno del servidor al consumir descuento', error: error.message });
  }
};

const consultarReinspeccion = async (req, res) => {
  try {
    const { placa, concepto, planta } = req.params;
    
    if (!placa || !concepto || !planta) {
      return res.status(400).json({ status: 'error', message: 'Faltan parámetros' });
    }

    const resultado = await inspeccionesService.consultarReinspeccionService(placa, concepto, planta);
    
    res.json({
      status: 'success',
      data: resultado
    });
  } catch (error) {
    console.error('Error al consultar reinspección:', error);
    res.status(500).json({ status: 'error', message: 'Error interno del servidor' });
  }
};

const consultarVehiculoRapido = async (req, res) => {
  try {
    const { placa } = req.params;
    if (!placa) {
      return res.status(400).json({ status: 'error', message: 'Placa requerida' });
    }
    const veh = await inspeccionesService.consultarVehiculoRapido(placa);
    res.json({ status: 'success', data: veh });
  } catch (error) {
    console.error('Error al consultar vehiculo rapido:', error);
    res.status(500).json({ status: 'error', message: 'Error interno' });
  }
};

const validarCuponidad = async (req, res) => {
  try {
    const { codigo } = req.params;
    if (!codigo) {
      return res.status(400).json({ status: 'error', message: 'Código de cuponidad requerido' });
    }

    const pool = require('../config/database');
    // Verificamos si el código ya existe en un pago de tarjeta '5' (Cuponidad)
    // asociado a un comprobante que no esté anulado (estado = true)
    const query = `
      SELECT p.id, c.nrocomprobante 
      FROM pago p
      INNER JOIN comprobante c ON p.comprobante_id = c.id
      WHERE p.tarjeta_key = '5' 
        AND p.nrooperaciontarjeta = $1
        AND c.estado = true
      LIMIT 1
    `;
    const result = await pool.query(query, [codigo]);

    if (result.rows.length > 0) {
      return res.status(400).json({ 
        status: 'error', 
        message: `El código de Cuponidad ya fue canjeado en el comprobante ${result.rows[0].nrocomprobante}` 
      });
    }

    res.json({ status: 'success', message: 'Código válido' });
  } catch (error) {
    console.error('Error al validar cuponidad:', error);
    res.status(500).json({ status: 'error', message: 'Error interno al validar cuponidad' });
  }
};

const consultarReinspeccionesActivas = async (req, res) => {
  try {
    const { placa } = req.params;
    if (!placa) {
      return res.status(400).json({ status: 'error', message: 'Placa es obligatoria' });
    }
    const activas = await inspeccionesService.consultarReinspeccionesActivasService(placa);
    res.json({ status: 'success', data: activas });
  } catch (error) {
    console.error('Error al consultar reinspecciones activas:', error);
    res.status(500).json({ status: 'error', message: 'Error interno del servidor', error: error.message });
  }
};

const obtenerProceso = async (req, res) => {
  try {
    const { nrodocumentoinspeccion } = req.params;
    const resultado = await inspeccionesProcesoService.obtenerProceso(nrodocumentoinspeccion);
    res.json(resultado);
  } catch (error) {
    console.error('Error obtenerProceso:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

const traspasarResultados = async (req, res) => {
  try {
    const { nro } = req.params;
    const { inspeccionNueva, placaNueva } = req.body;
    const { username } = req.user;

    const result = await traspasoResultadosService.traspasarResultados(
      nro, 
      inspeccionNueva, 
      placaNueva, 
      "Traspaso de resultados desde panel consolidado", 
      username
    );

    res.json(result);
  } catch (error) {
    console.error("Error traspasarResultados:", error);
    res.status(400).json({ error: error.message });
  }
};

const guardarDuplicado = async (req, res) => {
  try {
    const result = await guardarDuplicadoTransaccion(req.body);
    res.status(200).json({
      status: 'success',
      message: 'Duplicado generado correctamente',
      data: result
    });
  } catch (error) {
    console.error('Error al guardar duplicado:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Error interno del servidor'
    });
  }
};

const buscarInfoDuplicado = async (req, res) => {
  try {
    const { placa } = req.params;
    // La UI puede mandar plantaKey por body/query, pero siendo GET mejor query o asumimos SEDE por defecto
    const { plantaKey } = req.query; // Para enviar al MTC

    const client = await pool.connect();
    try {
      const inspResult = await client.query(`
        SELECT i.nrodocumentoinspeccion, c.conceptoinspeccion_key, i.tipoinspeccion_key, i.tipocertificado_key, i.tipoautorizacion_key, v.categoria_key, i.vehiculo_nromotor
        FROM inspeccion i
        JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
        JOIN vehiculo v ON v.nromotor = i.vehiculo_nromotor
        WHERE c.placamotor = $1 AND i.inspeccionestado_key IN ('APROBADO', 'CON')
        ORDER BY i.fechcreacion DESC
        LIMIT 1
      `, [placa]);
      if (inspResult.rows.length === 0) {
        return res.status(404).json({ status: 'error', message: 'No se encontró inspección aprobada para duplicado' });
      }

      const inspeccion = inspResult.rows[0];

      if (plantaKey) {
        // Validacion con MTC
        const vehiculoMtc = await mtcService.obtenerVehiculo(
          placa,
          plantaKey,
          inspeccion.tipoautorizacion_key || 0,
          inspeccion.tipoinspeccion_key || 0,
          inspeccion.tipocertificado_key || 0,
          inspeccion.categoria_key || 0
        );

        if (!vehiculoMtc) {
          // Si es null es que hubo un error o rechazo (comportamiento Legacy)
          return res.status(400).json({ status: 'error', message: 'Hubo un problema al obtener Vehiculo del MTC' });
        }
      }

      res.json({ status: 'success', data: { conceptoinspeccion_key: inspeccion.conceptoinspeccion_key } });
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

module.exports = {
  buscarInspecciones,
  guardarInspeccion,
  guardarDuplicado,
  buscarInfoDuplicado,
  generarNroInspeccion,
  guardarProceso,
  obtenerProceso,
  anularInspeccion,

  consultarVehiculoYCaja,
  buscarDescuentos,
  consumirDescuento,
  consultarReinspeccion,
  consultarVehiculoRapido,
  validarCuponidad,
  consultarReinspeccionesActivas,
  anularInspeccionCompleta,
  errorImpresion,
  traspasarResultados
};