const crypto = require('crypto');

const DEFAULT_ALGORITHM = 'aes-256-gcm';
const DEFAULT_KEY_VERSION = 1;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Rate limiting para intentos fallidos de reautenticación MFA/Contraseña
// 5 intentos fallidos por minuto por usuario
const ATTEMPT_WINDOW_MS = 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const failedAttemptsMap = new Map();

/**
 * Obtiene la clave maestra de custodia desde el entorno.
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
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return Buffer.from(trimmed, 'hex');
    }
    return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
};

/**
 * Cifra el secreto TOTP con AES-256-GCM.
 */
const cifrarSecreto = (plaintext) => {
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
 * Descifra el secreto TOTP con AES-256-GCM.
 */
const descifrarSecreto = ({ ciphertext, iv, tag }) => {
    const key = obtenerClaveMaestra();
    const decipher = crypto.createDecipheriv(DEFAULT_ALGORITHM, key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));

    let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
};

/**
 * Codificación Base32 (RFC 4648).
 */
const base32Encode = (buffer) => {
    let bits = 0;
    let value = 0;
    let output = '';
    for (let i = 0; i < buffer.length; i++) {
        value = (value << 8) | buffer[i];
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }
    return output;
};

/**
 * Decodificación Base32 (RFC 4648).
 */
const base32Decode = (base32) => {
    const clean = String(base32 || '').toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (let i = 0; i < clean.length; i++) {
        const idx = BASE32_ALPHABET.indexOf(clean[i]);
        if (idx === -1) {
            throw new Error(`Carácter Base32 no válido: ${clean[i]}`);
        }
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
};

/**
 * Generador HOTP (RFC 4226) - Base para TOTP.
 */
const generarHotp = (secretBuffer, counter) => {
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', secretBuffer);
    hmac.update(buffer);
    const digest = hmac.digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
        ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff);
    const otp = binary % 1000000;
    return String(otp).padStart(6, '0');
};

/**
 * Verifica un código TOTP (RFC 6238) con ventana de tolerancia ±1 paso (±30s) y anti-replay.
 */
const verificarTotp = (secretBase32, token, { window = 1, timestamp = Date.now(), ultimoPasoUsado = null } = {}) => {
    const cleanToken = String(token || '').trim();
    if (!/^\d{6}$/.test(cleanToken)) {
        return { valido: false, motivo: 'FORMATO_INVALIDO' };
    }

    const secretBuffer = base32Decode(secretBase32);
    const stepTime = 30; // 30 segundos
    const currentStep = Math.floor(timestamp / 1000 / stepTime);

    for (let offset = -window; offset <= window; offset++) {
        const step = currentStep + offset;
        if (ultimoPasoUsado !== null && step <= ultimoPasoUsado) {
            // Protección contra ataques de repetición (token replay)
            continue;
        }
        const expectedOtp = generarHotp(secretBuffer, step);
        if (crypto.timingSafeEqual(Buffer.from(expectedOtp), Buffer.from(cleanToken))) {
            return { valido: true, step };
        }
    }

    return { valido: false, motivo: 'CODIGO_INCORRECTO' };
};

/**
 * Genera un conjunto de códigos de recuperación de un solo uso con formato XXXX-XXXX.
 * Almacena el hash SHA-256 + salt de cada uno para protegerlos en reposo.
 */
const generarCodigosRecuperacion = (cantidad = 8) => {
    const codigosPlano = [];
    const codigosHashed = [];

    for (let i = 0; i < cantidad; i++) {
        const rawHex = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 caracteres
        const codigoFormateado = `${rawHex.substring(0, 4)}-${rawHex.substring(4, 8)}`;
        const salt = crypto.randomBytes(8).toString('hex');
        const hash = crypto.createHash('sha256').update(rawHex + salt).digest('hex');

        codigosPlano.push(codigoFormateado);
        codigosHashed.push({
            id: crypto.randomUUID(),
            hash,
            salt,
            usado: false,
            usado_en: null
        });
    }

    return { codigosPlano, codigosHashed };
};

