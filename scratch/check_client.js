const db = require('../config/database');

async function run() {
    const cl = await db.query(`SELECT * FROM fg_cliente WHERE id = 283`);
    console.log('Cliente 283:', cl.rows[0]);
    db.end();
}
run().catch(e => { console.error(e); db.end(); });

