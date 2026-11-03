const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', password: 'farenet2026**', database: 'inspeccion', port: 5432 });

pool.query("SELECT d.id, d.codigo, d.nombre, dc.id AS codigo_id, dc.codigo AS codigo_autorizacion FROM fg_descuento d JOIN fg_descuentocliente dc ON dc.descuento_id = d.id WHERE d.id = 17 AND UPPER(BTRIM(dc.codigo)) = 'DESCUENTO_TALLER' LIMIT 1", (err, res) => {
  if (err) console.error(err);
  else console.log(JSON.stringify(res.rows, null, 2));
  pool.end();
});