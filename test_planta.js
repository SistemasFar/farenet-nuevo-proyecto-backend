const pool = require('./config/database');
async function test() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type, table_name
      FROM information_schema.columns
      WHERE table_name IN ('inspeccion', 'comprobante', 'ordentrabajo', 'linea', 'planta')
        AND column_name LIKE '%planta%'
      ORDER BY table_name, column_name;
    `);
    console.log(res.rows);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
test();
