const pool = require('./config/database');
const test = async () => {
  try {
    const res = await pool.query(`SELECT key, nombre FROM conceptoinspeccion WHERE UPPER(nombre) LIKE '%PARTICULAR LIVIANOS%' OR UPPER(nombre) LIKE '%CAMIONETA RURAL%'`);
    console.log(res.rows);
  } catch(e) {}
  process.exit(0);
};
test();
