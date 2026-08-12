const db = require('./config/database.js');
async function check() {
  const res = await db.query("SELECT username, perfil_id, estado FROM fg_usuario WHERE username = 'gibarra'");
  console.table(res.rows);
  process.exit(0);
}
check();
