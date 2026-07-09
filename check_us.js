const pool = require('./config/database.js');
pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'usuario_sesion'`).then(res => {
    console.table(res.rows.map(r => ({ column: r.column_name, type: r.data_type })));
    process.exit(0);
});
