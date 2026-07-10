const pool = require('./config/database');
async function check() {
  const c = await pool.connect();
  
  const cb = await c.query("SELECT * FROM combustible");
  console.log('Combustibles:');
  console.log(cb.rows.map(r => `${r.key}: ${r.nombre}`).join('\n'));
  
  const cols = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='categoria'");
  console.log('Categoria columns:', cols.rows.map(r=>r.column_name));
  
  const colsLinea = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='linea'");
  console.log('Linea columns:', colsLinea.rows.map(r=>r.column_name));
  
  const colsInsp = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='inspeccion'");
  console.log('Inspeccion columns:', colsInsp.rows.map(r=>r.column_name));

  const nm = await c.query("SELECT * FROM norma LIMIT 5");
  console.log('\nNormas:');
  console.log(nm.rows);

  // Check how subnormas tie to categories
  // The Java code did: if(subnorma.getCondicionAnio().equals(">=") && subnorma.getAnio()==2015)
  // Let's check subnorma table
  const sn = await c.query("SELECT * FROM subnorma LIMIT 5");
  console.log('\nSubnormas:');
  console.log(sn.rows);
  
  c.release();
  process.exit(0);
}
check();
