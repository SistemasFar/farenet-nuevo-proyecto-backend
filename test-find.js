const db = require('./config/database');
async function run() {
   const q = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
   `;
   const res = await db.query(q);
   const tables = res.rows.map(r => r.table_name);
   
   console.log('Searching for INS-201-000157904 in all tables...');
   for (const table of tables) {
       try {
           const qCols = `SELECT column_name FROM information_schema.columns WHERE table_name = $1`;
           const resCols = await db.query(qCols, [table]);
           const cols = resCols.rows.map(r => r.column_name);
           
           for (const col of cols) {
               if (col.includes('inspeccion') || col.includes('nrodocumento')) {
                   try {
                       const qSearch = `SELECT * FROM "${table}" WHERE "${col}" LIKE '%INS-201-000157904%' LIMIT 1`;
                       const resSearch = await db.query(qSearch);
                       if (resSearch.rows.length > 0) {
                           console.log(`\nFOUND IN TABLE: ${table} (column ${col})`);
                           const row = resSearch.rows[0];
                           for (const k in row) {
                               if (row[k] !== null && String(row[k]).toLowerCase().includes('obs')) {
                                   console.log(`  -> ${k}: ${row[k]}`);
                               }
                           }
                       }
                   } catch(e) {}
               }
           }
       } catch (e) {}
   }
   
   console.log('Done searching.');
   process.exit(0);
}
run();