/**
 * Verifica y consume un código de recuperación de un solo uso.
 */
const verificarYConsumirCodigoRecuperacion = (codigosGuardados, codigoIngresado) => {
    const clean = String(codigoIngresado || '').replace(/[\s-]/g, '').toUpperCase();
    if (clean.length !== 8) {
        return { valido: false, motivo: 'FORMATO_CODIGO_RECUPERACION_INVALIDO' };
    }

    if (!Array.isArray(codigosGuardados)) {
        return { valido: false, motivo: 'SIN_CODIGOS_CONFIGURADOS' };
    }

    for (let i = 0; i < codigosGuardados.length; i++) {
        const item = codigosGuardados[i];
        if (item.usado) continue;

        const computedHash = crypto.createHash('sha256').update(clean + item.salt).digest('hex');
        if (computedHash === item.hash) {
            // Marcar como consumido
            item.usado = true;
            item.usado_en = new Date().toISOString();
            const codigosRestantes = codigosGuardados.filter(c => !c.usado).length;
            return {
                valido: true,
                codigosActualizados: codigosGuardados,
                codigosRestantes
            };
        }
    }

    return { valido: false, motivo: 'CODIGO_RECUPERACION_INVALIDO' };
};

/**
 * Rate limiting para reautenticación (máx. 5 intentos fallidos por minuto).
 */
const registrarIntentoFallido = (key) => {
    const now = Date.now();
    const history = failedAttemptsMap.get(key) || [];
    const recent = history.filter(t => now - t < ATTEMPT_WINDOW_MS);
    recent.push(now);
    failedAttemptsMap.set(key, recent);
};

const verificarLimiteIntentos = (key) => {
    const now = Date.now();
    const history = failedAttemptsMap.get(key) || [];
    const recent = history.filter(t => now - t < ATTEMPT_WINDOW_MS);
    failedAttemptsMap.set(key, recent);

    if (recent.length >= MAX_FAILED_ATTEMPTS) {
        const err = new Error('Límite de intentos de autenticación excedido. Por seguridad, intente nuevamente en 1 minuto.');
        err.code = 'LIMITE_INTENTOS_EXCEDIDO';
        err.statusCode = 429;
        throw err;
    }
};

const limpiarIntentosFallidos = (key) => {
    failedAttemptsMap.delete(key);
};

/**
 * Asegura la existencia no destructiva de la tabla fg_usuario_mfa en PostgreSQL.
 */
const asegurarTablaMfa = async (dbClient) => {
    await dbClient.query(`
        CREATE TABLE IF NOT EXISTS public.fg_usuario_mfa (
            username VARCHAR(100) PRIMARY KEY,
            activo BOOLEAN DEFAULT FALSE NOT NULL,
            secreto_cifrado TEXT,
            secreto_iv VARCHAR(64),
            secreto_tag VARCHAR(64),
            codigos_recuperacion JSONB DEFAULT '[]'::jsonb NOT NULL,
            ultimo_paso_usado BIGINT,
            enrolado_en TIMESTAMP WITH TIME ZONE,
            actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
            CONSTRAINT fk_fg_usuario_mfa_user FOREIGN KEY (username) REFERENCES public.fg_usuario(username) ON DELETE CASCADE
        )
    `);
    await dbClient.query(`
        CREATE INDEX IF NOT EXISTS idx_fg_usuario_mfa_username
        ON public.fg_usuario_mfa(LOWER(username))
    `);
};

/**
 * Consulta el estado de MFA para un usuario.
 */
