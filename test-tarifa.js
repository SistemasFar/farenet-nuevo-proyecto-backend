const db = require('./config/database');
async function run() {
    try {
        const res = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%tarifa%'`);
        console.log("Tarifa tables:", res.rows);
        
        const res2 = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fg_tarifa'`);
        console.log("Columns of fg_tarifa:", res2.rows);

        const res3 = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fg_tarifa_sede'`);
        if (res3.rowCount > 0) {
            console.log("Columns of fg_tarifa_sede:", res3.rows);
        }
    } catch(e) { console.error(e); } finally { process.exit(0); }
}
run();
