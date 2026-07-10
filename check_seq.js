const pool = require('./config/database');
async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT column_default FROM information_schema.columns WHERE table_name='resultado_maquina' AND column_name='id'");
  console.log('resultado_maquina.id default:', res.rows);
  const seqRes = await c.query("SELECT * FROM pg_class WHERE relkind = 'S'");
  console.log('Sequences:', seqRes.rows.map(s => s.relname));
  c.release();
  process.exit(0);
}
check();
