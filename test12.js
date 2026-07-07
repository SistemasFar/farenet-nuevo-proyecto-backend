const pool = require('./config/database');
const test = async () => {
  try {
    const res = await pool.query(`
      SELECT cd.* FROM campaniadetalle cd 
      JOIN campania c ON cd.campania_id = c.id 
      WHERE c.key = 'CORP_TRANSMOTAR' AND cd.conceptoinspeccion_key = '2'
    `);
    console.log(res.rows);
  } catch(e) {}
  process.exit(0);
};
test();
