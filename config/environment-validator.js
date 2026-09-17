function normalizeBoolean(val) {
    if (typeof val === 'string') return val.trim().toLowerCase() === 'true';
    return Boolean(val);
}

function validateEnvironment() {
    const dbEnv = (process.env.APP_DATABASE_ENVIRONMENT || '').trim().toUpperCase();
    const nfEnv = (process.env.NUBEFACT_ENVIRONMENT || '').trim().toUpperCase();

    if (dbEnv === 'DEMO') {
        if (!nfEnv) {
            throw new Error(`FAIL-CLOSED: APP_DATABASE_ENVIRONMENT es DEMO pero NUBEFACT_ENVIRONMENT está vacío.`);
        }
        const dbName = (process.env.DB_NAME || '').trim();
        if (dbName === 'inspeccion') {
            throw new Error(`FAIL-CLOSED: APP_DATABASE_ENVIRONMENT es DEMO pero DB_NAME apunta a la base de producción (inspeccion).`);
        }
        if (dbName !== 'farenet_demo') {
            throw new Error(`FAIL-CLOSED: APP_DATABASE_ENVIRONMENT es DEMO pero DB_NAME no es 'farenet_demo' (actual: '${dbName}').`);
        }
    }

    if (nfEnv === 'DEMO' && !dbEnv) {
        throw new Error(`FAIL-CLOSED: NUBEFACT_ENVIRONMENT es DEMO pero APP_DATABASE_ENVIRONMENT está vacío.`);
    }

    if (dbEnv && nfEnv) {
        if (dbEnv === 'DESARROLLO' && nfEnv === 'DEMO') {
            // PERMITIDO
        } else if (dbEnv === 'DEMO' && nfEnv === 'DEMO') {
            // PERMITIDO
        } else if (dbEnv === 'PRODUCCION' && nfEnv === 'PRODUCCION') {
            // PERMITIDO
        } else {
            throw new Error(`FAIL-CLOSED: Combinación de ambientes no permitida. BD='${dbEnv}', NubeFact='${nfEnv}'.`);
        }
    }

    const nfEnabled = normalizeBoolean(process.env.NUBEFACT_ENABLED);
    if (nfEnabled && !dbEnv) {
        throw new Error(`FAIL-CLOSED: NUBEFACT_ENABLED=true pero falta APP_DATABASE_ENVIRONMENT.`);
    }

    if (dbEnv === 'DEMO' || nfEnv === 'DEMO') {
        if (normalizeBoolean(process.env.NUBEFACT_ALLOW_GLOBAL_FALLBACK)) {
            throw new Error('FAIL-CLOSED: No se permite NUBEFACT_ALLOW_GLOBAL_FALLBACK=true en DEMO.');
        }
        if (normalizeBoolean(process.env.NUBEFACT_ALLOW_LEGACY_CREDENTIAL_KEYS)) {
            throw new Error('FAIL-CLOSED: No se permite NUBEFACT_ALLOW_LEGACY_CREDENTIAL_KEYS=true en DEMO.');
        }
        if (normalizeBoolean(process.env.NUBEFACT_SIMULATION_ENABLED)) {
            throw new Error('FAIL-CLOSED: No se permite simular NubeFact (NUBEFACT_SIMULATION_ENABLED=true) en el ambiente DEMO real.');
        }
        if (!nfEnabled) {
            throw new Error('FAIL-CLOSED: NUBEFACT_ENABLED debe ser true en DEMO.');
        }
        if (!normalizeBoolean(process.env.NUBEFACT_ENVIAR_SUNAT)) {
            throw new Error('FAIL-CLOSED: NUBEFACT_ENVIAR_SUNAT debe ser true en DEMO.');
        }

        const requiredVars = ['DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD', 'DB_PORT', 'PORT'];
        for (const v of requiredVars) {
            if (!process.env[v] || process.env[v].trim() === '') {
                throw new Error(`FAIL-CLOSED: Variable de entorno obligatoria '${v}' ausente en el ambiente DEMO.`);
            }
        }
    }
}

module.exports = { validateEnvironment };
