const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', password: 'farenet2026**', database: 'inspeccion', port: 5432 });

pool.query("SELECT dd.planta_key AS plantaKey, dd.servicio_id AS servicioId, dd.tipo_calculo AS tipoCalculo, dd.valor, dd.valor_contado, dd.valor_credito, p.nombre AS planta_nombre FROM fg_descuentodetalle dd JOIN fg_planta p ON p.key = dd.planta_key WHERE dd.descuento_id = 23 AND dd.activo = TRUE ORDER BY p.nombre, dd.servicio_id", (err, res) => {
  if (err) console.error(err);
  else console.log(JSON.stringify(res.rows, null, 2));
  pool.end();
});