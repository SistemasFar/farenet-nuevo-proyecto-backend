const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:farenet2026**@192.168.14.19:5432/inspeccion' });

const nro = 'INS-201-000158495';

pool.query(`
  SELECT * FROM inspeccion
  WHERE nrodocumentoinspeccion LIKE $1
`, [`${nro}%`]).then(res => {
  console.log(res.rows[0]);
  pool.end();
}).catch(console.error);
