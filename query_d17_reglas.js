const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', password: 'farenet2026**', database: 'inspeccion', port: 5432 });

pool.query("SELECT dd.planta_key AS plantaKey, dd.servicio_id AS servicioId, dd.tipo_calculo AS tipoCalculo, dd.valor FROM fg_descuentodetalle dd WHERE dd.descuento_id = 17 AND dd.activo = TRUE", (err, res) => {
  if (err) console.error(err);
  else console.log(JSON.stringify(res.rows, null, 2));
  pool.end();
});