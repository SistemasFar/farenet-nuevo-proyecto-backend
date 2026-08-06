const pool = require('./config/database');

async function check() {
  try {
    const resAuthUser = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('auth_usuario', 'usuario')");
    if (resAuthUser.rows.length > 0) {
      const userTable = resAuthUser.rows[0].table_name;
      const res = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${userTable}'`);
      console.log(`Columnas de ${userTable}:`, res.rows);
    }
  } finally {
    await pool.end();
  }
}
check();
