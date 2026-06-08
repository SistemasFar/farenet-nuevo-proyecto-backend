const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Modificado para escupir el error completo y ver qué parámetro está fallando
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.log('❌ ERROR DETALLADO DE POSTGRES:');
        console.error(err); // <-- Esto imprime todo el objeto con el código nativo del error
    } else {
        console.log('✅ CONEXIÓN EXITOSA A POSTGRESQL');
    }
});

module.exports = pool;