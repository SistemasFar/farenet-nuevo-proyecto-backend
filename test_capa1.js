const db = require('./config/database');

async function testFinalQuery() {
  const nroInspeccion = 'INS-201-000160581';
  
  const query = `
      SELECT 
        c.nrohojavalorada,
        c.nrodocumentocertificado,
        i.nrodocumentoinforme,
        p.nombre as empresanombre,
        p.telefono as empresatelefono,
        pl.direccion as plantadireccion,
        comp.placamotor as placa, 
        cat.nombre as categoria, 
        v.categoriaextra,
        m.nombre as marca, 
        mod.nombre as modelo, 
        v.aniofabricacion, 
        v.kilometraje, 
        comb.nombre as combustible, 
        v.nroserie, 
        v.nromotor,
        v.nroejes, 
        v.nroruedas, 
        v.nroasientos, 
        v.nropasajeros, 
        v.longitud, 
        v.ancho, 
        v.alto, 
        v.pesoseco, 
        v.pesobruto, 
        v.cargautil,
        col.nombre as color, 
        carr.nombre as carrocerianombre, 
        v.marcacarroceria as marcacarrocerianombre,
        ti.nombre as tipoinspeccionnombre,
        COALESCE(prop.nombrerazonsocial, trim(COALESCE(prop.nombres,'') || ' ' || COALESCE(prop.apellidos,''))) as propietarionombre
      FROM inspeccion i
      LEFT JOIN certificado c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      LEFT JOIN comprobante comp ON comp.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      LEFT JOIN linea l ON l.key = comp.linea_key
      LEFT JOIN planta pl ON pl.key = l.planta_key
      LEFT JOIN empresa p ON p.key = pl.empresacertificadora_key
      LEFT JOIN vehiculo v ON v.nromotor = i.vehiculo_nromotor
      LEFT JOIN categoria cat ON v.categoria_key = cat.key
      LEFT JOIN marca m ON v.marca_key = m.key
      LEFT JOIN modelo mod ON v.modelo_key = mod.key
      LEFT JOIN combustible comb ON v.combustible_key = comb.key
      LEFT JOIN color col ON v.color_key = col.key
      LEFT JOIN carroceria carr ON v.carroceria_key = carr.key
      LEFT JOIN tipoinspeccion ti ON i.tipoinspeccion_key = ti.key
      LEFT JOIN tarjetapropiedad tp ON v.tarjetapropiedad_id = tp.id
      LEFT JOIN persona prop ON tp.propietario_nrodocumentoidentidad = prop.nrodocumentoidentidad
      WHERE i.nrodocumentoinspeccion = $1
      ORDER BY comp.id DESC NULLS LAST LIMIT 1
  `;
  try {
    const res = await db.query(query, [nroInspeccion]);
    console.log(res.rows[0]);
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}

testFinalQuery();
