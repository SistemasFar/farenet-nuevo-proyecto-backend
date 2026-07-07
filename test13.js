const pool = require('./config/database');
const test = async () => {
  try {
    const res = await pool.query(`
      SELECT ce.*, emp.nrodocumentoidentidad 
      FROM campanias_personas ce 
      JOIN campania c ON ce.campania_id = c.id 
      LEFT JOIN persona emp ON ce.persona_id = emp.nrodocumentoidentidad
      WHERE c.key = 'CORP_TRANSMOTAR'
    `);
    console.log(res.rows);
  } catch(e) {}
  process.exit(0);
};
test();
