'use strict';

/**
 * Servicio centralizado de política de contraseñas de FAREGAS.
 * Permite configurar la longitud mínima según el entorno (4 en desarrollo/pruebas, 12 en producción)
 * y define advertencias para contraseñas débiles sin bloquear el entorno de pruebas.
 */

const LONGITUD_DEFECTO_PRODUCCION = 12;
const LONGITUD_DEFECTO_DESARROLLO = 4;
const LONGITUD_RECOMENDADA = 8;
const LONGITUD_FUERTE = 12;

const LISTA_TRIVIALES = new Set([
    '123456789012', '1234567890123', 'password1234', 'contrasena123',
    'faregas2026*', 'faregas2026**', 'qwertyuiop12', 'admin1234567'
]);

const esEntornoProduccion = () => {
    const env = String(process.env.APP_DATABASE_ENVIRONMENT || process.env.NODE_ENV || '').toUpperCase();
    return env === 'PRODUCCION' || env === 'PRODUCTION';
};

const resolverMinPasswordLength = (opciones = {}) => {
    if (opciones.minLongitud && typeof opciones.minLongitud === 'number' && opciones.minLongitud >= 1) {
        return opciones.minLongitud;
    }
    const esProd = opciones.esProduccion ?? esEntornoProduccion();
    if (esProd || opciones.esAdmin) {
        return LONGITUD_DEFECTO_PRODUCCION;
    }
    if (process.env.FAREGAS_MIN_PASSWORD_LENGTH) {
        const parsed = parseInt(process.env.FAREGAS_MIN_PASSWORD_LENGTH, 10);
        if (!isNaN(parsed) && parsed >= 1) {
            return parsed;
        }
    }
    return LONGITUD_DEFECTO_DESARROLLO;
};

const obtenerConfiguracionPolitica = (opciones = {}) => {
    const esProd = opciones.esProduccion ?? esEntornoProduccion();
    const minLongitud = resolverMinPasswordLength(opciones);
    const exigirComplejidad = opciones.exigirComplejidad ?? (esProd || Boolean(opciones.esAdmin));

    return {
        minLongitud,
        esProduccion: esProd,
        exigirComplejidad,
        longitudRecomendada: LONGITUD_RECOMENDADA,
        longitudFuerte: LONGITUD_FUERTE
    };
};

const validarPoliticaPassword = (password, username = '', opciones = {}) => {
    const config = obtenerConfiguracionPolitica(opciones);
    const pwd = String(password || '');
    const cleanUsername = String(username || '').trim().toLowerCase();

    // 1. Validación de longitud mínima configurable
    if (pwd.length < config.minLongitud) {
        return {
            valido: false,
            codigo: 'LONGITUD_INSUFICIENTE',
            mensaje: `La nueva contraseña debe tener al menos ${config.minLongitud} caracteres.`,
            esDebil: true,
            minLongitud: config.minLongitud
        };
    }

    // 2. Validación de contraseñas triviales
    if (LISTA_TRIVIALES.has(pwd.toLowerCase())) {
        return {
            valido: false,
            codigo: 'PASSWORD_TRIVIAL',
            mensaje: 'La nueva contraseña es demasiado predecible o trivial. Elija una más segura.',
            esDebil: true,
            minLongitud: config.minLongitud
        };
    }

    // 3. Validación de inclusión de username
    if (cleanUsername && pwd.toLowerCase().includes(cleanUsername)) {
        return {
            valido: false,
            codigo: 'CONTIENE_USERNAME',
            mensaje: 'La nueva contraseña no puede contener el nombre de usuario.',
            esDebil: true,
            minLongitud: config.minLongitud
        };
    }

    // 4. Evaluación de complejidad
    const tieneMayuscula = /[A-Z]/.test(pwd);
    const tieneMinuscula = /[a-z]/.test(pwd);
    const tieneNumeroOSimbolo = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd);
    const tieneComplejidadCompleta = tieneMayuscula && tieneMinuscula && tieneNumeroOSimbolo;
    const esDebil = pwd.length < config.longitudRecomendada || !tieneComplejidadCompleta;

    // En producción o cuentas administrativas se exige complejidad estricta
    if (config.exigirComplejidad) {
        if (!tieneComplejidadCompleta) {
            return {
                valido: false,
                codigo: 'COMPLEJIDAD_INSUFICIENTE',
                mensaje: 'La nueva contraseña debe contener al menos una mayúscula, una minúscula y un número o símbolo.',
                esDebil: true,
                minLongitud: config.minLongitud
            };
        }
    }

    // En desarrollo/pruebas, si la contraseña es débil se acepta pero se emite advertencia visible
    if (esDebil) {
        return {
            valido: true,
            esDebil: true,
            advertencia: `Advertencia de seguridad: Contraseña débil (${pwd.length} caracteres). Se recomienda usar al menos 8 o 12 caracteres con combinación de mayúsculas, minúsculas y números o símbolos.`,
            minLongitud: config.minLongitud
        };
    }

    return {
        valido: true,
        esDebil: false,
        advertencia: null,
        minLongitud: config.minLongitud
    };
};

module.exports = {
    resolverMinPasswordLength,
    obtenerConfiguracionPolitica,
    validarPoliticaPassword,
    LONGITUD_DEFECTO_PRODUCCION,
    LONGITUD_DEFECTO_DESARROLLO,
    LONGITUD_RECOMENDADA,
    LONGITUD_FUERTE
};
