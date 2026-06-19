const { Pool } = require('pg'); const pool = new Pool({user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432}); 
pool.query(`
SELECT nrodocumentoinspeccion FROM inspeccion ORDER BY nrodocumentoinspeccion DESC LIMIT 1
`).then(res => console.log(res.rows)).catch(console.error).finally(()=>pool.end());
