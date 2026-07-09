require('dotenv').config();
const pool = require('./config/database');

async function runQueries() {
  try {
    const q2 = await pool.query(`
      SELECT n.nspname AS schema_name, p.proname AS function_name, pg_get_functiondef(p.oid) AS function_definition 
      FROM pg_proc p 
      JOIN pg_namespace n ON n.oid = p.pronamespace 
      WHERE p.prokind IN ('f', 'p') AND pg_get_functiondef(p.oid) ILIKE '%ANULADO%';
    `);
    console.log("=== 2. FUNCIONES QUE CONTIENEN 'ANULADO' ===");
    console.log(JSON.stringify(q2.rows, null, 2));

    const q3 = await pool.query(`
      SELECT schemaname, tablename, rulename, definition 
      FROM pg_rules 
      WHERE tablename = 'inspeccion';
    `);
    console.log("=== 3. RULES SOBRE INSPECCION ===");
    console.log(JSON.stringify(q3.rows, null, 2));

    const q4 = await pool.query(`
      SELECT tgname AS trigger_name, tgrelid::regclass AS table_name, pg_get_triggerdef(oid) AS trigger_definition 
      FROM pg_trigger 
      WHERE tgrelid IN ('inspeccion'::regclass, 'comprobante'::regclass, 'pago'::regclass, 'vehiculo'::regclass, 'persona'::regclass, 'tarjetapropiedad'::regclass) 
      AND NOT tgisinternal;
    `);
    console.log("=== 4. TRIGGERS EN TABLAS ANEXAS ===");
    console.log(JSON.stringify(q4.rows, null, 2));

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

runQueries();
