const pool = require('./config/database');
async function run() {
  let res = await pool.query("SELECT * FROM marca WHERE key = '1267226854'");
  console.log("Marca original:", res.rows);
  
  if (res.rows.length > 0) {
    let name = res.rows[0].nombre;
    let minRes = await pool.query("SELECT MIN(key) as key, nombre FROM marca WHERE nombre = $1 GROUP BY nombre", [name]);
    console.log("MIN(key) para ese nombre:", minRes.rows);
  }
  process.exit(0);
}
run();
