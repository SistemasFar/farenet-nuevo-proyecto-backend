const pool = require('./config/database');
pool.query(`UPDATE inspeccion SET tipodesaprobado = 'D' WHERE nrodocumentoinspeccion = 'INS-TEST2-1000'`).then(() => console.log('UPDATED')).catch(console.error).finally(()=>process.exit(0));
