const pool = require('./config/database');
pool.query("SELECT * FROM periodoreinspeccion WHERE tipodesaprobado = 'L'").then(res => console.log(res.rows)).catch(console.error).finally(() => process.exit(0));
