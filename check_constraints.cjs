const db = require('./config/database.js');
async function check() {
  const query = `
    SELECT
      tc.table_name,
      tc.constraint_name,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name IN ('fg_usuario_planta', 'fg_usuario_sesion')
  `;
  try {
    const res = await db.query(query);
    console.table(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
check();
