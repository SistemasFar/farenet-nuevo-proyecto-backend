require('dotenv').config();
const { Pool } = require('pg'); 
const pool = new Pool({ 
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
}); 

async function run() { 
  try {
    const res = await pool.query(`
      SELECT nrodocumentoinspeccion, inspeccionestado_key, posicion, resultado, fechconsolidado, fechmodi, fechanulacion, observacionanulado, usuarioanulacion_username 
      FROM inspeccion 
      WHERE inspeccionestado_key = 'ANU' 
      ORDER BY fechmodi DESC NULLS LAST 
      LIMIT 5
    `); 
    console.log('ANU inspections:', res.rows); 
    
    const schema = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'inspeccion' 
      ORDER BY ordinal_position
    `); 
    console.log('Columns:', schema.rows.map(r => r.column_name)); 
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0); 
  }
} 
run();
