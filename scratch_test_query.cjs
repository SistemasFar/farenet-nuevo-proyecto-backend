const db = require('./config/database.js');

async function run() {
  try {
    const r = await db.query(
      "SELECT p.key, p.nombre FROM fg_usuario_planta up JOIN fg_planta p ON p.key = up.plantas_key WHERE up.usuario_username = $1", 
      ['fakeuser']
    );
    console.log('Query OK:', r.rows);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
}

run();
