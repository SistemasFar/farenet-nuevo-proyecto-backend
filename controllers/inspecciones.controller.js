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
      // Si ya existe, actualizamos posicion, estado y campos básicos de la inspección
      await pool.query(
        `UPDATE inspeccion SET 
          posicion = $1, 
          tipoinspeccion_key = $2, 
          tipocertificado_key = $3, 
          tipoautorizacion_key = $4,
          fechmodi = NOW() 
         WHERE nrodocumentoinspeccion = $5`,
        [
          currentStepIndex, 
          formCaja?.tipoInspeccion || null, 
          formCaja?.tipoCertificado || null, 
          formCaja?.tipoAutorizacion || null, 
          nroInspeccion
        ]
      );
      
      // Actualizamos comprobante
      const placa = formCaja?.placa || formVehiculo?.placaNueva || formVehiculo?.placa || '-';
      await pool.query(
        `UPDATE comprobante SET 
          placamotor = $1, 
          conceptoinspeccion_key = $2,
          totalsindscto = $3,
          totaldscto = $4,
          importetotal = $5,
          tipodocumento_key = $6,
          cliente_nrodocumentoidentidad = $7,
          fechmodi = NOW()
         WHERE inspeccion_nrodocumentoinspeccion = $8`,
        [
          placa, 
          formCaja?.concepto || null, 
          req.body.precioSubtotal || 0, 
          req.body.descuento || 0, 
          req.body.precioTotal || 0, 
          req.body.documentoPago || null, 
          req.body.documentoDescuento || null,
          nroInspeccion
        ]
      );

      // Actualizamos vehiculo si hay placa real
      if (placa && placa !== '-') {
        // Intentar actualizar primero
        const upRes = await pool.query(`
          UPDATE vehiculo SET 
            categoria_key = $1,
            categoriaextra = $2,
            vehiculoclase_key = $3,
            marca_key = $4,
            modelo_key = $5,
            color_key = $6,
            carroceria_key = $7,
            nroserie = $8,
            aniofabricacion = $9,
            combustible_key = $10,
            nrocilindros = $11,
            kilometraje = $12,
            nroasientos = $13,
            nropasajeros = $14,
            nropuertas = $15,
            nropisos = $16,
            nrosalidaemergencia = $17,
            pesoseco = $18,
            cargautil = $19,
            pesobruto = $20,
            longitud = $21,
            ancho = $22,
            alto = $23,
            nroejes = $24,
            nroruedas = $25,
            fechmodi = NOW()
          WHERE nroplacaantigua = $26
        `, [
          formCaja?.categoria || null,
          formVehiculo?.categoriaExtra || null,
          formVehiculo?.clase || null,
          formVehiculo?.marca || null,
          formVehiculo?.modelo || null,
          formVehiculo?.color || null,
          formVehiculo?.carroceria || null,
          formVehiculo?.nroSerie || null,
          formVehiculo?.anioFabricacion || null,
          formVehiculo?.combustible || null,
          formVehiculo?.nroCilindros || null,
          formVehiculo?.kilometraje || null,
          formVehiculo?.nroAsientos || null,
          formVehiculo?.nroPasajeros || null,
          formVehiculo?.nroPuertas || null,
          formVehiculo?.nroPisos || null,
          formVehiculo?.salidasEmergencia || null,
          formVehiculo?.pesoSeco || null,
          formVehiculo?.cargaUtil || null,
          formVehiculo?.pesoBruto || null,
          formVehiculo?.longitud || null,
          formVehiculo?.ancho || null,
          formVehiculo?.altura || null,
          formVehiculo?.nroEjes || null,
          formVehiculo?.nroRuedas || null,
          placa
        ]);

        // Si no se actualizó nada, intentar insertar solo si tenemos nromotor
        if (upRes.rowCount === 0 && formVehiculo?.nroMotor) {
          try {
            await pool.query(`
              INSERT INTO vehiculo (
                nroplacaantigua, nromotor, categoria_key, categoriaextra, vehiculoclase_key, marca_key,
                modelo_key, color_key, carroceria_key, nroserie, aniofabricacion, combustible_key,
                nrocilindros, kilometraje, nroasientos, nropasajeros, nropuertas, nropisos,
                nrosalidaemergencia, pesoseco, cargautil, pesobruto, longitud, ancho, alto, nroejes, nroruedas, fechcreacion
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, NOW()
              )
            `, [
              placa, formVehiculo?.nroMotor, formCaja?.categoria || null, formVehiculo?.categoriaExtra || null,
              formVehiculo?.clase || null, formVehiculo?.marca || null, formVehiculo?.modelo || null,
              formVehiculo?.color || null, formVehiculo?.carroceria || null, formVehiculo?.nroSerie || null,
              formVehiculo?.anioFabricacion || null, formVehiculo?.combustible || null, formVehiculo?.nroCilindros || null,
              formVehiculo?.kilometraje || null, formVehiculo?.nroAsientos || null, formVehiculo?.nroPasajeros || null,
              formVehiculo?.nroPuertas || null, formVehiculo?.nroPisos || null, formVehiculo?.salidasEmergencia || null,
              formVehiculo?.pesoSeco || null, formVehiculo?.cargaUtil || null, formVehiculo?.pesoBruto || null,
              formVehiculo?.longitud || null, formVehiculo?.ancho || null, formVehiculo?.altura || null,
              formVehiculo?.nroEjes || null, formVehiculo?.nroRuedas || null
            ]);
          } catch (e) {
            console.error('No se pudo insertar vehículo parcial', e.message);
          }
        }
      }
    }
    
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
    
    // Obtener datos de inspeccion y comprobante
    const insRes = await pool.query(
      `SELECT i.posicion, i.tipoinspeccion_key, i.tipocertificado_key, i.tipoautorizacion_key,
              c.placamotor, c.conceptoinspeccion_key, c.totalsindscto, c.totaldscto, c.importetotal,
              c.tipodocumento_key, c.cliente_nrodocumentoidentidad, SPLIT_PART(i.nrodocumentoinspeccion, '-', 2) as planta_key
       FROM inspeccion i
       LEFT JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
       WHERE i.nrodocumentoinspeccion = $1`,
      [id]
    );

    if (insRes.rows.length === 0) {
      return res.status(200).json({ status: 'success', data: null });
    }

    const ins = insRes.rows[0];
    const placa = ins.placamotor;
    
    // Obtener datos de vehiculo
    let veh = {};
    if (placa && placa !== '-') {
      const vehRes = await pool.query(`SELECT * FROM vehiculo WHERE nroplacaantigua = $1`, [placa]);
      if (vehRes.rows.length > 0) veh = vehRes.rows[0];
    }

    // Reconstruir formCaja
    const formCaja = {
      tipoPlaca: '', // UI only
      placa: placa !== '-' ? placa : '',
      concepto: ins.conceptoinspeccion_key || '',
      categoria: veh.categoria_key || '',
      tipoInspeccion: ins.tipoinspeccion_key || '',
      tipoCertificado: ins.tipocertificado_key || '',
      tipoAutorizacion: ins.tipoautorizacion_key || ''
    };

    // Reconstruir formVehiculo
    const formVehiculo = {
      placaNueva: placa !== '-' ? placa : '',
      categoriaExtra: veh.categoriaextra || '',
      clase: veh.vehiculoclase_key || '',
      marca: veh.marca_key || '',
      modelo: veh.modelo_key || '',
      color: veh.color_key || '',
      carroceria: veh.carroceria_key || '',
      nroSerie: veh.nroserie || '',
      nroMotor: veh.nromotor || '',
      anioFabricacion: veh.aniofabricacion || '',
      combustible: veh.combustible_key || '',
      nroCilindros: veh.nrocilindros || '',
      kilometraje: veh.kilometraje || '',
      nroAsientos: veh.nroasientos || '',
      nroPasajeros: veh.nropasajeros || '',
      nroPuertas: veh.nropuertas || '',
      nroPisos: veh.nropisos || '',
      salidasEmergencia: veh.nrosalidaemergencia || '',
      pesoSeco: veh.pesoseco || '',
      cargaUtil: veh.cargautil || '',
      pesoBruto: veh.pesobruto || '',
      longitud: veh.longitud || '',
      ancho: veh.ancho || '',
      altura: veh.alto || '',
      nroEjes: veh.nroejes || '',
      nroRuedas: veh.nroruedas || ''
    };

    const data = {
      currentStepIndex: ins.posicion || 0,
      plantaKey: ins.planta_key,
      formCaja,
      formVehiculo,
      pagosAgregados: [], // No se implementaron pagos parciales en bd según instrucciones
      isConsultado: Number(ins.totalsindscto) > 0,
      documentoPago: ins.tipodocumento_key || '',
      precioSubtotal: Number(ins.totalsindscto) || 0,
      descuento: Number(ins.totaldscto) || 0,
      precioTotal: Number(ins.importetotal) || 0,
      documentoDescuento: ins.cliente_nrodocumentoidentidad || ''
    };

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

    // En lugar de borrar de las 3 tablas, actualizamos el estado a ANULADO
    await pool.query("UPDATE inspeccion SET inspeccionestado_key = 'ANULADO', fechmodi = NOW() WHERE nrodocumentoinspeccion = $1", [id]);
    
    // Eliminamos el JSON temporal para que ya no se pueda editar como borrador activo
    await pool.query('DELETE FROM borrador_estado WHERE inspeccion_id = $1', [id]);
    // Mantenemos el comprobante temporal para el historial

    return res.status(200).json({
      status: 'success',
      message: 'Borrador anulado correctamente'
    });
  } catch (error) {
    console.error('Error al anular borrador:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Error al anular borrador',
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