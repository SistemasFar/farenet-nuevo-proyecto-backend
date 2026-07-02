const pool = require('./config/database');
pool.query(`UPDATE inspeccion SET tipodesaprobado = 'D' WHERE tipodesaprobado = 'L'`).then(() => console.log('UPDATED L to D')).catch(console.error).finally(()=>process.exit(0));
