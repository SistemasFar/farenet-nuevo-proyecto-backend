const db = require('./config/database');
async function test() {
  try {
    const q1 = await db.query(`SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'resultado_maquina' AND column_name IN ('id', 'data')`);
    console.log("resultado_maquina schema:", q1.rows);
    
    const q2 = await db.query(`
      SELECT
        tc.table_name, kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'resultado_maquina_defecto'
    `);
    console.log("FKs de resultado_maquina_defecto:", q2.rows);
  } catch (e) {
    console.error(e.message);
  } finally {
    process.exit(0);
  }
}
test();
