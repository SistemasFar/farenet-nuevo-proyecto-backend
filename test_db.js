const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: '192.168.14.19',
  database: 'inspeccion',
  password: 'farenet2026**',
  port: 5432
});

async function run() {
  try {
    console.log("Departamento:", (await pool.query("SELECT * FROM departamento LIMIT 1")).rows[0]);
    console.log("Provincia:", (await pool.query("SELECT * FROM provincia LIMIT 1")).rows[0]);
    console.log("Distrito:", (await pool.query("SELECT * FROM distrito LIMIT 1")).rows[0]);
    console.log("Pais:", (await pool.query("SELECT * FROM pais LIMIT 1")).rows[0]);
    console.log("TipoDoc:", (await pool.query("SELECT * FROM tipodocumentoidentidad LIMIT 1")).rows[0]);
  } finally {
    pool.end();
  }
}
run();
