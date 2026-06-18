const { Pool } = require('pg');
const pool = new Pool({user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432});

async function run() {
  try {
    const tables = ['vehiculoclase', 'marca', 'color', 'carroceria', 'modelo'];
    for (const t of tables) {
      const res = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${t}'`);
      console.log('--- ' + t + ' ---');
      console.log(res.rows.map(r => r.column_name + ': ' + r.data_type).join('\n'));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
