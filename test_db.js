const db = require('./config/database');

async function test() {
    try {
        const res = await db.query("SELECT key, nombre, estado FROM conceptoinspeccion WHERE nombre ILIKE '%colectivo%' OR estado = false");
        console.log(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
test();
