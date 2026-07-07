const pool = require('./config/database');
const test = async () => {
  try {
    const res = await pool.query(`SELECT id, nombre, estado FROM campania WHERE key = 'CORP_TRANSMOTAR'`);
    console.log(res.rows);
  } catch(e) {}
  process.exit(0);
};
test();
