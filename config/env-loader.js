const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

let loaded = false;

function loadEnv(force = false) {
    if (loaded && !force) return;

    if (process.env.NODE_ENV === 'test' && !force) {
        loaded = true;
        return;
    }

    const envFile = process.env.APP_ENV_FILE;
    const targetFile = envFile ? envFile : '.env';
    const envPath = path.resolve(__dirname, '..', targetFile);

    if (envFile && !fs.existsSync(envPath)) {
        throw new Error(`Configuracion abortada: El archivo de entorno solicitado '${envFile}' no existe en la ruta '${envPath}'.`);
    }

    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
    }

    loaded = true;
}

// Auto-carga inicial
loadEnv();

module.exports = { loadEnv };
