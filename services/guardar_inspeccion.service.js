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
          vehiculoclase_key, estado, fechcreacion
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, true, NOW())
      `, [
        nroMotorFinal,
        placaNueva,
        formVehiculo.nroSerie || null,
        formVehiculo.anioFabricacion || null,
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
        formVehiculo.nroSoat || null,
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

    // 3. Crear Comprobante
    // Generar un id (usando sequence o retornando id)
    const nroComprobanteTemp = 'BORRADOR-' + new Date().getTime().toString().slice(-9);
    const resultComp = await client.query(`
      INSERT INTO comprobante (
        nrocomprobante, estado, fechcreacion, placamotor, cliente_nrodocumentoidentidad,
        conceptoinspeccion_key, linea_key, tipodocumento_key, importetotal, baseimponible, igv
      ) VALUES ($1, true, NOW(), $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
    `, [
      nroComprobanteTemp,
      placaNueva,
      documentoProp,
      formCaja.concepto || null,
      formCaja.linea || null,
      formFacturacion?.tipoComprobante || null,
      formFacturacion?.total || 0,
      formFacturacion?.subtotal || 0,
      formFacturacion?.igv || 0
    ]);
    const comprobanteId = resultComp.rows[0].id;

    // 4. Crear Inspeccion
    const tsInsp = new Date().getTime().toString().slice(-9);
    const nroInspeccion = `INS-${tsInsp}`;
    
    await client.query(`
      INSERT INTO inspeccion (
        nrodocumentoinspeccion, estado, fechcreacion, indicedesaprobado, comprobante_id,
        tipoautorizacion_key, tipocertificado_key, tipoinspeccion_key, vehiculo_nromotor, ui_metadata
      ) VALUES ($1, true, NOW(), 0, $2, $3, $4, $5, $6, $7)
    `, [
      nroInspeccion,
      comprobanteId,
      formCaja.tipoAutorizacion || null,
      formCaja.tipoCertificado || null,
      formCaja.tipoInspeccion || null,
      nroMotorFinal,
      JSON.stringify({ formCaja, formVehiculo, formFacturacion, formVerificacion, pagosAgregados })
    ]);

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
