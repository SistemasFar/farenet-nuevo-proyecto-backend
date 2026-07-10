const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('resultado_maquina', 'resultado_maquina_defecto', 'defecto', 'maquina', 'tipomaquina') ORDER BY table_name, ordinal_position");
  console.table(res.rows);
  c.release();
  process.exit(0);
}
check();
