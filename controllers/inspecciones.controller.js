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

      // Crear JSON para metadatos de interfaz que no pertenecen al modelo
      const uiMetadata = JSON.stringify({ tipoPlaca: formCaja?.tipoPlaca || '' });

      // Insertar en inspeccion con los campos del borrador
      await pool.query(
        `INSERT INTO inspeccion (
          nrodocumentoinspeccion, posicion, estado, fechcreacion, inspeccionestado_key, indicedesaprobado,
          tipoinspeccion_key, tipocertificado_key, tipoautorizacion_key, ui_metadata
        ) VALUES ($1, $2, true, NOW(), 'PROCESO', 0, $3, $4, $5, $6)`,
        [
          nroInspeccion, 
          currentStepIndex,
          formCaja?.tipoInspeccion || null,
          formCaja?.tipoCertificado || null,
          formCaja?.tipoAutorizacion || null,
          uiMetadata
        ]
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
      const placa = formCaja?.placa || formVehiculo?.placaNueva || formVehiculo?.placa || '-';
      await pool.query(
        `INSERT INTO comprobante (
          id, nrocomprobante, inspeccion_nrodocumentoinspeccion, placamotor, cliente_nrodocumentoidentidad, linea_key, fechcreacion,
          importetotal, totaldscto, totalsindscto, conceptoinspeccion_key, tipodocumento_key
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11)`,
        [
          nextCompId, 
          `BORRADOR-${nextNumVal}`, 
          nroInspeccion, 
          placa, 
          req.body.documentoDescuento || '-', 
          randomLinea,
          req.body.precioTotal || 0,
          req.body.descuento || 0,
          req.body.precioSubtotal || 0,
          formCaja?.concepto || null,
          req.body.documentoPago || null
        ]
      );
    } else {
      // Si ya existe, actualizamos posicion, estado y campos básicos de la inspección
      const uiMetadata = JSON.stringify({ tipoPlaca: formCaja?.tipoPlaca || '' });
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
          formCaja?.tipoInspeccion || null, 
          formCaja?.tipoCertificado || null, 
          formCaja?.tipoAutorizacion || null, 
          uiMetadata,
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
        // En lugar de requerir que el usuario digite el motor, usaremos uno temporal si no lo hay
        const motorAUsar = formVehiculo?.nroMotor || ('TMP-' + nroInspeccion);
        
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
            fechmodi = NOW()
          WHERE nroplacaantigua = $26 OR nromotor = $27
        `, [
          formCaja?.categoria || null, formVehiculo?.categoriaExtra || null, formVehiculo?.clase || null, formVehiculo?.marca || null,
          formVehiculo?.modelo || null, formVehiculo?.color || null, formVehiculo?.carroceria || null, formVehiculo?.nroSerie || null,
          formVehiculo?.anioFabricacion || null, formVehiculo?.combustible || null, formVehiculo?.nroCilindros || null,
          formVehiculo?.kilometraje || null, formVehiculo?.nroAsientos || null, formVehiculo?.nroPasajeros || null,
          formVehiculo?.nroPuertas || null, formVehiculo?.nroPisos || null, formVehiculo?.salidasEmergencia || null,
          formVehiculo?.pesoSeco || null, formVehiculo?.cargaUtil || null, formVehiculo?.pesoBruto || null,
          formVehiculo?.longitud || null, formVehiculo?.ancho || null, formVehiculo?.altura || null,
          formVehiculo?.nroEjes || null, formVehiculo?.nroRuedas || null, placa, motorAUsar
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
                distanciaeje1, distanciaeje2, distanciaeje3, distanciaeje4, fechcreacion
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                COALESCE($14, 0), $15, $16, $17, $18, $19,
                COALESCE($20, 0), COALESCE($21, 0), COALESCE($22, 0), COALESCE($23, 0), COALESCE($24, 0), COALESCE($25, 0),
                $26, $27, 0, 0, 0, 0, NOW()
              )
            `, [
              placa, motorAUsar, formCaja?.categoria || null, formVehiculo?.categoriaExtra || null,
              formVehiculo?.clase || null, formVehiculo?.marca || null, formVehiculo?.modelo || null,
              formVehiculo?.color || null, formVehiculo?.carroceria || null, formVehiculo?.nroSerie || null,
              formVehiculo?.anioFabricacion || null, formVehiculo?.combustible || null, formVehiculo?.nroCilindros || null,
              formVehiculo?.kilometraje || null, formVehiculo?.nroAsientos || null, formVehiculo?.nroPasajeros || null,
              formVehiculo?.nroPuertas || null, formVehiculo?.nroPisos || null, formVehiculo?.salidasEmergencia || null,
              formVehiculo?.pesoSeco || null, formVehiculo?.cargaUtil || null, formVehiculo?.pesoBruto || null,
              formVehiculo?.longitud || null, formVehiculo?.ancho || null, formVehiculo?.altura || null,
              formVehiculo?.nroEjes || null, formVehiculo?.nroRuedas || null
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
      const motorAUsar = formVehiculo.nroMotor || ('TMP-' + nroInspeccion);
      if (!formVehiculo.sinDni && formVehiculo.nroDocProp) {
        const perRes = await pool.query(`SELECT nrodocumentoidentidad FROM persona WHERE nrodocumentoidentidad = $1`, [formVehiculo.nroDocProp]);
        if (perRes.rows.length === 0) {
          await pool.query(`
            INSERT INTO persona (
              nrodocumentoidentidad, tipodocumentoidentidad_key, nombres, apellidos,
              pais_key, departamento_key, provincia_key, distrito_key, direccion,
              email, telefono, fechcreacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          `, [
            formVehiculo.nroDocProp, formVehiculo.tipoDocProp || null, formVehiculo.nombresProp || null, formVehiculo.apellidosProp || null,
            formVehiculo.paisProp || null, formVehiculo.departamentoProp || null, formVehiculo.provinciaProp || null,
            formVehiculo.distritoProp || null, formVehiculo.direccionProp || null, formVehiculo.emailProp || null, formVehiculo.telefonoProp || null
          ]);
        } else {
          await pool.query(`
            UPDATE persona SET
              tipodocumentoidentidad_key = $1,
              nombres = $2,
              apellidos = $3,
              pais_key = $4,
              departamento_key = $5,
              provincia_key = $6,
              distrito_key = $7,
              direccion = $8,
              email = $9,
              telefono = $10,
              fechmodi = NOW()
            WHERE nrodocumentoidentidad = $11
          `, [
            formVehiculo.tipoDocProp || null, formVehiculo.nombresProp || null, formVehiculo.apellidosProp || null,
            formVehiculo.paisProp || null, formVehiculo.departamentoProp || null, formVehiculo.provinciaProp || null,
            formVehiculo.distritoProp || null, formVehiculo.direccionProp || null, formVehiculo.emailProp || null, formVehiculo.telefonoProp || null,
            formVehiculo.nroDocProp
          ]);
        }

        const placaToUse = formVehiculo.placaNueva || placa || '-';
        let tpRes = await pool.query(`SELECT id FROM tarjetapropiedad WHERE nroplaca = $1`, [placaToUse]);
        let tpId = null;
        if (tpRes.rows.length === 0) {
          const tpInsert = await pool.query(`
            INSERT INTO tarjetapropiedad (nroplaca, propietario_nrodocumentoidentidad, fechcreacion)
            VALUES ($1, $2, NOW()) RETURNING id
          `, [placaToUse, formVehiculo.nroDocProp]);
          tpId = tpInsert.rows[0].id;
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
          formVehiculo.fechaEmisionSoat || null, formVehiculo.fechaVencimientoSoat || null, motorAUsar
        ]);
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
    
    // Obtener datos de vehiculo
    let veh = {};
    if (placa && placa !== '-') {
      const vehRes = await pool.query(`SELECT * FROM vehiculo WHERE nroplacaantigua = $1`, [placa]);
      if (vehRes.rows.length > 0) veh = vehRes.rows[0];
    }

    // Extraer ui_metadata de inspeccion si existe
    const uiMetadata = typeof ins.ui_metadata === 'string' ? JSON.parse(ins.ui_metadata) : (ins.ui_metadata || {});

    // Reconstruir formCaja
    const formCaja = {
      tipoPlaca: uiMetadata.tipoPlaca || '',
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
      nroRuedas: veh.nroruedas || '',
      nroSoat: veh.nrosoat || '',
      tipoPoliza: veh.tipopoliza_key || '',
      aseguradora: veh.aseguradora_key || '',
      fechaEmisionSoat: veh.fechiniciotarjetapropiedad ? veh.fechiniciotarjetapropiedad.toISOString().split('T')[0] : '',
      fechaVencimientoSoat: veh.fechfintarjetapropiedad ? veh.fechfintarjetapropiedad.toISOString().split('T')[0] : '',
      sinDni: false,
      tipoDocProp: '', nroDocProp: '', nombresProp: '', apellidosProp: '', paisProp: '', departamentoProp: '', provinciaProp: '', distritoProp: '', direccionProp: '', emailProp: '', telefonoProp: ''
    };

    if (veh.tarjetapropiedad_id) {
      const tpRes = await pool.query(`SELECT propietario_nrodocumentoidentidad FROM tarjetapropiedad WHERE id = $1`, [veh.tarjetapropiedad_id]);
      if (tpRes.rows.length > 0 && tpRes.rows[0].propietario_nrodocumentoidentidad) {
        const docProp = tpRes.rows[0].propietario_nrodocumentoidentidad;
        const perRes = await pool.query(`SELECT * FROM persona WHERE nrodocumentoidentidad = $1`, [docProp]);
        if (perRes.rows.length > 0) {
          const per = perRes.rows[0];
          formVehiculo.nroDocProp = per.nrodocumentoidentidad || '';
          formVehiculo.tipoDocProp = per.tipodocumentoidentidad_key || '';
          formVehiculo.nombresProp = per.nombres || '';
          formVehiculo.apellidosProp = per.apellidos || '';
          formVehiculo.paisProp = per.pais_key || '';
          formVehiculo.departamentoProp = per.departamento_key || '';
          formVehiculo.provinciaProp = per.provincia_key || '';
          formVehiculo.distritoProp = per.distrito_key || '';
          formVehiculo.direccionProp = per.direccion || '';
          formVehiculo.emailProp = per.email || '';
          formVehiculo.telefonoProp = per.telefono || '';
        }
      }
    }

    const compIdRes = await pool.query(`SELECT id FROM comprobante WHERE inspeccion_nrodocumentoinspeccion = $1`, [id]);
    let pagosRecuperados = [];
    if (compIdRes.rows.length > 0) {
      const compId = compIdRes.rows[0].id;
      const pagosRes = await pool.query(`SELECT * FROM pago WHERE comprobante_id = $1`, [compId]);
      pagosRecuperados = pagosRes.rows.map(p => ({
        tipo: p.tipocontado_key ? p.tipocontado_key.toUpperCase() : 'EFECTIVO',
        importe: p.importe,
        tarjetaKey: p.tarjeta_key || '',
        entidadFinancieraKey: p.entidadfinanciera_key || '',
        cuentaCorrienteKey: p.cuentacorriente_key || '',
        nroOperacion: p.nrooperaciontarjeta || p.nrooperacionbanco || '',
        digitosTarjeta: p.digitotarjeta || '',
        fechaDeposito: p.fechdeposito ? p.fechdeposito.toISOString().split('T')[0] : ''
      }));
    }

    const data = {
      currentStepIndex: ins.posicion || 0,
      plantaKey: ins.planta_key,
      formCaja,
      formVehiculo,
      pagosAgregados: pagosRecuperados,
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