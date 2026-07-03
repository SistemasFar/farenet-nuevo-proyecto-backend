const inspeccionesService = require('../services/inspecciones.service');
const pool = require('../config/database');
const { guardarInspeccionTransaccion } = require('../services/guardar_inspeccion.service');


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

const guardarBorrador = async (req, res) => {
  try {
    const { idBorrador, currentStepIndex, plantaKey, formCaja, formVehiculo } = req.body;
    
    let nroInspeccion = idBorrador;
    const uiMetadata = JSON.stringify(req.body);

    // [BUENA PRÁCTICA] Declarar la placa una sola vez al inicio para que esté disponible en todo el alcance (scope)
    const placaGlobal = formVehiculo?.placaNueva || formVehiculo?.placa || formCaja?.placa || '-';

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

      // Insertar en inspeccion con los campos del borrador
      await pool.query(
        `INSERT INTO inspeccion (
          nrodocumentoinspeccion, posicion, estado, fechcreacion, inspeccionestado_key, indicedesaprobado,
          tipoinspeccion_key, tipocertificado_key, tipoautorizacion_key, ui_metadata
        ) VALUES ($1, $2, true, NOW(), 'PROCESO', 0, $3, $4, $5, $6)`,
        [
          nroInspeccion, 
          currentStepIndex,
          req.body.formVerificacion?.tipoInspeccion || formCaja?.tipoInspeccion || null,
          req.body.formVerificacion?.tipoCertificado || formCaja?.tipoCertificado || null,
          req.body.formVerificacion?.tipoAutorizacion || formCaja?.tipoAutorizacion || null,
          uiMetadata
        ]
      );

      // Insertar también en borrador_estado para mantener compatibilidad con InicioView
      await pool.query(
        `INSERT INTO borrador_estado (inspeccion_id, estado_json) VALUES ($1, $2)`,
        [nroInspeccion, uiMetadata]
      );

      const lineaResult = await pool.query(
        `SELECT key FROM linea WHERE planta_key = $1 LIMIT 1`,
        [pKey]
      );
      const randomLinea = lineaResult.rows.length > 0 ? lineaResult.rows[0].key : null;

      // Obtener el siguiente ID de comprobante
      const compRes = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM comprobante`);
      const nextCompId = compRes.rows[0].next_id;

      // Insertar un comprobante temporal con los campos
      await pool.query(
        `INSERT INTO comprobante (
          id, nrocomprobante, inspeccion_nrodocumentoinspeccion, placamotor, cliente_nrodocumentoidentidad, linea_key, fechcreacion,
          importetotal, totaldscto, totalsindscto, conceptoinspeccion_key, tipodocumento_key
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11)`,
        [
          nextCompId, 
          `BORRADOR-${nextNumVal}`, 
          nroInspeccion, 
          placaGlobal, 
          req.body.documentoDescuento || '-', 
          req.body.formVerificacion?.linea || randomLinea,
          req.body.precioTotal || 0,
          req.body.descuento || 0,
          req.body.precioSubtotal || 0,
          formCaja?.concepto || null,
          req.body.documentoPago || null
        ]
      );
    } else {
      // Si ya existe, actualizamos posicion, estado y campos básicos de la inspección
      await pool.query(
        `UPDATE inspeccion SET 
          posicion = $1, 
          tipoinspeccion_key = $2, 
          tipocertificado_key = $3, 
          tipoautorizacion_key = $4,
          ui_metadata = $5,
          fechmodi = NOW() 
         WHERE nrodocumentoinspeccion = $6`,
        [
          currentStepIndex, 
          req.body.formVerificacion?.tipoInspeccion || formCaja?.tipoInspeccion || null, 
          req.body.formVerificacion?.tipoCertificado || formCaja?.tipoCertificado || null, 
          req.body.formVerificacion?.tipoAutorizacion || formCaja?.tipoAutorizacion || null, 
          uiMetadata,
          nroInspeccion
        ]
      );

      // Actualizar borrador_estado para mantener compatibilidad con InicioView
      await pool.query(
        `UPDATE borrador_estado SET estado_json = $1 WHERE inspeccion_id = $2`,
        [uiMetadata, nroInspeccion]
      );
      
      // Actualizamos comprobante
      await pool.query(
        `UPDATE comprobante SET 
          placamotor = $1, 
          conceptoinspeccion_key = $2,
          totalsindscto = $3,
          totaldscto = $4,
          importetotal = $5,
          tipodocumento_key = $6,
          cliente_nrodocumentoidentidad = $7,
          linea_key = $8,
          fechmodi = NOW()
         WHERE inspeccion_nrodocumentoinspeccion = $9`,
        [
          placaGlobal, 
          formCaja?.concepto || null,
          req.body.precioSubtotal || 0, 
          req.body.descuento || 0, 
          req.body.precioTotal || 0, 
          req.body.documentoPago || null, 
          req.body.documentoDescuento || null,
          req.body.formVerificacion?.linea || null,
          nroInspeccion
        ]
      );

      // Actualizamos vehiculo si hay placa real
      if (placaGlobal && placaGlobal !== '-') {
        // En lugar de requerir que el usuario digite el motor, usaremos uno temporal si no lo hay (max 20 chars)
        const motorAUsar = formVehiculo?.nroMotor || nroInspeccion;
        
        // Intentar actualizar usando la placa o el motor temporal
        const upRes = await pool.query(`
          UPDATE vehiculo SET 
            categoria_key = COALESCE($1, categoria_key),
            categoriaextra = COALESCE($2, categoriaextra),
            vehiculoclase_key = COALESCE($3, vehiculoclase_key),
            marca_key = COALESCE($4, marca_key),
            modelo_key = COALESCE($5, modelo_key),
            color_key = COALESCE($6, color_key),
            carroceria_key = COALESCE($7, carroceria_key),
            nroserie = COALESCE($8, nroserie),
            aniofabricacion = COALESCE($9, aniofabricacion),
            combustible_key = COALESCE($10, combustible_key),
            nrocilindros = COALESCE($11, nrocilindros),
            kilometraje = COALESCE($12, kilometraje),
            nroasientos = COALESCE($13, nroasientos),
            nropasajeros = COALESCE($14, nropasajeros),
            nropuertas = COALESCE($15, nropuertas),
            nropisos = COALESCE($16, nropisos),
            nrosalidaemergencia = COALESCE($17, nrosalidaemergencia),
            pesoseco = COALESCE($18, pesoseco),
            cargautil = COALESCE($19, cargautil),
            pesobruto = COALESCE($20, pesobruto),
            longitud = COALESCE($21, longitud),
            ancho = COALESCE($22, ancho),
            alto = COALESCE($23, alto),
            nroejes = COALESCE($24, nroejes),
            nroruedas = COALESCE($25, nroruedas),
            marcacarroceria = COALESCE($26, marcacarroceria),
            fechiniciotarjetapropiedad = COALESCE($27, fechiniciotarjetapropiedad),
            fechfintarjetapropiedad = COALESCE($28, fechfintarjetapropiedad),
            fechmodi = NOW()
          WHERE nroplacaantigua = $29 OR nromotor = $30
        `, [
          formCaja?.categoria || null, formVehiculo?.categoriaExtra || null, formVehiculo?.clase || null, formVehiculo?.marca || null,
          formVehiculo?.modelo || null, formVehiculo?.color || null, formVehiculo?.carroceria || null, formVehiculo?.nroSerie || null,
          formVehiculo?.anioFabricacion || null, formVehiculo?.combustible || null, formVehiculo?.nroCilindros || null,
          formVehiculo?.kilometraje || null, formVehiculo?.nroAsientos || null, formVehiculo?.nroPasajeros || null,
          formVehiculo?.nroPuertas || null, formVehiculo?.nroPisos || null, formVehiculo?.salidasEmergencia || null,
          formVehiculo?.pesoSeco || null, formVehiculo?.cargaUtil || null, formVehiculo?.pesoBruto || null,
          formVehiculo?.longitud || null, formVehiculo?.ancho || null, formVehiculo?.altura || null,
          formVehiculo?.nroEjes || null, formVehiculo?.nroRuedas || null, formVehiculo?.marcaCarroceria || null, 
          formVehiculo?.inicioSoat || null, formVehiculo?.finSoat || null, placaGlobal, motorAUsar
        ]);

        // Si no se actualizó nada, significa que no existe. Lo creamos usando valores por defecto para los NOT NULL.
        if (upRes.rowCount === 0) {
          try {
            await pool.query(`
              INSERT INTO vehiculo (
                nroplacaantigua, nromotor, categoria_key, categoriaextra, vehiculoclase_key, marca_key,
                modelo_key, color_key, carroceria_key, nroserie, aniofabricacion, combustible_key,
                nrocilindros, kilometraje, nroasientos, nropasajeros, nropuertas, nropisos,
                nrosalidaemergencia, pesoseco, cargautil, pesobruto, longitud, ancho, alto, nroejes, nroruedas, 
                distanciaeje1, distanciaeje2, distanciaeje3, distanciaeje4, marcacarroceria, 
                fechiniciotarjetapropiedad, fechfintarjetapropiedad, fechcreacion
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                COALESCE($14, 0), $15, $16, $17, $18, $19,
                COALESCE($20, 0), COALESCE($21, 0), COALESCE($22, 0), COALESCE($23, 0), COALESCE($24, 0), COALESCE($25, 0),
                $26, $27, 0, 0, 0, 0, $28, $29, $30, NOW()
              )
            `, [
              placaGlobal, motorAUsar, formCaja?.categoria || null, formVehiculo?.categoriaExtra || null,
              formVehiculo?.clase || null, formVehiculo?.marca || null, formVehiculo?.modelo || null,
              formVehiculo?.color || null, formVehiculo?.carroceria || null, formVehiculo?.nroSerie || null,
              formVehiculo?.anioFabricacion || null, formVehiculo?.combustible || null, formVehiculo?.nroCilindros || null,
              formVehiculo?.kilometraje || null, formVehiculo?.nroAsientos || null, formVehiculo?.nroPasajeros || null,
              formVehiculo?.nroPuertas || null, formVehiculo?.nroPisos || null, formVehiculo?.salidasEmergencia || null,
              formVehiculo?.pesoSeco || null, formVehiculo?.cargaUtil || null, formVehiculo?.pesoBruto || null,
              formVehiculo?.longitud || null, formVehiculo?.ancho || null, formVehiculo?.altura || null,
              formVehiculo?.nroEjes || null, formVehiculo?.nroRuedas || null, formVehiculo?.marcaCarroceria || null,
              formVehiculo?.inicioSoat || null, formVehiculo?.finSoat || null
            ]);
            
            // Enlazar la inspección a este motor temporal
            await pool.query(`UPDATE inspeccion SET vehiculo_nromotor = $1 WHERE nrodocumentoinspeccion = $2`, [motorAUsar, nroInspeccion]);
          } catch (e) {
            console.error('No se pudo insertar vehículo parcial:', e.message);
          }
        }
      }
    }

    // Paso 2: Pagos Agregados
    const pagosAgregados = req.body.pagosAgregados || [];
    if (Array.isArray(pagosAgregados)) {
      const compRes = await pool.query(`SELECT id FROM comprobante WHERE inspeccion_nrodocumentoinspeccion = $1`, [nroInspeccion]);
      if (compRes.rows.length > 0) {
        const compId = compRes.rows[0].id;
        await pool.query(`DELETE FROM pago WHERE comprobante_id = $1`, [compId]);
        
        for (const pago of pagosAgregados) {
          await pool.query(`
            INSERT INTO pago (
              id, comprobante_id, importe, tipocontado_key, tarjeta_key, entidadfinanciera_key, 
              cuentacorriente_key, nrooperacionbanco, nrooperaciontarjeta, digitotarjeta, fechdeposito, fechacreacion
            ) VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM pago), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
          `, [
            compId, 
            pago.importe || 0, 
            pago.tipo ? pago.tipo.toLowerCase() : null,
            pago.tarjetaKey || null,
            pago.entidadFinancieraKey || null,
            pago.cuentaCorrienteKey || null,
            pago.tipo === 'BANCO' ? pago.nroOperacion : null,
            pago.tipo === 'TARJETA' ? pago.nroOperacion : null,
            pago.digitosTarjeta || null,
            pago.fechaDeposito || null
          ]);
        }
      }
    }

    // Paso 3: Datos Adicionales de Vehículo (Propietario y SOAT)
    if (formVehiculo) {
      const motorAUsar = formVehiculo.nroMotor || nroInspeccion;
      if (!formVehiculo.sinDni && formVehiculo.nroDocProp) {
        const perRes = await pool.query(`SELECT nrodocumentoidentidad FROM persona WHERE nrodocumentoidentidad = $1`, [formVehiculo.nroDocProp]);
        if (perRes.rows.length === 0) {
          await pool.query(`
            INSERT INTO persona (
              nrodocumentoidentidad, tipodocumentoidentidad_key, nombrerazonsocial, nombres, apellidos,
              pais_key, departamento_key, provincia_key, distrito_key, direccion,
              email, telefono, fechcreacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          `, [
            formVehiculo.nroDocProp, formVehiculo.tipoDocProp || null, formVehiculo.razonSocialProp || null, formVehiculo.nombresProp || null, formVehiculo.apellidosProp || null,
            formVehiculo.paisProp || null, formVehiculo.departamentoProp || null, formVehiculo.provinciaProp || null,
            formVehiculo.distritoProp || null, formVehiculo.direccionProp || null, formVehiculo.emailProp || null, formVehiculo.telefonoProp || null
          ]);
        } else {
          await pool.query(`
            UPDATE persona SET
              tipodocumentoidentidad_key = $1,
              nombrerazonsocial = $2,
              nombres = $3,
              apellidos = $4,
              pais_key = $5,
              departamento_key = $6,
              provincia_key = $7,
              distrito_key = $8,
              direccion = $9,
              email = $10,
              telefono = $11,
              fechmodi = NOW()
            WHERE nrodocumentoidentidad = $12
          `, [
            formVehiculo.tipoDocProp || null, formVehiculo.razonSocialProp || null, formVehiculo.nombresProp || null, formVehiculo.apellidosProp || null,
            formVehiculo.paisProp || null, formVehiculo.departamentoProp || null, formVehiculo.provinciaProp || null,
            formVehiculo.distritoProp || null, formVehiculo.direccionProp || null, formVehiculo.emailProp || null, formVehiculo.telefonoProp || null,
            formVehiculo.nroDocProp
          ]);
        }

        const placaToUse = placaGlobal;
        let tpRes = await pool.query(`SELECT id FROM tarjetapropiedad WHERE nroplaca = $1`, [placaToUse]);
        let tpId = null;
        if (tpRes.rows.length === 0) {
          const tpResMax = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM tarjetapropiedad`);
          const nextTpId = tpResMax.rows[0].next_id;
          
          await pool.query(`
            INSERT INTO tarjetapropiedad (id, nroplaca, propietario_nrodocumentoidentidad, fechcreacion)
            VALUES ($1, $2, $3, NOW())
          `, [nextTpId, placaToUse, formVehiculo.nroDocProp]);
          tpId = nextTpId;
        } else {
          tpId = tpRes.rows[0].id;
          await pool.query(`
            UPDATE tarjetapropiedad SET propietario_nrodocumentoidentidad = $1, fechmodi = NOW()
            WHERE id = $2
          `, [formVehiculo.nroDocProp, tpId]);
        }

        await pool.query(`
          UPDATE vehiculo SET 
            tarjetapropiedad_id = $1,
            nrosoat = COALESCE($2, nrosoat),
            tipopoliza_key = COALESCE($3, tipopoliza_key),
            aseguradora_key = COALESCE($4, aseguradora_key),
            fechiniciotarjetapropiedad = COALESCE($5, fechiniciotarjetapropiedad),
            fechfintarjetapropiedad = COALESCE($6, fechfintarjetapropiedad)
          WHERE nromotor = $7
        `, [
          tpId, formVehiculo.nroSoat || null, formVehiculo.tipoPoliza || null, formVehiculo.aseguradora || null,
          formVehiculo.inicioSoat || null, formVehiculo.finSoat || null, motorAUsar
        ]);
      }
    }

    // Paso 4: Datos de Facturación (Cliente)
    if (req.body.formFacturacion && req.body.formFacturacion.nroDocFac) {
      const formFacturacion = req.body.formFacturacion;
      const cliRes = await pool.query(`SELECT nrodocumentoidentidad FROM persona WHERE nrodocumentoidentidad = $1`, [formFacturacion.nroDocFac]);
      if (cliRes.rows.length === 0) {
        await pool.query(`
          INSERT INTO persona (
            nrodocumentoidentidad, tipodocumentoidentidad_key, nombrerazonsocial, nombres, apellidos,
            pais_key, departamento_key, provincia_key, distrito_key, direccion,
            email, telefono, fechcreacion
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        `, [
          formFacturacion.nroDocFac, formFacturacion.tipoDocFac || null, formFacturacion.razonSocialFac || null, formFacturacion.nombresFac || null, formFacturacion.apellidosFac || null,
          formFacturacion.paisFac || null, formFacturacion.departamentoFac || null, formFacturacion.provinciaFac || null,
          formFacturacion.distritoFac || null, formFacturacion.direccionFac || null, formFacturacion.emailFac || null, formFacturacion.telefonoFac || null
        ]);
      } else {
        await pool.query(`
          UPDATE persona SET
            tipodocumentoidentidad_key = $1,
            nombrerazonsocial = $2,
            nombres = $3,
            apellidos = $4,
            pais_key = $5,
            departamento_key = $6,
            provincia_key = $7,
            distrito_key = $8,
            direccion = $9,
            email = $10,
            telefono = $11,
            fechmodi = NOW()
          WHERE nrodocumentoidentidad = $12
        `, [
          formFacturacion.tipoDocFac || null, formFacturacion.razonSocialFac || null, formFacturacion.nombresFac || null, formFacturacion.apellidosFac || null,
          formFacturacion.paisFac || null, formFacturacion.departamentoFac || null, formFacturacion.provinciaFac || null,
          formFacturacion.distritoFac || null, formFacturacion.direccionFac || null, formFacturacion.emailFac || null, formFacturacion.telefonoFac || null,
          formFacturacion.nroDocFac
        ]);
      }
      
      // Update comprobante with the client's document
      await pool.query(`UPDATE comprobante SET cliente_nrodocumentoidentidad = $1 WHERE inspeccion_nrodocumentoinspeccion = $2`, [formFacturacion.nroDocFac, nroInspeccion]);
    }
    
    // --- NUEVO: Guardar en la tabla pago si hay pagos agregados en el borrador ---
    const pagos = req.body.pagosAgregados || [];
    if (pagos.length > 0) {
      const compRes = await pool.query(`SELECT id FROM comprobante WHERE inspeccion_nrodocumentoinspeccion = $1`, [nroInspeccion]);
      if (compRes.rows.length > 0) {
        const compId = compRes.rows[0].id;
        
        // Limpiar pagos anteriores para este comprobante y reemplazarlos
        await pool.query(`DELETE FROM pago WHERE comprobante_id = $1`, [compId]);
        
        for (const pago of pagos) {
          const pagoRes = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM pago`);
          const nextPagoId = pagoRes.rows[0].next_id;
          
          await pool.query(`
            INSERT INTO pago (
              id, comprobante_id, tipocontado_key, importe, tarjeta_key, entidadfinanciera_key, cuentacorriente_key,
              nrooperaciontarjeta, digitotarjeta, nrooperacionbanco, fechdeposito, fechacreacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          `, [
            nextPagoId,
            compId,
            pago.tipo || 'EFECTIVO',
            pago.importe || 0,
            pago.tarjetaKey || null,
            pago.entidadFinancieraKey || null,
            pago.cuentaCorrienteKey || null,
            pago.nroOperacion || null,
            pago.digitosTarjeta || null,
            pago.nroOperacion || null,
            pago.fechaDeposito || null
          ]);
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
      `SELECT i.posicion, i.tipoinspeccion_key, i.tipocertificado_key, i.tipoautorizacion_key, i.ui_metadata,
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
    
    // Extraer ui_metadata de inspeccion si existe
    const uiMetadata = typeof ins.ui_metadata === 'string' ? JSON.parse(ins.ui_metadata) : (ins.ui_metadata || {});

    // El borrador guarda exactamente el req.body del frontend, así que simplemente lo devolvemos
    const data = {
      ...uiMetadata,
      idBorrador: id,
      currentStepIndex: parseInt(ins.posicion || 0),
      plantaKey: ins.planta_key
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

module.exports = {
  buscarInspecciones,
  guardarInspeccion,
  guardarBorrador,
  obtenerBorrador,
  eliminarBorrador,
  consultarVehiculoYCaja,
  buscarDescuentos,
  consumirDescuento,
  consultarReinspeccion,
  consultarVehiculoRapido,
  validarCuponidad,
  consultarReinspeccionesActivas
};