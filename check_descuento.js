const pool = require('./config/database');

async function check() {
  const res = await pool.query("SELECT * FROM descuento WHERE empresa_nrodocumentoidentidad = '10101010101'");
  console.log(res.rows);
  process.exit(0);
}
check();
