const db = require('./config/database');
db.query("UPDATE inspeccion SET fechcreacion = CURRENT_DATE - INTERVAL '1 day' WHERE nrodocumentoinspeccion IN (SELECT i.nrodocumentoinspeccion FROM inspeccion i JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion WHERE i.resultado = 'D' AND i.fechcreacion >= CURRENT_DATE - INTERVAL '30 days')").then(res => {
  console.log('Updated rows:', res.rowCount);
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
