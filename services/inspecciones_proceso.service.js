const pool = require('../config/database');

const generarNroInspeccion = async (plantaKey) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const serieResult = await client.query("SELECT * FROM seriedocumentobase WHERE planta_key = $1 FOR UPDATE", [plantaKey]);
    if (serieResult.rows.length === 0) {
      throw new Error(`No se encontró configuración de series para la planta ${plantaKey}`);
    }
    const serieDoc = serieResult.rows[0];

    let nroActualInspeccionNum = parseInt(serieDoc.nroidinspeccion || '0');
    let nroInspeccion = '';

    while (true) {
      nroActualInspeccionNum++;
      nroInspeccion = `INS-${plantaKey}-${String(nroActualInspeccionNum).padStart(9, '0')}`;
      const exists = await client.query('SELECT 1 FROM inspeccion WHERE nrodocumentoinspeccion = $1', [nroInspeccion]);
      if (exists.rows.length === 0) {
        break; // Número libre encontrado
      }
    }

    await client.query(`
      UPDATE seriedocumentobase 
      SET nroidinspeccion = $1
      WHERE id = $2
    `, [nroActualInspeccionNum.toString(), serieDoc.id]);

    await client.query('COMMIT');
    return nroInspeccion;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const guardarProceso = async (reqBody) => {
  const { 
    nrodocumentoinspeccion, // Enviado por el frontend (generado previamente)
    posicionActual, 
    siguientePosicion,
    posicion, // legacy support if some code still sends it
    formCaja, formVehiculo, formFacturacion, formVerificacion, pagosAgregados,
    documentoPago, isConsultado, precioSubtotal, descuento, precioTotal,
    plantaKey
  } = reqBody;

  if (!nrodocumentoinspeccion) {
    throw new Error('nrodocumentoinspeccion es obligatorio para el guardado progresivo.');
  }

  const posicionActualReq = Number(posicionActual ?? posicion ?? 0);
  const siguientePosicionReq = Number(siguientePosicion ?? posicionActualReq);

  if (posicionActualReq === 0 && (!documentoPago || documentoPago === '' || documentoPago === 'Seleccione...')) {
    throw new Error('Debe seleccionar el documento de pago antes de continuar.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Manejar lógica de Vehículo
    let nroMotorFinal = formVehiculo?.nroMotor || null;
    let tarjetaPropiedadId = null;

    if (formVehiculo && formVehiculo.kilometraje && nroMotorFinal) {
      const histResult = await client.query(`
        SELECT v.kilometraje 
        FROM inspeccion i2 
        JOIN vehiculo v ON i2.vehiculo_nromotor = v.nromotor 
        WHERE i2.vehiculo_nromotor = $1 
          AND i2.nrodocumentoinspeccion != $2 
          AND COALESCE(i2.inspeccionestado_key, '') NOT IN ('ANULADO', 'ANU', 'RETIRADO') 
          AND i2.estado = true
        ORDER BY i2.fechcreacion DESC 
        LIMIT 1
      `, [nroMotorFinal, nrodocumentoinspeccion]);
      
      if (histResult.rows.length > 0) {
        const ultimoKmValido = parseFloat(histResult.rows[0].kilometraje || 0);
        const nuevoKm = parseFloat(formVehiculo.kilometraje || 0);
        
        const checkPosResult = await client.query('SELECT posicion FROM inspeccion WHERE nrodocumentoinspeccion = $1', [nrodocumentoinspeccion]);
        const currentPos = checkPosResult.rows.length > 0 ? checkPosResult.rows[0].posicion : 0;

        if (nuevoKm > 0) {
          if (nuevoKm < ultimoKmValido) {
            throw new Error(`El kilometraje ingresado (${nuevoKm}) debe ser mayor al último kilometraje válido registrado (${ultimoKmValido}).`);
          }
          // Si son iguales, bloqueamos SOLO si estamos en el paso VEHÍCULO (posicionActualReq === 2)
          // y es la primera vez que se avanza desde este paso (currentPos < 2)
          if (nuevoKm === ultimoKmValido && posicionActualReq === 2 && currentPos < 2) {
            throw new Error(`El kilometraje ingresado (${nuevoKm}) debe ser mayor al último kilometraje válido registrado (${ultimoKmValido}).`);
          }
        }
      }
    }

    if (formVehiculo && (formVehiculo.nroMotor || formVehiculo.placaNueva || formCaja?.placa)) {
      if (!nroMotorFinal || nroMotorFinal.trim() === '') {
        const ts = new Date().getTime().toString().slice(-9);
        nroMotorFinal = `T-${ts}`;
      }
      
      const documentoProp = formVehiculo.nroDocProp || '00000000';
      const placaNueva = formVehiculo.placaNueva || formCaja?.placa || '';
      
      // Upsert Persona (Propietario)
      let personaExist = await client.query('SELECT nrodocumentoidentidad FROM persona WHERE nrodocumentoidentidad = $1', [documentoProp]);
      if (personaExist.rows.length === 0) {
        await client.query(`
          INSERT INTO persona (
            nrodocumentoidentidad, tipodocumentoidentidad_key, nombrerazonsocial, nombres, apellidos,
            direccion, email, telefono, departamento_key, provincia_key, distrito_key, pais_key, fechcreacion, estado
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), true)
        `, [
          documentoProp, formVehiculo.tipoDocProp || null, formVehiculo.razonSocialProp || null,
          formVehiculo.nombresProp || null, formVehiculo.apellidosProp || null, formVehiculo.direccionProp || null,
          formVehiculo.emailProp || null, formVehiculo.telefonoProp || null, formVehiculo.departamentoProp || null,
          formVehiculo.provinciaProp || null, formVehiculo.distritoProp || null, formVehiculo.paisProp || null
        ]);
      }

      let vehiculoExist = await client.query('SELECT nromotor, tarjetapropiedad_id FROM vehiculo WHERE nromotor = $1', [nroMotorFinal]);
      tarjetaPropiedadId = vehiculoExist.rows.length > 0 ? vehiculoExist.rows[0].tarjetapropiedad_id : null;
      
      if (tarjetaPropiedadId) {
        await client.query(`
          UPDATE tarjetapropiedad SET
            propietario_nrodocumentoidentidad = COALESCE($2, propietario_nrodocumentoidentidad),
            nroplaca = COALESCE($3, nroplaca), fechmodi = NOW()
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
            vehiculoclase_key, color_key, categoria_key, estado, fechcreacion, distanciaeje1, distanciaeje2, distanciaeje3, distanciaeje4, kilometraje, tarjetapropiedad_id, fechiniciotarjetapropiedad, fechfintarjetapropiedad,
            nrocilindros, nropisos, nrosalidaemergencia, categoriaextra, marcacarroceria
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $27, $28, true, NOW(), 0, 0, 0, 0, 0, $24, $25, $26, $29, $30, $31, $32, $33)
        `, [
          nroMotorFinal, placaNueva, formVehiculo?.nroSerie || '', formVehiculo?.anioFabricacion || 0,
          formVehiculo?.longitud || 0, formVehiculo?.ancho || 0, formVehiculo?.altura || 0,
          formVehiculo?.nroEjes || 0, formVehiculo?.nroRuedas || 0, formVehiculo?.nroAsientos || 0,
          formVehiculo?.nroPasajeros || 0, formVehiculo?.nroPuertas || 0, formVehiculo?.pesoSeco || 0,
          formVehiculo?.pesoBruto || 0, formVehiculo?.cargaUtil || 0, formVehiculo?.nroSoat || '',
          formVehiculo?.aseguradora || null, formVehiculo?.tipoPoliza || null, formVehiculo?.combustible || null,
          formVehiculo?.carroceria || null, formVehiculo?.marca || null, formVehiculo?.modelo || null,
          formVehiculo?.clase || null, tarjetaPropiedadId, formVehiculo?.fechaEmisionSoat || null,
          formVehiculo?.fechaVencimientoSoat || null, formVehiculo?.color || null,
          formCaja?.categoria || null,
          formVehiculo?.nroCilindros || 0, formVehiculo?.nroPisos || 0, formVehiculo?.salidasEmergencia || 0, formVehiculo?.categoriaExtra || null, formVehiculo?.marcaCarroceria || null
        ]);
      } else {
        await client.query(`
          UPDATE vehiculo SET
            nroplacaantigua = COALESCE($2, nroplacaantigua), nroserie = COALESCE($3, nroserie),
            aniofabricacion = COALESCE($4, aniofabricacion), nrosoat = COALESCE($5, nrosoat),
            tarjetapropiedad_id = COALESCE($6, tarjetapropiedad_id), fechiniciotarjetapropiedad = COALESCE($7, fechiniciotarjetapropiedad),
            fechfintarjetapropiedad = COALESCE($8, fechfintarjetapropiedad), kilometraje = COALESCE($9, kilometraje),
            marca_key = COALESCE($10, marca_key), modelo_key = COALESCE($11, modelo_key),
            vehiculoclase_key = COALESCE($12, vehiculoclase_key), carroceria_key = COALESCE($13, carroceria_key),
            combustible_key = COALESCE($14, combustible_key), longitud = COALESCE($15, longitud),
            ancho = COALESCE($16, ancho), alto = COALESCE($17, alto), nroejes = COALESCE($18, nroejes),
            nroruedas = COALESCE($19, nroruedas), nroasientos = COALESCE($20, nroasientos),
            nropasajeros = COALESCE($21, nropasajeros), nropuertas = COALESCE($22, nropuertas),
            pesoseco = COALESCE($23, pesoseco), pesobruto = COALESCE($24, pesobruto),
            cargautil = COALESCE($25, cargautil), aseguradora_key = COALESCE($26, aseguradora_key),
            tipopoliza_key = COALESCE($27, tipopoliza_key), color_key = COALESCE($28, color_key),
            categoria_key = COALESCE($29, categoria_key),
            nrocilindros = COALESCE($30, nrocilindros), nropisos = COALESCE($31, nropisos),
            nrosalidaemergencia = COALESCE($32, nrosalidaemergencia), categoriaextra = COALESCE($33, categoriaextra),
            marcacarroceria = COALESCE($34, marcacarroceria), fechmodi = NOW()
          WHERE nromotor = $1
        `, [
          nroMotorFinal, placaNueva, formVehiculo?.nroSerie || null, formVehiculo?.anioFabricacion || null,
          formVehiculo?.nroSoat || null, tarjetaPropiedadId, formVehiculo?.fechaEmisionSoat || null,
          formVehiculo?.fechaVencimientoSoat || null, formVehiculo?.kilometraje || null,
          formVehiculo?.marca || null, formVehiculo?.modelo || null, formVehiculo?.clase || null,
          formVehiculo?.carroceria || null, formVehiculo?.combustible || null, formVehiculo?.longitud || null,
          formVehiculo?.ancho || null, formVehiculo?.altura || null, formVehiculo?.nroEjes || null,
          formVehiculo?.nroRuedas || null, formVehiculo?.nroAsientos || null, formVehiculo?.nroPasajeros || null,
          formVehiculo?.nroPuertas || null, formVehiculo?.pesoSeco || null, formVehiculo?.pesoBruto || null,
          formVehiculo?.cargaUtil || null, formVehiculo?.aseguradora || null, formVehiculo?.tipoPoliza || null,
          formVehiculo?.color || null, formCaja?.categoria || null,
          formVehiculo?.nroCilindros || null, formVehiculo?.nroPisos || null, formVehiculo?.salidasEmergencia || null, formVehiculo?.categoriaExtra || null, formVehiculo?.marcaCarroceria || null
        ]);
      }
    }



    const inspExist = await client.query('SELECT nrodocumentoinspeccion, comprobante_id, inspeccionestado_key, posicion, fechaenlinea FROM inspeccion WHERE nrodocumentoinspeccion = $1', [nrodocumentoinspeccion]);
    
    let comprobanteId = inspExist.rows.length > 0 ? inspExist.rows[0].comprobante_id : null;
    const posicionBD = inspExist.rows.length > 0 ? parseInt(inspExist.rows[0].posicion || 0) : 0;

    let estadoAntes = null;
    if (inspExist.rows.length > 0) {
      estadoAntes = inspExist.rows[0].inspeccionestado_key;
      if (estadoAntes === 'ANULADO' || estadoAntes === 'ANU') {
        throw new Error('RECHAZADO: No se puede guardar ni modificar una inspección que ya se encuentra en estado ANULADO.');
      }
    } else {
      estadoAntes = 'NO_EXISTIA';
    }

    // Validar el avance de posición
    let posicionFinal = posicionBD;

    console.log('[CHECK POSICION]', {
      nrodocumentoinspeccion,
      posicionBD,
      posicionActualReq,
      siguientePosicionReq
    });
    
    if (posicionActualReq !== posicionBD) {
      if (siguientePosicionReq === posicionBD) {
        // Doble request de avance detectada, el paso ya estaba guardado
        return {
          ok: true,
          message: "El paso ya estaba guardado.",
          nrodocumentoinspeccion,
          posicionAnterior: posicionBD,
          posicionActual: posicionBD,
          datosGuardados: true
        };
      }
      throw new Error('La posición enviada no coincide con la posición actual de la inspección.');
    }

    if (siguientePosicionReq === posicionBD + 1) {
      // Avance permitido
      posicionFinal = siguientePosicionReq;
    } else if (siguientePosicionReq > posicionBD + 1) {
      throw new Error('Avance de posición no permitido. No se pueden saltar pasos.');
    } else {
      // Idempotencia o regresión (solo lectura/guardado parcial)
      posicionFinal = posicionBD;
    }

    // Regla FINALIZAR -> GASES (posicion 5): setear fechaenlinea
    let isPaseALinea = false;
    if (posicionFinal >= 5 && posicionBD === 4) {
      isPaseALinea = true;
    }

    const nrodocumentoreinspeccion = formCaja?.nrodocumentoreinspeccion || null;

    if (inspExist.rows.length === 0) {
      await client.query(`
        INSERT INTO inspeccion (
          nrodocumentoinspeccion, estado, fechcreacion, indicedesaprobado,
          tipoautorizacion_key, tipocertificado_key, tipoinspeccion_key, vehiculo_nromotor, inspeccionestado_key,
          nrodocumentoreinspeccion, posicion
        ) VALUES ($1, true, NOW(), 0, $2, $3, $4, $5, 'PEN', $6, $7)
      `, [
        nrodocumentoinspeccion,
        formCaja?.tipoAutorizacion || null, formCaja?.tipoCertificado || null, formCaja?.tipoInspeccion || null,
        nroMotorFinal, nrodocumentoreinspeccion, posicionFinal
      ]);
    } else {
      await client.query(`
        UPDATE inspeccion SET
          tipoautorizacion_key = COALESCE($2, tipoautorizacion_key),
          tipocertificado_key = COALESCE($3, tipocertificado_key),
          tipoinspeccion_key = COALESCE($4, tipoinspeccion_key),
          vehiculo_nromotor = COALESCE($5, vehiculo_nromotor),
          nrodocumentoreinspeccion = COALESCE($6, nrodocumentoreinspeccion),
          posicion = COALESCE($7, posicion),
          ${isPaseALinea ? "fechaenlinea = COALESCE(fechaenlinea, NOW())," : ""}
          fechmodi = NOW()
        WHERE nrodocumentoinspeccion = $1
      `, [
        nrodocumentoinspeccion,
        formCaja?.tipoAutorizacion || null, formCaja?.tipoCertificado || null, formCaja?.tipoInspeccion || null,
        nroMotorFinal, nrodocumentoreinspeccion, posicionFinal
      ]);
    }

    try {
      const qDespues = await client.query('SELECT inspeccionestado_key FROM inspeccion WHERE nrodocumentoinspeccion = $1', [nrodocumentoinspeccion]);
      const estadoDespues = qDespues.rows.length > 0 ? qDespues.rows[0].inspeccionestado_key : 'NO_EXISTE';
      console.log(`[DEBUG Node] endpoint: guardar-proceso (posicionActual: ${posicionActualReq}, siguiente: ${siguientePosicionReq}) - params: nro=${nrodocumentoinspeccion}`);
      console.log(`[DEBUG Node] -> Estado ANTES: ${estadoAntes}`);
      console.log(`[DEBUG Node] -> Estado DESPUES: ${estadoDespues}`);
    } catch(e){}
    if (formFacturacion || formCaja?.concepto) {
      const placaNueva = formVehiculo?.placaNueva || formCaja?.placa || '';
      const baseImponible = formFacturacion?.subtotal || (precioTotal ? (precioTotal / 1.18).toFixed(2) : 0);
      const igv = formFacturacion?.igv || (precioTotal ? (precioTotal - baseImponible).toFixed(2) : 0);

      if (!comprobanteId) {
        const nextIdResult = await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM comprobante");
        comprobanteId = nextIdResult.rows[0].next_id;
        
        await client.query(`
          INSERT INTO comprobante (
            id, nrocomprobante, estado, fechcreacion, placamotor, cliente_nrodocumentoidentidad,
            conceptoinspeccion_key, linea_key, tipodocumento_key, importetotal, baseimponible, igv,
            totaldscto, totalsindscto, inspeccion_nrodocumentoinspeccion
          ) VALUES ($1, NULL, true, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          comprobanteId, placaNueva, formFacturacion?.nroDocFac || null, formCaja?.concepto || null,
          formVerificacion?.linea || null, formFacturacion?.tipoComprobante === 'FACTURA' ? '1' : '3',
          precioTotal || 0, baseImponible, igv, descuento || 0, precioSubtotal || 0, nrodocumentoinspeccion
        ]);
        await client.query("UPDATE inspeccion SET comprobante_id = $1 WHERE nrodocumentoinspeccion = $2", [comprobanteId, nrodocumentoinspeccion]);
      } else {
        await client.query(`
          UPDATE comprobante SET
            placamotor = COALESCE($2, placamotor),
            cliente_nrodocumentoidentidad = COALESCE($3, cliente_nrodocumentoidentidad),
            conceptoinspeccion_key = COALESCE($4, conceptoinspeccion_key),
            linea_key = COALESCE($5, linea_key),
            tipodocumento_key = COALESCE($6, tipodocumento_key),
            importetotal = COALESCE($7, importetotal),
            baseimponible = COALESCE($8, baseimponible),
            igv = COALESCE($9, igv),
            totaldscto = COALESCE($10, totaldscto),
            totalsindscto = COALESCE($11, totalsindscto),
            fechmodi = NOW()
          WHERE id = $1
        `, [
          comprobanteId, placaNueva, formFacturacion?.nroDocFac || null, formCaja?.concepto || null,
          formVerificacion?.linea || null, formFacturacion?.tipoComprobante === 'FACTURA' ? '1' : '3',
          precioTotal || 0, baseImponible, igv, descuento || 0, precioSubtotal || 0
        ]);
      }
    }

    if (comprobanteId && pagosAgregados && pagosAgregados.length > 0) {
      await client.query("DELETE FROM pago WHERE comprobante_id = $1", [comprobanteId]);
      
      for (const pagoItem of pagosAgregados) {
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
          nextPagoId, comprobanteId, importePago, basePago.toFixed(2), igvPago.toFixed(2),
          pagoItem.tipo === 'TARJETA' ? pagoItem.tarjetaKey : null,
          pagoItem.tipo === 'BANCO' ? pagoItem.nroOperacion : null,
          pagoItem.tipo === 'TARJETA' ? pagoItem.nroOperacion : null,
          pagoItem.tipo === 'TARJETA' ? pagoItem.digitosTarjeta : null,
          pagoItem.tipo === 'BANCO' ? pagoItem.cuentaCorrienteKey : null,
          pagoItem.tipo === 'BANCO' ? pagoItem.entidadFinancieraKey : null,
          pagoItem.fechaDeposito || null
        ]);
      }
    }

    await client.query('COMMIT');
    const result = { 
      ok: true, 
      nrodocumentoinspeccion,
      posicionAnterior: posicionBD,
      posicionActual: posicionFinal,
      datosGuardados: true
    };
    console.log('[BACK guardarProceso result]', result);
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error en guardarProceso:', error);
    throw error;
  } finally {
    client.release();
  }
};

const anularInspeccion = async (nrodocumentoinspeccion) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inspExist = await client.query('SELECT comprobante_id FROM inspeccion WHERE nrodocumentoinspeccion = $1', [nrodocumentoinspeccion]);
    if (inspExist.rows.length === 0) throw new Error('Inspección no encontrada');
    const comprobanteId = inspExist.rows[0].comprobante_id;

    await client.query(`
      UPDATE inspeccion SET
        inspeccionestado_key = 'ANU',
        fechanulacion = NOW()
      WHERE nrodocumentoinspeccion = $1
    `, [nrodocumentoinspeccion]);

    if (comprobanteId) {
      await client.query(`
        UPDATE comprobante SET
          comprobanteestado_key = 'ANU',
          fechanulacion = NOW(),
          importetotal = 0,
          baseimponible = 0,
          igv = 0
        WHERE id = $1
      `, [comprobanteId]);
    }
    await client.query('COMMIT');
    return { status: 'success' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const obtenerProceso = async (nrodocumentoinspeccion) => {
  const client = await pool.connect();
  try {
    const inspResult = await client.query(`
      SELECT i.*, 
             v.nroplacaantigua, v.nroserie, v.aniofabricacion, v.longitud, v.ancho, v.alto, v.nroejes, v.nroruedas, 
             v.nroasientos, v.nropasajeros, v.nropuertas, v.pesoseco, v.pesobruto, v.cargautil, v.nrosoat, v.aseguradora_key,
             v.tipopoliza_key, v.combustible_key, v.carroceria_key, v.marca_key, v.modelo_key, v.vehiculoclase_key, v.color_key,
             v.kilometraje, v.fechiniciotarjetapropiedad, v.fechfintarjetapropiedad, v.categoria_key,
             v.nrocilindros, v.nropisos, v.nrosalidaemergencia, v.categoriaextra, v.marcacarroceria,
             tp.nroplaca, tp.propietario_nrodocumentoidentidad,
             p.nombres, p.apellidos, p.nombrerazonsocial, p.direccion, p.email, p.telefono, p.departamento_key, p.provincia_key, p.distrito_key, p.pais_key, p.tipodocumentoidentidad_key,
             m.nombre as marca_nombre, mo.nombre as modelo_nombre, co.nombre as color_nombre, car.nombre as carroceria_nombre
      FROM inspeccion i
      LEFT JOIN vehiculo v ON i.vehiculo_nromotor = v.nromotor
      LEFT JOIN tarjetapropiedad tp ON v.tarjetapropiedad_id = tp.id
      LEFT JOIN persona p ON tp.propietario_nrodocumentoidentidad = p.nrodocumentoidentidad
      LEFT JOIN marca m ON v.marca_key = m.key
      LEFT JOIN modelo mo ON v.modelo_key = mo.key
      LEFT JOIN color co ON v.color_key = co.key
      LEFT JOIN carroceria car ON v.carroceria_key = car.key
      WHERE i.nrodocumentoinspeccion = $1
    `, [nrodocumentoinspeccion]);

    if (inspResult.rows.length === 0) {
      return { status: 'error', message: 'Inspección no encontrada' };
    }

    const ins = inspResult.rows[0];

    const compResult = await client.query(`
      SELECT c.*, ci.abreviatura, 
             pf.tipodocumentoidentidad_key as pf_tipo, pf.nombrerazonsocial as pf_razon, 
             pf.nombres as pf_nombres, pf.apellidos as pf_apellidos, 
             pf.pais_key as pf_pais, pf.departamento_key as pf_dep, 
             pf.provincia_key as pf_prov, pf.distrito_key as pf_dist, 
             pf.direccion as pf_dir, pf.email as pf_email, pf.telefono as pf_tel
      FROM comprobante c
      LEFT JOIN conceptoinspeccion ci ON c.conceptoinspeccion_key = ci.key
      LEFT JOIN persona pf ON c.cliente_nrodocumentoidentidad = pf.nrodocumentoidentidad
      WHERE c.id = $1 OR c.inspeccion_nrodocumentoinspeccion = $2
      ORDER BY c.fechcreacion DESC LIMIT 1
    `, [ins.comprobante_id, nrodocumentoinspeccion]);

    const comp = compResult.rows.length > 0 ? compResult.rows[0] : null;

    let pagosAgregados = [];
    if (comp) {
      const pagosResult = await client.query(`
        SELECT p.* FROM pago p WHERE p.comprobante_id = $1
      `, [comp.id]);
      pagosAgregados = pagosResult.rows.map(p => ({
        tipo: p.tarjeta_key ? 'TARJETA' : (p.nrooperacionbanco ? 'BANCO' : 'EFECTIVO'),
        importe: p.importe,
        tarjetaKey: p.tarjeta_key,
        nroOperacion: p.nrooperacionbanco || p.nrooperaciontarjeta,
        digitosTarjeta: p.digitotarjeta,
        cuentaCorrienteKey: p.cuentacorriente_key,
        entidadFinancieraKey: p.entidadfinanciera_key,
        fechaDeposito: p.fechdeposito
      }));
    }

    const formCaja = {
      tipoAutorizacion: ins.tipoautorizacion_key || '',
      tipoCertificado: ins.tipocertificado_key || '',
      tipoInspeccion: ins.tipoinspeccion_key || '',
      nrodocumentoreinspeccion: ins.nrodocumentoreinspeccion || '',
      placa: ins.nroplaca || (comp ? comp.placamotor : ''),
      concepto: comp ? comp.conceptoinspeccion_key : '',
      categoria: ins.categoria_key || '',
      tipoPlaca: ''
    };

    const formVehiculo = {
      placaNueva: ins.nroplaca || '',
      nroMotor: ins.vehiculo_nromotor || '',
      nroSerie: ins.nroserie || '',
      anioFabricacion: ins.aniofabricacion || '',
      longitud: ins.longitud || '',
      ancho: ins.ancho || '',
      altura: ins.alto || '',
      nroEjes: ins.nroejes || '',
      nroRuedas: ins.nroruedas || '',
      nroAsientos: ins.nroasientos || '',
      nroPasajeros: ins.nropasajeros || '',
      nroPuertas: ins.nropuertas || '',
      pesoSeco: ins.pesoseco || '',
      pesoBruto: ins.pesobruto || '',
      cargaUtil: ins.cargautil || '',
      nroSoat: ins.nrosoat || '',
      aseguradora: ins.aseguradora_key || '',
      tipoPoliza: ins.tipopoliza_key || '',
      combustible: ins.combustible_key || '',
      carroceria: ins.carroceria_key || '',
      carroceria_label: ins.carroceria_nombre || '',
      marca: ins.marca_key || '',
      marca_label: ins.marca_nombre || '',
      modelo: ins.modelo_key || '',
      modelo_label: ins.modelo_nombre || '',
      clase: ins.vehiculoclase_key || '',
      color: ins.color_key || '',
      color_label: ins.color_nombre || '',
      kilometraje: ins.kilometraje || '',
      kilometrajeOriginal: 0,
      fechaEmisionSoat: ins.fechiniciotarjetapropiedad ? new Date(ins.fechiniciotarjetapropiedad).toISOString().split('T')[0] : '',
      fechaVencimientoSoat: ins.fechfintarjetapropiedad ? new Date(ins.fechfintarjetapropiedad).toISOString().split('T')[0] : '',
      mesesSoat: ins.fechiniciotarjetapropiedad && ins.fechfintarjetapropiedad ? 
        (((new Date(ins.fechfintarjetapropiedad).getFullYear() - new Date(ins.fechiniciotarjetapropiedad).getFullYear()) * 12) + (new Date(ins.fechfintarjetapropiedad).getMonth() - new Date(ins.fechiniciotarjetapropiedad).getMonth()) <= 6 ? '6' : '12') : '12',
      nroCilindros: ins.nrocilindros || '',
      nroPisos: ins.nropisos || '',
      salidasEmergencia: ins.nrosalidaemergencia || '',
      categoriaExtra: ins.categoriaextra || '',
      marcaCarroceria: ins.marcacarroceria || '',
      nroDocProp: ins.propietario_nrodocumentoidentidad || '',
      tipoDocProp: ins.tipodocumentoidentidad_key || '',
      razonSocialProp: ins.nombrerazonsocial || '',
      nombresProp: ins.nombres || '',
      apellidosProp: ins.apellidos || '',
      direccionProp: ins.direccion || '',
      emailProp: ins.email || '',
      telefonoProp: ins.telefono || '',
      departamentoProp: ins.departamento_key || '',
      provinciaProp: ins.provincia_key || '',
      distritoProp: ins.distrito_key || '',
      paisProp: ins.pais_key || ''
    };

    const formFacturacion = comp ? {
      nroDocFac: comp.cliente_nrodocumentoidentidad || '',
      tipoDocFac: comp.pf_tipo || '',
      razonSocialFac: comp.pf_razon || '',
      nombresFac: comp.pf_nombres || '',
      apellidosFac: comp.pf_apellidos || '',
      paisFac: comp.pf_pais || '',
      departamentoFac: comp.pf_dep || '',
      provinciaFac: comp.pf_prov || '',
      distritoFac: comp.pf_dist || '',
      direccionFac: comp.pf_dir || '',
      emailFac: comp.pf_email || '',
      telefonoFac: comp.pf_tel || '',
      tipoComprobante: comp.tipodocumento_key === '1' ? 'FACTURA' : 'BOLETA',
      subtotal: comp.baseimponible || '',
      igv: comp.igv || ''
    } : null;

    const formVerificacion = comp ? {
      linea: comp.linea_key || ''
    } : null;

    const precioSubtotal = comp ? comp.totalsindscto : 0;
    const descuento = comp ? comp.totaldscto : 0;
    const precioTotal = comp ? comp.importetotal : 0;
    
    const documentoPago = comp ? comp.tipodocumento_key : '';

    // Recuperar el kilometraje de la última inspección válida anterior
    if (ins.vehiculo_nromotor) {
      const histResult = await client.query(`
        SELECT v.kilometraje 
        FROM inspeccion i2 
        JOIN vehiculo v ON i2.vehiculo_nromotor = v.nromotor 
        WHERE i2.vehiculo_nromotor = $1 
          AND i2.nrodocumentoinspeccion != $2 
          AND COALESCE(i2.inspeccionestado_key, '') NOT IN ('ANULADO', 'ANU', 'RETIRADO') 
          AND i2.estado = true
        ORDER BY i2.fechcreacion DESC 
        LIMIT 1
      `, [ins.vehiculo_nromotor, nrodocumentoinspeccion]);
      
      if (histResult.rows.length > 0) {
        formVehiculo.kilometrajeOriginal = parseFloat(histResult.rows[0].kilometraje || 0);
      }
    }

    const puedeModificarFlujo1 = (Number(ins.posicion || 0) <= 3) && (ins.inspeccionestado_key !== 'ANULADO') && (ins.inspeccionestado_key !== 'ANU');
    const debeAbrirFlujo2 = (ins.fechaenlinea !== null && ins.fechaenlinea !== undefined) || (Number(ins.posicion || 0) > 4) || (ins.inspeccionestado_key === 'CON');

    return { 
      status: 'success', 
      data: { 
        nrodocumentoinspeccion: ins.nrodocumentoinspeccion,
        posicion: ins.posicion || 0,
        isConsultado: true,
        puedeModificarFlujo1,
        debeAbrirFlujo2,
        formCaja,
        formVehiculo,
        formFacturacion,
        formVerificacion,
        pagosAgregados,
        precioSubtotal,
        descuento,
        precioTotal,
        documentoPago,
        posicion: ins.posicion || 0,
        estado: ins.inspeccionestado_key,
        fechaenlinea: ins.fechaenlinea
      } 
    };
  } catch (error) {
    console.error('Error en obtenerProceso:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  generarNroInspeccion,
  guardarProceso,
  anularInspeccion,
  obtenerProceso
};