const consultarEstadoMfa = async (db, username) => {
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!cleanUsername) return { activo: false, codigosRestantes: 0 };

    await asegurarTablaMfa(db);
    const res = await db.query(
        'SELECT activo, enrolado_en, codigos_recuperacion FROM public.fg_usuario_mfa WHERE LOWER(username) = $1 LIMIT 1',
        [cleanUsername]
    );

    if (res.rowCount === 0 || !res.rows[0].activo) {
        return {
            activo: false,
            enroladoEn: null,
            codigosRestantes: 0
        };
    }

    const row = res.rows[0];
    const codigos = Array.isArray(row.codigos_recuperacion) ? row.codigos_recuperacion : [];
    const codigosRestantes = codigos.filter(c => !c.usado).length;

    return {
        activo: true,
        enroladoEn: row.enrolado_en,
        codigosRestantes
    };
};

/**
 * Inicia el proceso de inscripción (enrolamiento) TOTP para un administrador.
 * Genera el secreto aleatorio, los códigos de respaldo y la URL otpauth://.
 * El estado se guarda inicialmente con activo = FALSE hasta que confirme el primer código.
 */
const iniciarConfiguracionMfa = async (db, username) => {
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!cleanUsername) throw new Error('Username requerido.');

    await asegurarTablaMfa(db);

    const secretBuffer = crypto.randomBytes(20);
    const secretBase32 = base32Encode(secretBuffer);
    const { codigosPlano, codigosHashed } = generarCodigosRecuperacion(8);

    const cifrado = cifrarSecreto(secretBase32);

    await db.query(`
        INSERT INTO public.fg_usuario_mfa (
            username, activo, secreto_cifrado, secreto_iv, secreto_tag,
            codigos_recuperacion, ultimo_paso_usado, enrolado_en, actualizado_en
        ) VALUES (
            $1, FALSE, $2, $3, $4, $5, NULL, NULL, CURRENT_TIMESTAMP
        )
        ON CONFLICT (username) DO UPDATE SET
            activo = FALSE,
            secreto_cifrado = EXCLUDED.secreto_cifrado,
            secreto_iv = EXCLUDED.secreto_iv,
            secreto_tag = EXCLUDED.secreto_tag,
            codigos_recuperacion = EXCLUDED.codigos_recuperacion,
            ultimo_paso_usado = NULL,
            enrolado_en = NULL,
            actualizado_en = CURRENT_TIMESTAMP
    `, [cleanUsername, cifrado.ciphertext, cifrado.iv, cifrado.tag, JSON.stringify(codigosHashed)]);

    const otpauthUrl = `otpauth://totp/FAREGAS:${encodeURIComponent(username)}?secret=${secretBase32}&issuer=FAREGAS&algorithm=SHA1&digits=6&period=30`;

    return {
        username: cleanUsername,
        secret: secretBase32,
        otpauthUrl,
        codigosRecuperacion: codigosPlano
    };
};

/**
 * Confirma la inscripción TOTP verificando el primer código 6 dígitos.
 * Si es válido, activa el MFA para el usuario.
 */
const confirmarConfiguracionMfa = async (db, username, codigoTotp) => {
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!cleanUsername) throw new Error('Username requerido.');

    await asegurarTablaMfa(db);
    const res = await db.query(
        'SELECT secreto_cifrado, secreto_iv, secreto_tag FROM public.fg_usuario_mfa WHERE LOWER(username) = $1 LIMIT 1',
        [cleanUsername]
    );

    if (res.rowCount === 0 || !res.rows[0].secreto_cifrado) {
        throw new Error('No hay una configuración de MFA pendiente para este usuario.');
    }

    const { secreto_cifrado, secreto_iv, secreto_tag } = res.rows[0];
    const secretBase32 = descifrarSecreto({
        ciphertext: secreto_cifrado,
        iv: secreto_iv,
        tag: secreto_tag
    });

    const resultado = verificarTotp(secretBase32, codigoTotp);
    if (!resultado.valido) {
        throw new Error('El código de verificación es incorrecto o ha expirado. Compruebe la hora de su dispositivo e intente nuevamente.');
    }

    await db.query(`
        UPDATE public.fg_usuario_mfa
        SET activo = TRUE,
            ultimo_paso_usado = $1,
            enrolado_en = CURRENT_TIMESTAMP,
            actualizado_en = CURRENT_TIMESTAMP
        WHERE LOWER(username) = $2
    `, [resultado.step, cleanUsername]);

    return {
        success: true,
        mensaje: 'Autenticación en dos pasos (TOTP) configurada y activada exitosamente.'
    };
};

