const pool = require('./config/database');
async function test() {
  try {
    const motorAUsar = '-';
    const formCaja = {};
    const formVehiculo = {};
    const placa = 'TEST12';

    await pool.query('BEGIN');
    const q = await pool.query(`
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
      formVehiculo?.inicioSoat || null, formVehiculo?.finSoat || null, placa, motorAUsar
    ]);

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
      placa, motorAUsar, formCaja?.categoria || null, formVehiculo?.categoriaExtra || null,
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

    await pool.query('ROLLBACK');
    console.log("SUCCESS!");
    process.exit(0);
  } catch (err) {
    console.error("ERROR IN SQL:", err.message);
    process.exit(1);
  }
}
test();
