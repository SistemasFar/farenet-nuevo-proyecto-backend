const crypto = require('crypto');

const EXCLUDED_USERNAME = 'gibarra';
const DEFAULT_ALGORITHM = 'aes-256-gcm';
const DEFAULT_KEY_VERSION = 1;

// Rate limiting en memoria para revelación de contraseñas custodiadas
// Máximo 5 consultas por minuto por administrador / IP
const REVEAL_WINDOW_MS = 60 * 1000;
const MAX_REVEALS_PER_WINDOW = 5;
const revealHistory = new Map();

/**
 * Obtiene y valida la clave criptográfica maestra de custodia desde el entorno.
 * Rechaza claves débiles o inexistentes.
 */
const obtenerClaveMaestra = () => {
    const rawKey = process.env.FAREGAS_CREDENTIAL_VAULT_KEY;
    if (!rawKey || typeof rawKey !== 'string') {
        const err = new Error('La clave maestra de custodia (FAREGAS_CREDENTIAL_VAULT_KEY) no está configurada.');
        err.code = 'VAULT_KEY_MISSING';
        err.statusCode = 500;
        throw err;
    }

    const trimmed = rawKey.trim();
    let keyBuffer;
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        keyBuffer = Buffer.from(trimmed, 'hex');
    } else {
        keyBuffer = crypto.createHash('sha256').update(trimmed, 'utf8').digest();
    }

    if (keyBuffer.length !== 32) {
        const err = new Error('La clave maestra de custodia debe tener exactamente 256 bits (32 bytes).');
        err.code = 'VAULT_KEY_INVALID';
        err.statusCode = 500;
        throw err;
    }

    return keyBuffer;
};

/**
 * Cifra la contraseña con AES-256-GCM.
 * Genera un IV aleatorio de 12 bytes y un Auth Tag de 16 bytes.
 */
const cifrarPassword = (plaintext) => {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
        throw new Error('La contraseña para cifrado no puede estar vacía.');
    }

    const key = obtenerClaveMaestra();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(DEFAULT_ALGORITHM, key, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const tag = cipher.getAuthTag();

    return {
        ciphertext,
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        algoritmo: DEFAULT_ALGORITHM,
        versionClave: DEFAULT_KEY_VERSION
    };
};

/**
 * Descifra la contraseña con AES-256-GCM y valida la etiqueta de autenticación.
 */
const descifrarPassword = ({ ciphertext, iv, tag }) => {
    if (!ciphertext || !iv || !tag) {
        throw new Error('Parámetros de descifrado incompletos (ciphertext, iv, tag requeridos).');
    }

    const key = obtenerClaveMaestra();
    const decipher = crypto.createDecipheriv(
        DEFAULT_ALGORITHM,
        key,
        Buffer.from(iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));

    let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
};

/**
 * Asegura la existencia no destructiva de la tabla fg_credencial_custodia.
 */
const asegurarTablaCustodia = async (dbClient) => {
    await dbClient.query(`
        CREATE TABLE IF NOT EXISTS public.fg_credencial_custodia (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) NOT NULL UNIQUE,
            ciphertext TEXT NOT NULL,
            iv VARCHAR(64) NOT NULL,
            tag VARCHAR(64) NOT NULL,
            algoritmo VARCHAR(30) DEFAULT 'aes-256-gcm' NOT NULL,
            version_clave INT DEFAULT 1 NOT NULL,
            origen VARCHAR(50) DEFAULT 'ADMINISTRACION_USUARIOS' NOT NULL,
            creado_por VARCHAR(100) NOT NULL,
            fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
            fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
            CONSTRAINT fk_fg_credencial_custodia_user FOREIGN KEY (username) REFERENCES public.fg_usuario(username) ON DELETE CASCADE
        )
    `);
    await dbClient.query(`
        CREATE INDEX IF NOT EXISTS idx_fg_credencial_custodia_username
        ON public.fg_credencial_custodia(LOWER(username))
    `);
};

/**
 * Cifra y persiste una contraseña en custodia dentro de la transacción activa.
 */