/**
 * Desactiva el MFA de un usuario previa reautenticación obligatoria.
 */
const desactivarMfa = async (db, username) => {
    const cleanUsername = String(username || '').trim().toLowerCase();
    await asegurarTablaMfa(db);

    await db.query(`
        UPDATE public.fg_usuario_mfa
        SET activo = FALSE,
            secreto_cifrado = NULL,
            secreto_iv = NULL,
            secreto_tag = NULL,
            codigos_recuperacion = '[]'::jsonb,
            ultimo_paso_usado = NULL,
            enrolado_en = NULL,
            actualizado_en = CURRENT_TIMESTAMP
        WHERE LOWER(username) = $1
    `, [cleanUsername]);

    return { success: true, mensaje: 'MFA desactivado correctamente.' };
};

/**
 * Procedimiento de recuperación de emergencia administrativo (Tier 2).
 * Si el administrador perdió su contraseña, teléfono y códigos de respaldo,
 * un superadministrador autorizado (ej. gibarra) puede resetear el MFA para permitir re-enrolamiento.
 */
const resetMfaAdmin = async (db, targetUsername, { autorizadoPor, motivo }) => {
    const cleanTarget = String(targetUsername || '').trim().toLowerCase();
    if (!cleanTarget) throw new Error('Target username requerido.');
    if (!motivo || typeof motivo !== 'string' || motivo.trim().length < 5) {
        throw new Error('Debe especificar un motivo válido de recuperación administrativa.');
    }

    await desactivarMfa(db, cleanTarget);

    return {
        success: true,
        mensaje: `MFA reseteado administrativamente para ${cleanTarget}. Podrá iniciar sesión y re-enrolarse.`
    };
};

/**
 * Verificación unificada de autorización de paso (Step-up Auth) para revelación de credenciales.
 * Admite:
 * 1. Contraseña del administrador (`passwordAdmin`).
 * 2. Código TOTP de 6 dígitos (`codigoTotp`).
 * 3. Código de recuperación único (`codigoRecuperacion`).
 * Aplica rate limiting estricto anti-fuerza bruta.
 */
