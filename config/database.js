require('./env-loader');
const { Pool } = require('pg');

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

const reportPostgresError = (error) => {
    const code = error?.code ? ` (${error.code})` : '';
    console.error(`[PostgreSQL] Error de conexión${code}: ${error?.message || 'error desconocido'}`);
};

// Un reset de la conexión puede emitirse como evento del Client después de
// liberar el pool. Sin listener, Node termina todo el proceso aunque la
// promesa del cron ya haya sido capturada.
pool.on('error', reportPostgresError);

const connectOriginal = pool.connect.bind(pool);
const clientesConManejo = new WeakSet();
const registrarCliente = (client) => {
    if (client && !clientesConManejo.has(client)) {
        clientesConManejo.add(client);
        client.on('error', reportPostgresError);
    }
    return client;
};

pool.connect = (...args) => {
    const callback = args.at(-1);
    if (typeof callback === 'function') {
        args.pop();
        return connectOriginal(...args, (error, client, release) => {
            callback(error, registrarCliente(client), release);
        });
    }
    return connectOriginal(...args).then(registrarCliente);
};

if (process.env.NODE_ENV !== 'test') {
    pool.query('SELECT NOW()', (err, res) => {
        if (err) {
            console.error('❌ Error conectando a PostgreSQL:', err.message);
        } else {
            console.log('✅ CONEXIÓN EXITOSA A POSTGRESQL');
        }
    });
}

module.exports = pool;
