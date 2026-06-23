const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });
const tables = ['comprobante', 'vehiculo', 'persona'];
Promise.all(tables.map(t => pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}'`)))
  .then(results => {
    results.forEach((r, i) => {
      console.log(`\n--- TABLE ${tables[i]} ---`);
      console.log(r.rows.map(x => x.column_name).join(', '));
    });
    process.exit(0);
  });
