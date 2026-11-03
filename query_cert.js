const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://localhost/faregas' });

pool.query('SELECT * FROM fg_certificado WHERE id = 726', (err, res) => {
  if (err) console.error(err);
  else console.log(JSON.stringify(res.rows[0], null, 2));
  pool.end();
});