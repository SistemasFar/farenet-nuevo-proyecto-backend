const pool = require('./config/database.js');
const tables = ['usuario_sesion', 'inspeccion', 'inspeccionestado', 'linea', 'usuario_permiso_override', 'linea_estado', 'borrador_estado', 'rol', 'perfil'];
Promise.all(tables.map(t => pool.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name = '${t}'`)))
.then(results => {
    results.forEach(res => {
        if(res.rows.length > 0) {
            console.log(`\nColumns for ${res.rows[0].table_name}:`);
            console.table(res.rows.map(r => ({ column: r.column_name, type: r.data_type })));
        }
    });
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
