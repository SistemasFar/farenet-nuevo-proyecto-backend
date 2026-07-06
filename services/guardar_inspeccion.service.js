const pool = require('../config/database');

const guardarInspeccionTransaccion = async (reqBody) => {
  const { 
    formCaja, formVehiculo, formFacturacion, formVerificacion, 
    idBorrador, pagosAgregados, documentoPago, isConsultado,
    precioSubtotal, descuento, precioTotal 
  } = reqBody;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 0. Eliminar el Borrador Temporal (si existe) para que no quede huérfano
    if (idBorrador) {
      await client.query('DELETE FROM borrador_estado WHERE inspeccion_id = $1', [idBorrador]);
      // Remove circular reference before deleting
      await client.query('UPDATE inspeccion SET comprobante_id = NULL WHERE nrodocumentoinspeccion = $1', [idBorrador]);
      await client.query('DELETE FROM comprobante WHERE inspeccion_nrodocumentoinspeccion = $1', [idBorrador]);
      await client.query('DELETE FROM inspeccion WHERE nrodocumentoinspeccion = $1', [idBorrador]);
    }

    // 1. Manejar Persona (Cliente/Propietario)
    const documentoProp = formVehiculo.nroDocProp || '00000000';
    let personaExist = await client.query('SELECT nrodocumentoidentidad FROM persona WHERE nrodocumentoidentidad = $1', [documentoProp]);
    
    if (personaExist.rows.length === 0) {
      await client.query(`
        INSERT INTO persona (
          nrodocumentoidentidad, tipodocumentoidentidad_key, nombrerazonsocial, nombres, apellidos,
          direccion, email, telefono, departamento_key, provincia_key, distrito_key, pais_key, fechcreacion, estado
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), true)
      `, [
        documentoProp,
        formVehiculo.tipoDocProp || null,
        formVehiculo.razonSocialProp || null,
        formVehiculo.nombresProp || null,
        formVehiculo.apellidosProp || null,
        formVehiculo.direccionProp || null,
        formVehiculo.emailProp || null,
        formVehiculo.telefonoProp || null,
        formVehiculo.departamentoProp || null,
        formVehiculo.provinciaProp || null,
        formVehiculo.distritoProp || null,
        formVehiculo.paisProp || null
      ]);
    } else {
      await client.query(`
        UPDATE persona SET
          tipodocumentoidentidad_key = COALESCE($2, tipodocumentoidentidad_key),
          nombrerazonsocial = COALESCE($3, nombrerazonsocial),
          nombres = COALESCE($4, nombres),
          apellidos = COALESCE($5, apellidos),
          direccion = COALESCE($6, direccion),
          email = COALESCE($7, email),
          telefono = COALESCE($8, telefono),
          fechmodi = NOW()
        WHERE nrodocumentoidentidad = $1
      `, [
        documentoProp,
        formVehiculo.tipoDocProp || null,
        formVehiculo.razonSocialProp || null,
        formVehiculo.nombresProp || null,
        formVehiculo.apellidosProp || null,
        formVehiculo.direccionProp || null,
        formVehiculo.emailProp || null,
        formVehiculo.telefonoProp || null
      ]);
    }

    // 2. Manejar Vehiculo
    // Usar nromotor si viene, sino generar un temporal. El temporal suele ser TMP-INS-planta-timestamp
    let nroMotorFinal = formVehiculo.nroMotor;
    if (!nroMotorFinal || nroMotorFinal.trim() === '') {
      const ts = new Date().getTime().toString().slice(-9);
      nroMotorFinal = `T-${ts}`;
    }

    let vehiculoExist = await client.query('SELECT nromotor, tarjetapropiedad_id FROM vehiculo WHERE nromotor = $1', [nroMotorFinal]);
    const placaNueva = formVehiculo.placaNueva || formCaja.placa || '';

    // -- LÓGICA DE TARJETA DE PROPIEDAD --
    let tarjetaPropiedadId = vehiculoExist.rows.length > 0 ? vehiculoExist.rows[0].tarjetapropiedad_id : null;
    
    if (tarjetaPropiedadId) {
      await client.query(`
        UPDATE tarjetapropiedad SET
          propietario_nrodocumentoidentidad = COALESCE($2, propietario_nrodocumentoidentidad),
          nroplaca = COALESCE($3, nroplaca),
          fechmodi = NOW()
        WHERE id = $1
      `, [tarjetaPropiedadId, documentoProp, placaNueva]);
    } else {
      let tpIdResult = await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM tarjetapropiedad");
      tarjetaPropiedadId = parseInt(tpIdResult.rows[0].next_id);
      
      await client.query(`
        INSERT INTO tarjetapropiedad (id, estado, fechcreacion, fechmodi, nroplaca, propietario_nrodocumentoidentidad)
        VALUES ($1, true, NOW(), NOW(), $2, $3)
      `, [tarjetaPropiedadId, placaNueva, documentoProp]);
    }

    if (vehiculoExist.rows.length === 0) {
      await client.query(`
        INSERT INTO vehiculo (
          nromotor, nroplacaantigua, nroserie, aniofabricacion, longitud, ancho, alto, 
          nroejes, nroruedas, nroasientos, nropasajeros, nropuertas, pesoseco, pesobruto, cargautil,
          nrosoat, aseguradora_key, tipopoliza_key, combustible_key, carroceria_key, marca_key, modelo_key, 
          vehiculoclase_key, color_key, estado, fechcreacion, distanciaeje1, distanciaeje2, distanciaeje3, distanciaeje4, kilometraje, tarjetapropiedad_id, fechiniciotarjetapropiedad, fechfintarjetapropiedad
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $27, true, NOW(), 0, 0, 0, 0, 0, $24, $25, $26)
      `, [
        nroMotorFinal,
        placaNueva,
        formVehiculo.nroSerie || '',
        formVehiculo.anioFabricacion || 0,
        formVehiculo.longitud || 0,
        formVehiculo.ancho || 0,
        formVehiculo.altura || 0,
        formVehiculo.nroEjes || 0,
        formVehiculo.nroRuedas || 0,
        formVehiculo.nroAsientos || 0,
        formVehiculo.nroPasajeros || 0,
        formVehiculo.nroPuertas || 0,
        formVehiculo.pesoSeco || 0,
        formVehiculo.pesoBruto || 0,
        formVehiculo.cargaUtil || 0,
        formVehiculo.nroSoat || '',
        formVehiculo.aseguradora || null,
        formVehiculo.tipoPoliza || null,
        formVehiculo.combustible || null,
        formVehiculo.carroceria || null,
        formVehiculo.marca || null,
        formVehiculo.modelo || null,
        formVehiculo.clase || null,
        tarjetaPropiedadId,
        formVehiculo.fechaEmisionSoat || null,
        formVehiculo.fechaVencimientoSoat || null,
        formVehiculo.color || null
      ]);
    } else {
        await client.query(`
          UPDATE vehiculo SET
            nroplacaantigua = COALESCE($2, nroplacaantigua),
            nroserie = COALESCE($3, nroserie),
            aniofabricacion = COALESCE($4, aniofabricacion),
            nrosoat = COALESCE($5, nrosoat),
            tarjetapropiedad_id = COALESCE($6, tarjetapropiedad_id),
            fechiniciotarjetapropiedad = COALESCE($7, fechiniciotarjetapropiedad),
            fechfintarjetapropiedad = COALESCE($8, fechfintarjetapropiedad),
            kilometraje = COALESCE($9, kilometraje),
            marca_key = COALESCE($10, marca_key),
            modelo_key = COALESCE($11, modelo_key),
            vehiculoclase_key = COALESCE($12, vehiculoclase_key),
            carroceria_key = COALESCE($13, carroceria_key),
            combustible_key = COALESCE($14, combustible_key),
            longitud = COALESCE($15, longitud),
            ancho = COALESCE($16, ancho),
            alto = COALESCE($17, alto),
            nroejes = COALESCE($18, nroejes),
            nroruedas = COALESCE($19, nroruedas),
            nroasientos = COALESCE($20, nroasientos),
            nropasajeros = COALESCE($21, nropasajeros),
            nropuertas = COALESCE($22, nropuertas),
            pesoseco = COALESCE($23, pesoseco),
            pesobruto = COALESCE($24, pesobruto),
            cargautil = COALESCE($25, cargautil),
            aseguradora_key = COALESCE($26, aseguradora_key),
            tipopoliza_key = COALESCE($27, tipopoliza_key),
            color_key = COALESCE($28, color_key),
            fechmodi = NOW()
          WHERE nromotor = $1
        `, [
          nroMotorFinal,
          placaNueva,
          formVehiculo.nroSerie || null,
          formVehiculo.anioFabricacion || null,
          formVehiculo.nroSoat || null,
          tarjetaPropiedadId,
          formVehiculo.fechaEmisionSoat || null,
          formVehiculo.fechaVencimientoSoat || null,
          formVehiculo.kilometraje || null,
          formVehiculo.marca || null,
          formVehiculo.modelo || null,
          formVehiculo.clase || null,
          formVehiculo.carroceria || null,
          formVehiculo.combustible || null,
          formVehiculo.longitud || null,
          formVehiculo.ancho || null,
          formVehiculo.altura || null,
          formVehiculo.nroEjes || null,
          formVehiculo.nroRuedas || null,
          formVehiculo.nroAsientos || null,
          formVehiculo.nroPasajeros || null,
          formVehiculo.nroPuertas || null,
          formVehiculo.pesoSeco || null,
          formVehiculo.pesoBruto || null,
          formVehiculo.cargaUtil || null,
          formVehiculo.aseguradora || null,
          formVehiculo.tipoPoliza || null,
          formVehiculo.color || null
        ]);
    }

    const plantaKey = reqBody.plantaKey || formCaja?.plantaKey || '201';
    
    // Bloquear y leer la serie de documentos
    const serieResult = await client.query("SELECT * FROM seriedocumentobase WHERE planta_key = $1 FOR UPDATE", [plantaKey]);
    if (serieResult.rows.length === 0) {
      throw new Error(`No se encontró configuración de series para la planta ${plantaKey}`);
    }
    const serieDoc = serieResult.rows[0];

    const nroActualInspeccionNum = parseInt(serieDoc.nroidinspeccion || '0');
    const newNroActualInspeccion = nroActualInspeccionNum + 1;
    // Formato: INS-201-000157677
    const nroInspeccion = `INS-${plantaKey}-${String(newNroActualInspeccion).padStart(9, '0')}`;

    let nroComprobanteTemp = '';
    let newNroBoleta = parseInt(serieDoc.nroactualboleta || '0');
    let newNroFactura = parseInt(serieDoc.nroactualfactura || '0');

    if (formFacturacion?.tipoComprobante === 'BOLETA') {
      newNroBoleta++;
      nroComprobanteTemp = `${serieDoc.serieboleta}-${String(newNroBoleta).padStart(8, '0')}`;
    } else if (formFacturacion?.tipoComprobante === 'FACTURA') {
      newNroFactura++;
      nroComprobanteTemp = `${serieDoc.seriefactura}-${String(newNroFactura).padStart(8, '0')}`;
    } else {
      // Fallback
      nroComprobanteTemp = 'BORRADOR-' + new Date().getTime().toString().slice(-9);
    }

    // Actualizar seriedocumentobase
    await client.query(`
      UPDATE seriedocumentobase 
      SET nroidinspeccion = $1, nroactualboleta = $2, nroactualfactura = $3 
      WHERE id = $4
    `, [newNroActualInspeccion.toString(), newNroBoleta.toString(), newNroFactura.toString(), serieDoc.id]);

    const nextIdResult = await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM comprobante");
    const nextComprobanteId = nextIdResult.rows[0].next_id;

    // 3. Crear Inspeccion (Primero, porque comprobante requiere inspeccion_nrodocumentoinspeccion)
    await client.query(`
      INSERT INTO inspeccion (
        nrodocumentoinspeccion, estado, fechcreacion, indicedesaprobado,
        tipoautorizacion_key, tipocertificado_key, tipoinspeccion_key, vehiculo_nromotor, ui_metadata, inspeccionestado_key,
        nrodocumentoreinspeccion, posicion
      ) VALUES ($1, true, NOW(), 0, $2, $3, $4, $5, $6, 'PROCESO', $7, 5)
    `, [
      nroInspeccion,
      formCaja.tipoAutorizacion || null,
      formCaja.tipoCertificado || null,
      formCaja.tipoInspeccion || null,
      nroMotorFinal,
      JSON.stringify({ 
        formCaja, formVehiculo, formFacturacion, formVerificacion, pagosAgregados,
        documentoPago, isConsultado, precioSubtotal, descuento, precioTotal
      }),
      formCaja.nrodocumentoreinspeccion || null
    ]);

    // 4. Crear Comprobante
    const baseImponible = formFacturacion?.subtotal || (precioTotal / 1.18).toFixed(2);
    const igv = formFacturacion?.igv || (precioTotal - baseImponible).toFixed(2);

    const resultComp = await client.query(`
      INSERT INTO comprobante (
        id, nrocomprobante, estado, fechcreacion, placamotor, cliente_nrodocumentoidentidad,
        conceptoinspeccion_key, linea_key, tipodocumento_key, importetotal, baseimponible, igv,
        totaldscto, totalsindscto, inspeccion_nrodocumentoinspeccion
      ) VALUES ($1, $2, true, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id
    `, [
      nextComprobanteId,
      nroComprobanteTemp,
      placaNueva,
      formFacturacion?.nroDocFac || null,
      formCaja.concepto,
      formVerificacion?.linea || null,
      formFacturacion?.tipoComprobante === 'FACTURA' ? '1' : '3', // 1=Factura, 3=Boleta
      precioTotal || 0,
      baseImponible,
      igv,
      descuento || 0,
      precioSubtotal || 0,
      nroInspeccion
    ]);

    // 4.5. Copiar Resultados de Maquina si es Reinspeccion (Lógica Clásica Farenet)
    if (formCaja.nrodocumentoreinspeccion) {
      const resPrev = await client.query(`
        SELECT rm.*, m.tipomaquina_key
        FROM resultado_maquina rm
        JOIN maquina m ON m.id = rm.maquina_id
        WHERE rm.inspeccion_nrodocumentoinspeccion = $1
      `, [formCaja.nrodocumentoreinspeccion]);

      const prevResults = resPrev.rows;
      let removeTestLine = false;
      const testLineTypes = ['1', '2', '3']; // Alineamiento, Suspension, Frenometro
      const fotoTypes = ['11', '12', '13', '14', '15'];

      for (const rm of prevResults) {
        if (rm.resultado === 'D' && testLineTypes.includes(rm.tipomaquina_key)) {
          // Si falló alguna prueba de TestLine, en reinspección se repite todo el TestLine
          removeTestLine = true;
        }
      }

      const newResultsToInsert = [];
      for (const rm of prevResults) {
        if (rm.resultado === 'A') {
          if (fotoTypes.includes(rm.tipomaquina_key)) continue;
          if (removeTestLine && testLineTypes.includes(rm.tipomaquina_key)) continue;
          newResultsToInsert.push(rm);
        }
      }

      if (newResultsToInsert.length > 0) {
        let nextRmId = parseInt((await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM resultado_maquina")).rows[0].next_id);
        for (const rm of newResultsToInsert) {
          await client.query(`
            INSERT INTO resultado_maquina (
              id, manual, postdata, data, f, estado, maquina_id, fechcreacion,
              insp_visual, inspeccion_nrodocumentoinspeccion, fechafin, fechainicio,
              foto, resultado, usuariocreacion_username
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, NOW(),
              $8, $9, $10, $11, $12, $13, $14
            )
          `, [
            nextRmId++, rm.manual, rm.postdata, rm.data, rm.f, rm.estado, rm.maquina_id,
            rm.insp_visual, nroInspeccion, rm.fechafin, rm.fechainicio,
            rm.foto, rm.resultado, rm.usuariocreacion_username
          ]);
        }
      }
    }
    const comprobanteId = resultComp.rows[0].id;

    // 5. Actualizar Inspeccion con el comprobante_id
    await client.query("UPDATE inspeccion SET comprobante_id = $1 WHERE nrodocumentoinspeccion = $2", [comprobanteId, nroInspeccion]);

    // 6. Insertar Pagos Relacionales
    for (const pagoItem of (pagosAgregados || [])) {
      const importePago = parseFloat(pagoItem.importe || '0');
      if (importePago <= 0) continue;
      
      const igvPago = importePago - (importePago / 1.18);
      const basePago = importePago / 1.18;

      const nextPagoIdResult = await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM pago");
      const nextPagoId = nextPagoIdResult.rows[0].next_id;

      await client.query(`
        INSERT INTO pago (
          id, fechacreacion, comprobante_id, importe, baseimponible, igv, estado, 
          tarjeta_key, nrooperacionbanco, nrooperaciontarjeta, digitotarjeta, 
          cuentacorriente_key, entidadfinanciera_key, moneda_key, fechdeposito
        ) VALUES ($1, NOW(), $2, $3, $4, $5, true, $6, $7, $8, $9, $10, $11, 'SOL', $12)
      `, [
        nextPagoId,
        comprobanteId,
        importePago,
        basePago.toFixed(2),
        igvPago.toFixed(2),
        pagoItem.tipo === 'TARJETA' ? pagoItem.tarjetaKey : null,
        pagoItem.tipo === 'BANCO' ? pagoItem.nroOperacion : null,
        pagoItem.tipo === 'TARJETA' ? pagoItem.nroOperacion : null,
        pagoItem.tipo === 'TARJETA' ? pagoItem.digitosTarjeta : null,
        pagoItem.tipo === 'BANCO' ? pagoItem.cuentaCorrienteKey : null,
        pagoItem.tipo === 'BANCO' ? pagoItem.entidadFinancieraKey : null,
        pagoItem.fechaDeposito || null
      ]);
    }

    // 7. QUEMAR (CONSUMIR) EL DESCUENTO SI APLICA
    if (formCaja && formCaja.descuentoObj && formCaja.descuentoObj.source_table && formCaja.descuentoObj.source_id) {
      const { source_table, source_id } = formCaja.descuentoObj;
      const validTables = ['descuento', 'descuentocliente', 'descuentomasivo', 'descuentomasivocliente'];
      
      if (validTables.includes(source_table)) {
        // En descuentocliente y descuentomasivocliente se suele quemar cambiando estado a false
        if (source_table === 'descuentocliente' || source_table === 'descuentomasivocliente') {
          await client.query(`UPDATE ${source_table} SET estado = false WHERE id = $1`, [source_id]);
        }
      }
    }

    await client.query('COMMIT');
    return {
      status: 'success',
      nroInspeccion,
      comprobanteId,
      vehiculoId: nroMotorFinal
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error en guardarInspeccionTransaccion:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  guardarInspeccionTransaccion
};
