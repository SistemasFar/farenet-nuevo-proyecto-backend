const db = require('./config/database.js');

async function getConstraints() {
  try {
    const resFkUsuario = await db.query(`
      SELECT
        tc.table_name AS origen_tabla,
        tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE ccu.table_name = 'fg_usuario' AND tc.constraint_type = 'FOREIGN KEY'
    `);
    console.table(resFkUsuario.rows);
  } finally {
    process.exit(0);
  }
}
getConstraints();
