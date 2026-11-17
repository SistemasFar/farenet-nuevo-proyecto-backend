const db = require('../../../config/database');
const integrationsConfig = require('../../../config/integrations.config');
const { validarCorrelativoDisponible } = require('./faregas-nubefact-correlativo-guard.service');

const TIPOS_PERMITIDOS = new Set([
    'FACTURA',
    'BOLETA',
    'NOTA_CREDITO_FACTURA',
    'NOTA_CREDITO_BOLETA',
    'NOTA_DEBITO_FACTURA',
    'NOTA_DEBITO_BOLETA'
]);

const errorCorrelativo = (code, detalles) => {
    const error = new Error(code);
    error.code = code;
    error.statusCode = 409;
    if (detalles) error.detalles = detalles;
    return error;
};

const esProduccion = (environment = integrationsConfig.nubefact.environment) => (
    ['PRODUCCION', 'PRODUCTION'].includes(String(environment || '').trim().toUpperCase())
);

const normalizarEntorno = (environment = integrationsConfig.nubefact.environment) => {
    const value = String(environment || '').trim().toUpperCase();
    if (value === 'PRODUCTION') return 'PRODUCCION';
    if (value === 'DEMO' || value === 'PRODUCCION') return value;
    throw errorCorrelativo('ENTORNO_NUBEFACT_INVALIDO');
};

const validarTipo = (tipoComprobante) => {
    const tipo = String(tipoComprobante || '').trim().toUpperCase();
    if (!TIPOS_PERMITIDOS.has(tipo)) throw errorCorrelativo('TIPO_COMPROBANTE_NO_SOPORTADO');
    return tipo;
};

const validarSerieTributaria = (serie, tipoComprobante) => {
    const valor = String(serie || '').trim().toUpperCase();
    const prefijo = tipoComprobante === 'FACTURA' || tipoComprobante.endsWith('_FACTURA') ? 'F' : 'B';
    return /^[A-Z0-9]{4}$/.test(valor) && valor.startsWith(prefijo);
};

const mapSerie = (row) => ({
    id: Number(row.id),
    plantaKey: row.planta_key,
    empresaKey: row.empresa_key_resolved || row.empresa_key,
    tipoComprobante: row.tipo_comprobante,
    serie: String(row.serie || '').trim().toUpperCase(),
    ultimoNumero: Number(row.ultimo_numero),
    autogenerada: row.autogenerada,
    proveedorEmision: row.proveedor_emision,
    entornoEmision: row.entorno_emision,
    confirmadaProduccion: row.confirmada_produccion,
    numeroInicialConfirmado: row.numero_inicial_confirmado === null
        ? null
        : Number(row.numero_inicial_confirmado),
    sistemaOrigen: row.sistema_origen || null,
    fechaCorte: row.fecha_corte || null
});

const consultarSerie = async ({ plantaKey, tipoComprobante, environment, empresaKey = null, bloquear = false }, executor = db) => {
    const tipo = validarTipo(tipoComprobante);
    const entorno = normalizarEntorno(environment);
    const empresaEmisora = String(empresaKey || '').trim();
    if (!empresaEmisora) throw errorCorrelativo('EMPRESA_EMISORA_SERIE_REQUERIDA');

    // DEMO pertenece a la cuenta emisora efectiva: todas las sedes que usan el
    // mismo alias comparten una única fila y un único contador. PRODUCCION se
    // mantiene deliberadamente acotada a la planta propietaria.
    const demo = entorno === 'DEMO';
    const valores = demo
        ? [tipo, entorno, empresaEmisora]
        : [plantaKey, tipo, entorno, empresaEmisora];
    const alcance = demo
        ? 'COALESCE(s.empresa_key, p.empresa_key) = $3'
        : 's.planta_key = $1 AND COALESCE(s.empresa_key, p.empresa_key) = $4';
    let result;
    try {
        result = await executor.query(`
            SELECT s.*, COALESCE(s.empresa_key, p.empresa_key) AS empresa_key_resolved
            FROM fg_serie_comprobante s
            JOIN fg_planta p ON p.key = s.planta_key
            WHERE ${alcance}
              AND s.tipo_comprobante = $${demo ? 1 : 2}
              AND s.proveedor_emision = 'NUBEFACT'
              AND s.entorno_emision = $${demo ? 2 : 3}
              AND s.activo = TRUE
              AND s.es_predeterminada = TRUE
              AND p.activo = TRUE
            ORDER BY s.id
            LIMIT 2${bloquear ? ' FOR UPDATE OF s' : ''}
        `, valores);
    } catch (error) {
        if (error.code === '42703') throw errorCorrelativo('MIGRACION_NUBEFACT_PENDIENTE');
        throw error;
    }
    if (result.rowCount === 0) throw errorCorrelativo('SERIE_COMPROBANTE_NO_CONFIGURADA');
    if (result.rowCount !== 1) {
        throw errorCorrelativo('SERIE_COMPROBANTE_AMBIGUA', {
            plantaKey,
            empresaKey: empresaEmisora,
            tipoComprobante: tipo,
            environment: entorno
        });
    }
    return mapSerie(result.rows[0]);
};

