const db = require('../config/database');

async function run() {
    const client = await db.connect();
    try {
        const q = await client.query("SELECT planta_key, linea_key, nroinicio, nroactual, nromaximo, estado FROM seriedocumento WHERE linea_key = 'L2_LIVIANOS_PDERBY' ORDER BY id DESC");
        console.log("Historial de L2_LIVIANOS_PDERBY:");
        console.log(q.rows);
    } catch(e) {
        console.error(e);
    } finally {
        client.release();
    }
    process.exit(0);
}
run();
