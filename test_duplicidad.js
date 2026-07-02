const pool = require('./config/database');
pool.query("SELECT i.fechcreacion, i.fechcreacion::date as fc_date, CURRENT_DATE as cur_date, i.inspeccionestado_key, c.conceptoinspeccion_key FROM inspeccion i JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion WHERE c.placamotor = '5555'").then(res => {
  console.log(res.rows);
  process.exit(0);
}).catch(console.error);
