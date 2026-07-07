const pool = require('./config/database');
const test = async () => {
  try {
    const res = await pool.query(`SELECT campania_id FROM campaniadetalle cd INNER JOIN campania c ON cd.campania_id = c.id WHERE c.key = 'CORP_TRANSMOTAR' AND cd.conceptoinspeccion_key = '30'`);
    console.log("Found:", res.rows);
  } catch(e) {}
  process.exit(0);
};
test();