const verificarPasoAutorizacion = async (db, adminUsername, { passwordAdmin, codigoTotp, codigoRecuperacion }, authService) => {
    const cleanAdmin = String(adminUsername || '').trim().toLowerCase();
    if (!cleanAdmin) {
        throw new Error('Identificador de administrador de sesión no disponible.');
    }

    // 1. Rate limiting contra ataques de fuerza bruta
    verificarLimiteIntentos(cleanAdmin);

    // OPCIÓN A: Reautenticación por Contraseña
    if (passwordAdmin && typeof passwordAdmin === 'string') {
        const authValido = await authService.validarFaregas(cleanAdmin, passwordAdmin);
        if (!authValido?.valido) {
            registrarIntentoFallido(cleanAdmin);
            return {
                valido: false,
                metodo: 'PASSWORD',
                motivo: 'Contraseña de administrador incorrecta. No se puede autorizar la revelación.'
            };
        }
        limpiarIntentosFallidos(cleanAdmin);
        return {
            valido: true,
            metodo: 'PASSWORD'
        };
    }

    // OPCIÓN B: Verificación por Código TOTP (6 dígitos)
    if (codigoTotp && typeof codigoTotp === 'string') {
        const cleanTotp = codigoTotp.trim();
        await asegurarTablaMfa(db);

        const res = await db.query(
            'SELECT activo, secreto_cifrado, secreto_iv, secreto_tag, ultimo_paso_usado FROM public.fg_usuario_mfa WHERE LOWER(username) = $1 LIMIT 1',
            [cleanAdmin]
        );

        if (res.rowCount === 0 || !res.rows[0].activo || !res.rows[0].secreto_cifrado) {
            return {
                valido: false,
                metodo: 'TOTP',
                motivo: 'El usuario administrador no tiene configurado un segundo factor TOTP activo. Utilice su contraseña o configure su autenticador.'
            };
        }

        const row = res.rows[0];
        const secretBase32 = descifrarSecreto({
            ciphertext: row.secreto_cifrado,
            iv: row.secreto_iv,
            tag: row.secreto_tag
        });

        const verif = verificarTotp(secretBase32, cleanTotp, {
            ultimoPasoUsado: row.ultimo_paso_usado ? BigInt(row.ultimo_paso_usado) : null
        });

        if (!verif.valido) {
            registrarIntentoFallido(cleanAdmin);
            return {
                valido: false,
                metodo: 'TOTP',
                motivo: 'Código de autenticación (TOTP) incorrecto o expirado. Verifique su aplicación autenticadora.'
            };
        }

        // Registrar paso usado contra repeticiones
        await db.query(
            'UPDATE public.fg_usuario_mfa SET ultimo_paso_usado = $1, actualizado_en = CURRENT_TIMESTAMP WHERE LOWER(username) = $2',
            [verif.step, cleanAdmin]
        );

        limpiarIntentosFallidos(cleanAdmin);
        return {
            valido: true,
            metodo: 'TOTP'
        };
    }

    // OPCIÓN C: Verificación por Código de Recuperación (un solo uso)
    if (codigoRecuperacion && typeof codigoRecuperacion === 'string') {
        await asegurarTablaMfa(db);
        const res = await db.query(
            'SELECT activo, codigos_recuperacion FROM public.fg_usuario_mfa WHERE LOWER(username) = $1 LIMIT 1',
            [cleanAdmin]
        );

        if (res.rowCount === 0 || !res.rows[0].activo) {
            return {
                valido: false,
                metodo: 'CODIGO_RECUPERACION',
                motivo: 'El usuario administrador no tiene códigos de recuperación activos.'
            };
        }

        const codigos = Array.isArray(res.rows[0].codigos_recuperacion) ? res.rows[0].codigos_recuperacion : [];
        const verifRec = verificarYConsumirCodigoRecuperacion(codigos, codigoRecuperacion);

        if (!verifRec.valido) {
            registrarIntentoFallido(cleanAdmin);
            return {
                valido: false,
                metodo: 'CODIGO_RECUPERACION',
                motivo: 'Código de recuperación inválido o ya utilizado anteriormente.'
            };
        }

        // Persistir la lista actualizada de códigos con el código consumido
        await db.query(
            'UPDATE public.fg_usuario_mfa SET codigos_recuperacion = $1, actualizado_en = CURRENT_TIMESTAMP WHERE LOWER(username) = $2',
            [JSON.stringify(verifRec.codigosActualizados), cleanAdmin]
        );

        limpiarIntentosFallidos(cleanAdmin);
        return {
            valido: true,
            metodo: 'CODIGO_RECUPERACION',
            codigosRestantes: verifRec.codigosRestantes
        };
    }

    return {
        valido: false,
        motivo: 'Debe proporcionar una credencial de autorización válida (contraseña, código TOTP o código de recuperación).'
    };
};

module.exports = {
    base32Encode,
    base32Decode,
    generarHotp,
    verificarTotp,
    generarCodigosRecuperacion,
    verificarYConsumirCodigoRecuperacion,
    cifrarSecreto,
    descifrarSecreto,
    asegurarTablaMfa,
    consultarEstadoMfa,
    iniciarConfiguracionMfa,
    confirmarConfiguracionMfa,
    desactivarMfa,
    resetMfaAdmin,
    verificarPasoAutorizacion,
    limpiarIntentosFallidos
};

