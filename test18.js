const pool = require('./config/database');
const test = async () => {
  try {
    const res = await pool.query(`SELECT key, nombre FROM conceptoinspeccion WHERE nombre ILIKE '%AMBULANCIA%'`);
    console.log(res.rows);
  } catch(e) {}
  process.exit(0);
};
test();
