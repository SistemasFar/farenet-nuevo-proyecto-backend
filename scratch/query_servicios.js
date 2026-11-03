const db = require('../config/database');
db.query("SELECT t.planta_key, s.id, s.codigo, s.nombre, c.nombre AS categoria, s.tipo_certificado_clave, s.modalidad, s.tipo_flujo, t.activo AS tarifa_activo, p.activo AS planta_activo, s.activo AS servicio_activo, c.activo AS categoria_activo FROM fg_tarifa t JOIN fg_planta p ON p.key=t.planta_key JOIN fg_servicio s ON s.id=t.servicio_id JOIN fg_categoria_servicio c ON c.id=s.categoria_id WHERE t.planta_key IN ('13', '98', '160') AND s.id IN (328, 329, 331, 406, 414, 415) ORDER BY t.planta_key, s.id").then(r => {
  console.log('SERVICIOS DISPONIBLES:');
  r.rows.forEach(row => console.log(JSON.stringify(row)));
  console.log('TOTAL:', r.rows.length);
  process.exit(0);
}).catch(e => { console.log('ERROR:', e.message); process.exit(1); });
