const db = require('../config/database');

async function run() {
    const client = await db.connect();
    try {
        const q = await client.query("SELECT planta_key, linea_key, COUNT(*) as c FROM seriedocumento GROUP BY planta_key, linea_key HAVING COUNT(*) > 1 LIMIT 5");
        console.log("Duplicados planta/linea:");
        console.log(q.rows);
    } catch(e) {
        console.error(e);
    } finally {
        client.release();
    }
    process.exit(0);
}
run();
