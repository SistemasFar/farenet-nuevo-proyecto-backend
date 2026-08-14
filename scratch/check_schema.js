const pool = require('../config/database');
require('dotenv').config({ path: '../.env' }); // or just dotenv config if in root, wait, just run from root

async function checkNullable() {
    const query = `
        SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name IN ('fg_certificado_gnv_verificacion', 'fg_certificado_glp_verificacion')
        AND column_name = 'cumple';
    `;
    try {
        const result = await pool.query(query);
        console.log(result.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

checkNullable();
