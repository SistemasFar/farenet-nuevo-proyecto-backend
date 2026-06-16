const db = require('./config/database');
async function test() {
    try {
        const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='cuentacorriente'");
        console.log(res.rows);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
test();
