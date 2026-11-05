const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', password: 'farenet2026**', database: 'inspeccion', port: 5432 });

pool.query(
  "SELECT f.id, f.codigo, f.motor, f.es_protegido, v.id as version_id, v.estado, v.motor as version_motor FROM fg_certificado_formato f JOIN fg_certificado_formato_version v ON v.formato_id = f.id WHERE f.codigo = 'GLP_INICIAL' ORDER BY v.id",
  (err, res) => {
    if (err) console.error(err);
    else console.log(JSON.stringify(res.rows, null, 2));
    pool.end();
  }
);