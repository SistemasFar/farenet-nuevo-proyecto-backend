require('dotenv').config({path: './.env', override: true});
const pool = require('./config/database');

async function check() {
    try {
        const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'fg_%'");
        console.log("Tablas FG:", res.rows.map(r => r.table_name));
        
        // Also let's check if there's any data in gnv_verificacion or glp_verificacion
        const gnv = await pool.query("SELECT * FROM fg_certificado_gnv_verificacion");
        console.log("GNV verificaciones rows:", gnv.rows);
        
        const glp = await pool.query("SELECT * FROM fg_certificado_glp_verificacion");
        console.log("GLP verificaciones rows:", glp.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
check();
