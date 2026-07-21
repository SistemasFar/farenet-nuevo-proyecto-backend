const db = require('./config/database');
async function run() {
   const q = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name LIKE '%defecto%' OR table_name LIKE '%obs%')
   `;
   const res = await db.query(q);
   console.log('Tables:', res.rows.map(r => r.table_name));

   // Also check the columns of inspeccion for anything related to defect or obs
   const q2 = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'inspeccion'
      AND (column_name LIKE '%defecto%' OR column_name LIKE '%obs%')
   `;
   const res2 = await db.query(q2);
   console.log('Columns in inspeccion:', res2.rows.map(r => r.column_name));

   process.exit(0);
}
run();
