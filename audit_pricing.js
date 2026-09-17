const { Client } = require('pg');
const dotenv = require('dotenv');
const fs = require('fs');

const envConfig = dotenv.parse(fs.readFileSync('.env'));
const cl = new Client({
    host: envConfig.DB_HOST,
    port: envConfig.DB_PORT,
    user: envConfig.DB_USER,
    password: envConfig.DB_PASSWORD,
    database: envConfig.DB_NAME
});

async function run() {
    await cl.connect();
    try {
        const res = await cl.query("SELECT * FROM fg_producto_facturacion WHERE id = 2221");
        console.log(res.rows);
    } finally {
        await cl.end();
    }
}
run().catch(console.error);
