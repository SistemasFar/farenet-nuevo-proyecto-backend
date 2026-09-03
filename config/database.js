const { Pool } = require('pg');
require('dotenv').config();

const requiredEnvVars = [
    'DB_USER',
    'DB_HOST',
    'DB_NAME',
    'DB_PASSWORD',
    'DB_PORT'
];

const missingEnvVars = requiredEnvVars.filter((envVar) => {
    return !process.env[envVar];
});

if (missingEnvVars.length > 0) {
    console.error('❌ Faltan variables de entorno para PostgreSQL:');
    console.error(missingEnvVars.join(', '));
}

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

// La comprobación de arranque no debe abrir conexiones laterales durante las
// pruebas unitarias: cada worker de node:test importa este módulo por separado.
if (process.env.NODE_ENV !== 'test') {
    pool.query('SELECT NOW()', (err) => {
        if (err) {
            console.log('❌ ERROR DETALLADO DE POSTGRES:');
            console.error(err);
        } else {
            console.log('✅ CONEXIÓN EXITOSA A POSTGRESQL');
        }
    });
}

module.exports = pool;
