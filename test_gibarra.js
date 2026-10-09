const db = require('./config/database');

async function run() {
  const fg = await db.query("SELECT * FROM fg_usuario WHERE username = 'gibarra'");
  console.log('fg:', fg.rows[0]);
  const leg = await db.query("SELECT * FROM usuario WHERE username = 'gibarra'");
  console.log('leg:', leg.rows[0]);
  process.exit(0);
}

run();
