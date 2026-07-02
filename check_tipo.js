const pool = require('./config/database');
pool.query(`SELECT tipodesaprobado FROM inspeccion WHERE nrodocumentoinspeccion = 'INS-TEST2-1000'`).then(r => console.log(r.rows)).catch(console.error).finally(()=>process.exit(0));
