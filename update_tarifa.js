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
        await cl.query("UPDATE fg_tarifa SET precio = 333 WHERE producto_facturacion_id = 2230");
        console.log('Tarifa actualizada a 333');
    } finally {
        await cl.end();
    }
}
run().catch(console.error);
