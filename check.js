const db = require('./config/database');

async function check() {
    try {
        const res = await db.query(`
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name IN ('empresa', 'usuario_empresa')
        `);
        console.log("SCHEMA:", res.rows);
        
        const data = await db.query(`SELECT * FROM usuario_empresa LIMIT 5`);
        console.log("DATA usuario_empresa:", data.rows);
        
        const dataEmpresa = await db.query(`SELECT * FROM empresa LIMIT 5`);
        console.log("DATA empresa:", dataEmpresa.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

check();
