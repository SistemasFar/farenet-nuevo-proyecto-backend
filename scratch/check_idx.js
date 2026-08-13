const db = require('./config/database');
async function main() {
  const res = await db.query("SELECT indexdef FROM pg_indexes WHERE tablename = 'fg_correlativo_certificado'");
  console.log(res.rows);
  const res2 = await db.query("SELECT pg_get_constraintdef(oid) as def, conname FROM pg_constraint WHERE conrelid = 'fg_correlativo_certificado'::regclass");
  console.log(res2.rows);
  process.exit(0);
}
main();
