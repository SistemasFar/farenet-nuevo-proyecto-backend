const pool = require('../config/database');

const guardarInspeccionTransaccion = async (reqBody) => {
  const { formCaja, formVehiculo, formFacturacion, formVerificacion } = reqBody;
  const pagosAgregados = reqBody.pagosAgregados || [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
      nroMotorFinal = `TMP-INS-000-${ts}`;
    }

    let vehiculoExist = await client.query('SELECT nromotor FROM vehiculo WHERE nromotor = $1', [nroMotorFinal]);
    const placaNueva = formVehiculo.placaNueva || formCaja.placa || '';

    if (vehiculoExist.rows.length === 0) {
      await client.query(`
        INSERT INTO vehiculo (
          nromotor, nroplacaantigua, nroserie, aniofabricacion, longitud, ancho, alto, 
          nroejes, nroruedas, nroasientos, nropasajeros, nropuertas, pesoseco, pesobruto, cargautil,
          nrosoat, aseguradora_key, tipopoliza_key, combustible_key, carroceria_key, marca_key, modelo_key, 
          vehiculoclase_key, estado, fechcreacion, distanciaeje1, distanciaeje2, distanciaeje3, distanciaeje4, kilometraje
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, true, NOW(), 0, 0, 0, 0, 0)
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
        formVehiculo.clase || null
      ]);
    } else {
      await client.query(`
        UPDATE vehiculo SET
          nroplacaantigua = COALESCE($2, nroplacaantigua),
          nroserie = COALESCE($3, nroserie),
          aniofabricacion = COALESCE($4, aniofabricacion),
          nrosoat = COALESCE($5, nrosoat),
          fechmodi = NOW()
        WHERE nromotor = $1
      `, [
        nroMotorFinal,
        placaNueva,
        formVehiculo.nroSerie || null,
        formVehiculo.anioFabricacion || null,
        formVehiculo.nroSoat || null
      ]);
    }

    // Generar IDs
    const tsInsp = new Date().getTime().toString().slice(-9);
    const nroInspeccion = `INS-${tsInsp}`;
    const nroComprobanteTemp = 'BORRADOR-' + new Date().getTime().toString().slice(-9);
    const nextIdResult = await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM comprobante");
    const nextComprobanteId = nextIdResult.rows[0].next_id;

    // 3. Crear Inspeccion (Primero, porque comprobante requiere inspeccion_nrodocumentoinspeccion)
    await client.query(`
      INSERT INTO inspeccion (
        nrodocumentoinspeccion, estado, fechcreacion, indicedesaprobado,
        tipoautorizacion_key, tipocertificado_key, tipoinspeccion_key, vehiculo_nromotor, ui_metadata
      ) VALUES ($1, true, NOW(), 0, $2, $3, $4, $5, $6)
    `, [
      nroInspeccion,
      formCaja.tipoAutorizacion || null,
      formCaja.tipoCertificado || null,
      formCaja.tipoInspeccion || null,
      nroMotorFinal,
      JSON.stringify({ formCaja, formVehiculo, formFacturacion, formVerificacion, pagosAgregados })
    ]);

    // 4. Crear Comprobante
    const resultComp = await client.query(`
      INSERT INTO comprobante (
        id, nrocomprobante, estado, fechcreacion, placamotor, cliente_nrodocumentoidentidad,
        conceptoinspeccion_key, linea_key, tipodocumento_key, importetotal, baseimponible, igv,
        totaldscto, totalsindscto, inspeccion_nrodocumentoinspeccion
      ) VALUES ($1, $2, true, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12) RETURNING id
    `, [
      nextComprobanteId,
      nroComprobanteTemp,
      placaNueva,
      documentoProp,
      formCaja.concepto || null,
      formCaja.linea || null,
      formFacturacion?.tipoComprobante || null,
      formFacturacion?.total || 0,
      formFacturacion?.subtotal || 0,
      formFacturacion?.igv || 0,
      formFacturacion?.total || 0,
      nroInspeccion
    ]);
    const comprobanteId = resultComp.rows[0].id;

    // 5. Actualizar Inspeccion con el comprobante_id
    await client.query("UPDATE inspeccion SET comprobante_id = $1 WHERE nrodocumentoinspeccion = $2", [comprobanteId, nroInspeccion]);

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
