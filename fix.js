const db = require('./config/database');

async function fix() {
    try {
        await db.query(`INSERT INTO usuario_empresa (usuario_username, empresa_key, activo) VALUES ('mchavez', 'FARENET', true) ON CONFLICT DO NOTHING`);
        await db.query(`INSERT INTO usuario_empresa (usuario_username, empresa_key, activo) VALUES ('mchavez', 'FAREGAS', true) ON CONFLICT DO NOTHING`);
        console.log("mchavez insertado con éxito en FARENET y FAREGAS.");
        process.exit(0);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

fix();
