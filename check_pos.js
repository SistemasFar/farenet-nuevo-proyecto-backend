const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT nrodocumentoinspeccion, inspeccionestado_key, posicion, fechconsolidado FROM inspeccion WHERE inspeccionestado_key IN ('PEN', 'CON') ORDER BY fechcreacion DESC LIMIT 50");
  
  const p = res.rows.map(r => ({
    nro: r.nrodocumentoinspeccion,
    est: r.inspeccionestado_key,
    pos: r.posicion,
    fcon: !!r.fechconsolidado
  }));
  
  console.log("Muestra de inspecciones:");
  console.table(p);

  c.release();
  process.exit(0);
}
check();
