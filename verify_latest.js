const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: '192.168.14.19',
  database: 'inspeccion',
  password: 'farenet2026**',
  port: 5432,
});

async function verify() {
  try {
    const inspQuery = await pool.query(`
      SELECT nrodocumentoinspeccion, vehiculo_nromotor, estado, inspeccionestado_key, ui_metadata 
      FROM inspeccion 
      WHERE nrodocumentoinspeccion LIKE 'INS-201-000157%' 
      ORDER BY nrodocumentoinspeccion DESC 
      LIMIT 1
    `);
    const inspeccion = inspQuery.rows[0];
    if (!inspeccion) {
      console.log('No se encontró ninguna inspección finalizada reciente.');
      process.exit();
    }
    
    console.log('--- INSPECCIÓN ÚLTIMA CREADA ---');
    console.log('Nro Inspección:', inspeccion.nrodocumentoinspeccion);
    console.log('Estado:', inspeccion.inspeccionestado_key);
    
    const uiData = typeof inspeccion.ui_metadata === 'string' ? JSON.parse(inspeccion.ui_metadata || '{}') : (inspeccion.ui_metadata || {});
    console.log('Documento Pago Guardado:', uiData.documentoPago || 'N/A');
    console.log('Precio Total Guardado:', uiData.precioTotal || 'N/A');
    
    const vehQuery = await pool.query(`
      SELECT nromotor, nroplacaantigua, marca_key, modelo_key 
      FROM vehiculo 
      WHERE nromotor = $1
    `, [inspeccion.vehiculo_nromotor]);
    console.log('\n--- VEHÍCULO GUARDADO ---');
    console.log(vehQuery.rows[0] || 'No se encontró vehículo con ese motor');
    
    const compQuery = await pool.query(`
      SELECT nrocomprobante, placamotor, linea_key, tipodocumento_key, importetotal 
      FROM comprobante 
      WHERE inspeccion_nrodocumentoinspeccion = $1
    `, [inspeccion.nrodocumentoinspeccion]);
    console.log('\n--- COMPROBANTE GENERADO ---');
    console.log(compQuery.rows[0] || 'No se encontró comprobante');
    
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
verify();
