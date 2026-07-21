const db = require('./config/database');
async function run() {
   const q = `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
   const res = await db.query(q);
   console.log(res.rows.map(r => r.table_name).filter(n => n.includes('regla')));
   process.exit(0);
}
run();
