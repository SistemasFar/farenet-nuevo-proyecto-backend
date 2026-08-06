const db = require('./config/database');

async function check() {
    try {
        const d = await db.query(`SELECT * FROM usuario_empresa WHERE usuario_username = 'mchavez'`); 
        console.log("mchavez data:", d.rows); 
        process.exit(0);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

check();
