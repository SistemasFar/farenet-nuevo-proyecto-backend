const pool = require('./config/database');
const sql = `
  SELECT i.nrodocumentoinspeccion, i.resultado, i.fechconsolidado, c.placamotor, c.conceptoinspeccion_key, c.importetotal 
  FROM inspeccion i 
  JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion 
  WHERE i.resultado = 'D' AND i.fechconsolidado IS NOT NULL 
  ORDER BY i.fechcreacion DESC LIMIT 5
`;
pool.query(sql).then(r => console.log(r.rows)).catch(console.error).finally(()=>process.exit(0));
