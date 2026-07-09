const pool = require('./config/database'); 
async function test() { 
  try { 
    const res = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'vehiculo'
        AND column_name IN (
          'nrocilindros',
          'nropisos',
          'nrosalidaemergencia',
          'categoriaextra',
          'marcacarroceria',
          'fechiniciotarjetapropiedad',
          'fechfintarjetapropiedad'
        )
      ORDER BY column_name;
    `);
    console.log(res.rows);
    process.exit(0); 
  } catch (e) { 
    console.error('Error:', e.message); 
    process.exit(1); 
  } 
}; 
test();
