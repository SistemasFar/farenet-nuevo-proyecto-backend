const db = require('./config/database');
db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'").then(res => {
  const tables = res.rows.map(r => r.table_name);
  console.log(tables.filter(t => ['carroceria', 'marcacarroceria', 'color', 'tipoinspeccion', 'tipocertificado'].includes(t)));
  process.exit(0);
});
