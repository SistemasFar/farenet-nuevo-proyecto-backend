const db = require('../config/database');
async function run() {
  const q = await db.query(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND (
      column_name ILIKE '%version%' OR
      column_name ILIKE '%vin%' OR
      column_name ILIKE '%cilindra%' OR
      column_name ILIKE '%potencia%' OR
      column_name ILIKE '%formula%' OR
      column_name ILIKE '%rodante%' OR
      column_name ILIKE '%chasis%' OR
      column_name ILIKE '%serie%' OR
      column_name ILIKE '%anio%modelo%' OR
      column_name ILIKE '%modelo%anio%' OR
      column_name ILIKE '%placa%'
    )
    ORDER BY table_name, column_name
  `);
  console.log(JSON.stringify(q.rows, null, 2));
  process.exit(0);
}
run();
