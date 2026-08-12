const pool = require('./config/database.js');
async function run() {
    try {
        const res = await pool.query("SELECT * FROM fg_usuario_planta up JOIN fg_usuario u ON up.usuario_username = u.username WHERE u.perfil_id != 'SISTEMAS'");
        console.log('USUARIO_PLANTA_NO_SISTEMAS:', res.rows);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
