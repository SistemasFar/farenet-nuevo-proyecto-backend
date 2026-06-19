const { Pool } = require('pg'); const pool = new Pool({user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432}); 
pool.query(`
SELECT 
  be.estado_json::json->'formVehiculo'->>'nroDocProp' AS nro,
  be.estado_json::json->'formVehiculo'->>'nombresProp' AS nombres,
  be.estado_json::json->'formCaja'->>'concepto' AS concepto
FROM borrador_estado be
WHERE be.estado_json::json->'formVehiculo'->>'nroDocProp' IS NOT NULL
LIMIT 5
`).then(res => console.log(res.rows)).catch(console.error).finally(()=>pool.end());