const validarSerieOperativa = (serie, environment) => {
    const entorno = normalizarEntorno(environment);
    if (serie.proveedorEmision !== 'NUBEFACT' || serie.entornoEmision !== entorno) {
        throw errorCorrelativo('SERIE_NUBEFACT_NO_EXCLUSIVA');
    }
    if (!serie.autogenerada) throw errorCorrelativo('SERIE_NO_AUTOGENERADA');
    if (!validarSerieTributaria(serie.serie, serie.tipoComprobante)) {
        throw errorCorrelativo('SERIE_COMPROBANTE_INVALIDA');
    }
    if (esProduccion(environment) && !serie.confirmadaProduccion) {
        throw errorCorrelativo('SERIE_PRODUCCION_NO_CONFIRMADA', {
            plantaKey: serie.plantaKey,
            tipoComprobante: serie.tipoComprobante,
            serie: serie.serie
        });
    }
};

exports.obtenerSeriePrevista = async ({ plantaKey, tipoComprobante, environment, empresaKey = null }, executor = db) => {
    const entorno = normalizarEntorno(environment);
    const serie = await consultarSerie({ plantaKey, tipoComprobante, environment: entorno, empresaKey }, executor);
    validarSerieOperativa(serie, entorno);
    return serie;
};

exports.reservarSiguiente = async ({ plantaKey, tipoComprobante, environment, empresaKey = null }, executor = db) => {
    const entorno = normalizarEntorno(environment);
    const serie = await consultarSerie({ plantaKey, tipoComprobante, environment: entorno, empresaKey, bloquear: true }, executor);
    validarSerieOperativa(serie, entorno);
    const numero = serie.ultimoNumero + 1;
    if (!Number.isSafeInteger(numero) || numero <= 0) {
        throw errorCorrelativo('CORRELATIVO_COMPROBANTE_INVALIDO');
    }

    const actualizado = await executor.query(`
        UPDATE fg_serie_comprobante
        SET ultimo_numero = $1,
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE id = $2 AND ultimo_numero = $3
        RETURNING id
    `, [numero, serie.id, serie.ultimoNumero]);
    if (actualizado.rowCount !== 1) throw errorCorrelativo('CORRELATIVO_CONCURRENCIA');

    return {
        ...serie,
        numero,
        nroComprobante: `${serie.serie}-${String(numero).padStart(8, '0')}`
    };
};

exports.reservarSiguienteDisponible = async ({
    plantaKey,
    tipoComprobante,
    environment,
    empresaKey = null,
    provider,
    credentials,
    maxCandidatos = 5
}, executor = db) => {
    const entorno = normalizarEntorno(environment);
    const tipo = validarTipo(tipoComprobante);
    if (!['FACTURA', 'BOLETA'].includes(tipo)) {
        throw errorCorrelativo('TIPO_COMPROBANTE_NO_SOPORTADO_PARA_BUSQUEDA_SEGURA');
    }
    const limite = Math.max(1, Math.min(10, Number.parseInt(maxCandidatos, 10) || 5));
    const serie = await consultarSerie({
        plantaKey,
        tipoComprobante: tipo,
        environment: entorno,
        empresaKey,
        bloquear: true
    }, executor);
    validarSerieOperativa(serie, entorno);

    for (let intento = 1; intento <= limite; intento += 1) {
        const numero = serie.ultimoNumero + intento;
        if (!Number.isSafeInteger(numero) || numero <= 0) {
            throw errorCorrelativo('CORRELATIVO_COMPROBANTE_INVALIDO');
        }

        // Si el contador está por detrás de una reserva local, no se salta sin
        // investigar: puede existir una emisión o intento pendiente de esta sede.
        const local = await executor.query(`
            SELECT id, estado
              FROM fg_facturacion
             WHERE numero = $2
               AND (
                    serie_comprobante_id = $1
                    OR (serie = $3 AND empresa_key = $4 AND entorno_facturador = $5)
               )
             LIMIT 1
        `, [serie.id, numero, serie.serie, serie.empresaKey, entorno]);
        if (local.rowCount > 0) {
            throw errorCorrelativo('CORRELATIVO_RESERVADO_LOCALMENTE', {
                serie: serie.serie,
                numero,
                facturacionId: Number(local.rows[0].id),
                estado: local.rows[0].estado
            });
        }

        try {
            await validarCorrelativoDisponible(provider, {
                tipoComprobante: tipo,
                serie: serie.serie,
                numero,
                credentials
            });
        } catch (error) {
            if (error.code !== 'NUBEFACT_CORRELATIVO_OCUPADO') throw error;
            if (intento === limite) break;
            continue;
        }

        const actualizado = await executor.query(`
            UPDATE fg_serie_comprobante
               SET ultimo_numero = $1,
                   fecha_modificacion = CURRENT_TIMESTAMP
             WHERE id = $2 AND ultimo_numero = $3
             RETURNING id
        `, [numero, serie.id, serie.ultimoNumero]);
        if (actualizado.rowCount !== 1) throw errorCorrelativo('CORRELATIVO_CONCURRENCIA');

        return {
            ...serie,
            numero,
            nroComprobante: `${serie.serie}-${String(numero).padStart(8, '0')}`,
            disponibleEnNubefact: true,
            candidatosOcupados: intento - 1
        };
    }

    throw errorCorrelativo('NUBEFACT_SIN_CORRELATIVO_DISPONIBLE', {
        serie: serie.serie,
        ultimoNumero: serie.ultimoNumero,
        candidatosConsultados: limite
    });
};

exports._private = {
    TIPOS_PERMITIDOS,
    consultarSerie,
    validarSerieOperativa,
    esProduccion,
    mapSerie,
    validarSerieTributaria,
    normalizarEntorno,
    errorCorrelativo,
    consultarSerie
};
