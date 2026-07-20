const db = require('./config/database');
async function run() {
  try {
    const q1 = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'norma';
    `;
    const res1 = await db.query(q1);
    console.log('--- COLUMNAS norma ---');
    console.table(res1.rows);
  } catch (e) { console.error(e); } finally { process.exit(0); }
}
run();