const guardarEnCustodia = async (client, {
    username,
    password,
    responsable = 'ADMINISTRADOR',
    origen = 'ADMINISTRACION_USUARIOS'
}) => {
    // La FK usa la clave exacta guardada en fg_usuario.
    const cleanUsername = String(username || '').trim();
    if (!cleanUsername) throw new Error('Username requerido para custodia.');

    if (cleanUsername.toLowerCase() === EXCLUDED_USERNAME) {
        const err = new Error('El usuario gibarra es una cuenta administrativa protegida y no puede ingresar a custodia.');
        err.code = 'USUARIO_PROTEGIDO';
        err.statusCode = 403;
        throw err;
    }

    const datosCifrados = cifrarPassword(password);

    await client.query(`
        INSERT INTO public.fg_credencial_custodia (
            username, ciphertext, iv, tag, algoritmo, version_clave, origen,
            creado_por, fecha_creacion, fecha_actualizacion
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (username) DO UPDATE SET
            ciphertext = EXCLUDED.ciphertext,
            iv = EXCLUDED.iv,
            tag = EXCLUDED.tag,
            algoritmo = EXCLUDED.algoritmo,
            version_clave = EXCLUDED.version_clave,
            origen = EXCLUDED.origen,
            creado_por = EXCLUDED.creado_por,
            fecha_actualizacion = CURRENT_TIMESTAMP
    `, [
        cleanUsername,
        datosCifrados.ciphertext,
        datosCifrados.iv,
        datosCifrados.tag,
        datosCifrados.algoritmo,
        datosCifrados.versionClave,
        origen,
        responsable
    ]);
};

/**
 * Elimina la credencial de custodia (ej. cuando el usuario cambia su propia clave personalmente).
 */
const eliminarDeCustodia = async (client, username) => {
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!cleanUsername) return;
    await client.query(
        'DELETE FROM public.fg_credencial_custodia WHERE LOWER(username) = $1',
        [cleanUsername]
    );
};

/**
 * Verifica si existe una credencial bajo custodia para el usuario y retorna sus metadatos (sin descifrar).
 */
const consultarEstadoCustodia = async (dbClient, username) => {
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!cleanUsername || cleanUsername === EXCLUDED_USERNAME) {
        return { custodiada: false };
    }

    try {
        const res = await dbClient.query(`
            SELECT origen, creado_por, fecha_actualizacion, version_clave
            FROM public.fg_credencial_custodia
            WHERE LOWER(username) = $1
            LIMIT 1
        `, [cleanUsername]);

        if (res.rowCount === 0) {
            return { custodiada: false };
        }

        const row = res.rows[0];
        return {
            custodiada: true,
            origen: row.origen,
            creadoPor: row.creado_por,
            fechaActualizacion: row.fecha_actualizacion,
            versionClave: row.version_clave
        };
    } catch {
        return { custodiada: false };
    }
};

/**
 * Obtiene y descifra la credencial bajo custodia para entrega administrativa.
 */
const obtenerCredencialDescifrada = async (dbClient, username) => {
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!cleanUsername) throw new Error('Username requerido.');

    if (cleanUsername === EXCLUDED_USERNAME) {
        const err = new Error('El usuario gibarra es una cuenta administrativa protegida y no posee credenciales en custodia.');
        err.code = 'USUARIO_PROTEGIDO';
        err.statusCode = 403;
        throw err;
    }

    const res = await dbClient.query(`
        SELECT ciphertext, iv, tag, algoritmo, version_clave, creado_por, fecha_actualizacion
        FROM public.fg_credencial_custodia
        WHERE LOWER(username) = $1
        LIMIT 1
    `, [cleanUsername]);

    if (res.rowCount === 0) {
        const err = new Error(`El usuario ${cleanUsername} no registra una credencial administrada bajo custodia.`);
        err.code = 'CREDENCIAL_NO_CUSTODIADA';
        err.statusCode = 404;
        throw err;
    }

    const row = res.rows[0];
    const password = descifrarPassword({
        ciphertext: row.ciphertext,
        iv: row.iv,
        tag: row.tag
    });

    return {
        username: cleanUsername,
        password,
        creadoPor: row.creado_por,
        fechaActualizacion: row.fecha_actualizacion,
        versionClave: row.version_clave
    };
};

/**
 * Control de limitación de tasa (Rate Limiting) para revelación de contraseñas.
 * Previene extracción masiva de credenciales (máximo 5 revelaciones por minuto).
 */
const verificarLimiteRevelaciones = (identificadorAdmin) => {
    const now = Date.now();
    const clave = String(identificadorAdmin || 'anonimo').toLowerCase();
    const historial = revealHistory.get(clave) || [];

    // Filtrar solicitudes fuera de la ventana de 1 minuto
    const recientes = historial.filter((ts) => now - ts < REVEAL_WINDOW_MS);

    if (recientes.length >= MAX_REVEALS_PER_WINDOW) {
        const err = new Error('Ha superado el límite de 5 consultas de credenciales por minuto. Por seguridad espere un momento.');
        err.code = 'LIMITE_CONSULTAS_EXCEDIDO';
        err.statusCode = 429;
        throw err;
    }

    recientes.push(now);
    revealHistory.set(clave, recientes);
};

module.exports = {
    cifrarPassword,
    descifrarPassword,
    asegurarTablaCustodia,
    guardarEnCustodia,
    eliminarDeCustodia,
    consultarEstadoCustodia,
    obtenerCredencialDescifrada,
    verificarLimiteRevelaciones,
    EXCLUDED_USERNAME
};

