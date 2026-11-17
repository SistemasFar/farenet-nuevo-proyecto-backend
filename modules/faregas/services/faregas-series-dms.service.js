const db = require('../../../config/database');
const configService = require('./faregas-config.service');

const TOTAL_FILAS_DMS = 114;
const EMPRESA_FAREGAS = 'FAREGAS';

// Mapa explícito auditado. No se aplica coincidencia difusa.
const MAPA_LOCAL_PLANTA = Object.freeze({
    'FAREGAS - AREQUIPA': '190',
    'FAREGAS - ARGENTINA': '18',
    'FAREGAS - ATE': '140',
    'FAREGAS - CHORRILLOS': '139',
    'FAREGAS - COLINA': '13',
    'FAREGAS - FAUCETT': '150',
    'FAREGAS - ICA': '25',
    'FAREGAS - INDEPENDENCIA': '201',
    'FAREGAS - JICAMARCA': '43',
    'FAREGAS - LA VICTORIA': '103',
    'FAREGAS - OLGUIN': '200',
    'FAREGAS - PIURA': '61',
    'FAREGAS - RIMAC': '202',
    'FAREGAS - SAN BORJA': '290',
    'FAREGAS - SAN MIGUEL': '102',
    'FAREGAS - SANTA ANITA': '292',
    'FAREGAS - SJL': '138',
    'FAREGAS - SURCO': '98',
    'FAREGAS - SURQUILLO': '160',
    'FAREGAS - TRENEMAN': '133',
    'FAREGAS - TRUJILLO': '180'
});

const CAMPOS_DMS = Object.freeze([
    'Nombre', 'Autogenerada', 'Último Número Generado', 'Activo',
    'Tipo de Documento', 'Número', 'Tipo de Documento de Referencia',
    'Código del Local', 'Nombre del Local', 'Teléfono del Local',
    'Correo del Local', 'Dirección Comercial', 'Serie para POS',
    'Serie de Contingencia'
]);

const texto = (value) => {
    if (value === undefined || value === null) return null;
    const result = String(value).trim();
    return result === '' ? null : result;
};

const codigo = (value, longitud) => {
    const result = texto(value);
    if (result === null) return null;
    return /^\d+$/.test(result) ? result.padStart(longitud, '0') : result;
};

const booleano = (value, campo, fila) => {
    const result = (texto(value) || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (result === 'SI') return true;
    if (result === 'NO') return false;
    throw new Error(`FILA_DMS_${fila}_${campo}_INVALIDO`);
};

const entero = (value, campo, fila) => {
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result < 0) throw new Error(`FILA_DMS_${fila}_${campo}_INVALIDO`);
    return result;
};

const identidadDocumento = (nombre, tipoDocumento, referencia, numero, fila) => {
    const nombreNormalizado = (texto(nombre) || '').toUpperCase();
    const tipo = codigo(tipoDocumento, 2);
    const ref = codigo(referencia, 2);
    const numeroNormalizado = (texto(numero) || '').toUpperCase();
    const opciones = {
        '01:': { nombre: 'FE', tipo: 'FACTURA', patron: /^E([0-9]{2})$/, prefijo: 'F0' },
        '03:': { nombre: 'BE', tipo: 'BOLETA', patron: /^E([0-9]{2})$/, prefijo: 'B0' },
        '07:01': { nombre: 'NCF', tipo: 'NOTA_CREDITO_FACTURA', patron: /^C([0-9]{2})$/, prefijo: 'FC' },
        '07:03': { nombre: 'NCB', tipo: 'NOTA_CREDITO_BOLETA', patron: /^C([0-9]{2})$/, prefijo: 'BC' },
        '08:01': { nombre: 'NDF', tipo: 'NOTA_DEBITO_FACTURA', patron: /^D([0-9]{2})$/, prefijo: 'FD' },
        '08:03': { nombre: 'NDB', tipo: 'NOTA_DEBITO_BOLETA', patron: /^D([0-9]{2})$/, prefijo: 'BD' }
    };
    const opcion = opciones[`${tipo || ''}:${ref || ''}`];
    const coincidencia = opcion && numeroNormalizado.match(opcion.patron);
    if (!opcion || nombreNormalizado !== opcion.nombre || !coincidencia) {
        throw new Error(`FILA_DMS_${fila}_IDENTIDAD_DOCUMENTAL_INVALIDA`);
    }
    return {
        nombre_dms: opcion.nombre,
        tipo_documento: tipo,
        tipo_comprobante: opcion.tipo,
        tipo_documento_referencia: ref,
        numero_dms: numeroNormalizado,
        serie: `${opcion.prefijo}${coincidencia[1]}`
    };
};

const normalizarFila = (origen, indice) => {
    const fila = indice + 4; // el encabezado del DMS está en la fila 3
    const nombreLocal = texto(origen['Nombre del Local']);
    const nombre = texto(origen.Nombre);

    if (nombre === '7 - BE08' && nombreLocal === null) {
        return { fila, estado: 'REVISAR_MANUAL', motivo: 'FILA_SIN_LOCAL_Y_NOMBRE_ANOMALO', origen };
    }
    if (nombreLocal === 'FAREGAS -DASSO') {
        return { fila, estado: 'SEDE_NO_HOMOLOGADA', motivo: 'DASSO_NO_EXISTE_EN_FG_PLANTA', origen };
    }
    const plantaKey = MAPA_LOCAL_PLANTA[nombreLocal];
    if (!plantaKey) {
        return { fila, estado: 'REVISAR_MANUAL', motivo: 'LOCAL_SIN_MAPEO_EXPLICITO', origen };
    }

    let identidad;
    try {
        identidad = identidadDocumento(
            nombre,
            origen['Tipo de Documento'],
            origen['Tipo de Documento de Referencia'],
            origen['Número'],
            fila
        );
    } catch (error) {
        return { fila, estado: 'REVISAR_MANUAL', motivo: error.message, origen };
    }

    try {
        return {
            fila,
            estado: null,
            ...identidad,
            planta_key: plantaKey,
            ultimo_numero_dms: entero(origen['Último Número Generado'], 'ULTIMO_NUMERO', fila),
            autogenerada: booleano(origen.Autogenerada, 'AUTOGENERADA', fila),
            activo: booleano(origen.Activo, 'ACTIVO', fila),
            serie_pos: booleano(origen['Serie para POS'], 'SERIE_POS', fila),
            contingencia: booleano(origen['Serie de Contingencia'], 'CONTINGENCIA', fila),
            codigo_local_dms: codigo(origen['Código del Local'], 4),
            nombre_local_dms: nombreLocal,
            telefono_local_dms: texto(origen['Teléfono del Local']),
            correo_local_dms: texto(origen['Correo del Local']),
            direccion_comercial_dms: texto(origen['Dirección Comercial']),
            origen
        };
    } catch (error) {
        return { fila, estado: 'REVISAR_MANUAL', motivo: error.message, origen };
    }
};

const clave = (row) => `${EMPRESA_FAREGAS}|${row.planta_key}|${row.tipo_comprobante}|${row.serie}|${row.tipo_documento_referencia || ''}`;
const igual = (a, b) => (a ?? null) === (b ?? null);

const analizar = async (filas, queryable = db, { bloquear = false } = {}) => {
    if (!Array.isArray(filas) || filas.length !== TOTAL_FILAS_DMS) {
        throw new Error(`MAESTRO_DMS_DEBE_TENER_${TOTAL_FILAS_DMS}_FILAS`);
    }
    const normalizadas = filas.map(normalizarFila);
    const seguras = normalizadas.filter((row) => row.estado === null);
    const claves = new Set();
    for (const row of seguras) {
        if (claves.has(clave(row))) throw new Error(`DMS_IDENTIDAD_DUPLICADA_${clave(row)}`);
        claves.add(clave(row));
    }

    const plantasEsperadas = [...new Set(seguras.map((row) => row.planta_key))];
    const plantasResult = await queryable.query(
        'SELECT key::text AS key, empresa_key FROM fg_planta WHERE key::text = ANY($1::text[])',
        [plantasEsperadas]
    );
    const empresasPorPlanta = new Map(plantasResult.rows.map((row) => [String(row.key), row.empresa_key]));
    const plantasExistentes = new Set(empresasPorPlanta.keys());
    const plantasFaltantes = plantasEsperadas.filter((plantaKey) => !plantasExistentes.has(plantaKey));
    if (plantasFaltantes.length > 0) {
        throw new Error(`HOMOLOGACION_DMS_PLANTAS_INEXISTENTES_${plantasFaltantes.join('_')}`);
    }

    // Una clave puede existir en FARENET o en otra empresa. Nunca se considera
    // homologada solo porque fg_planta.key coincida con el mapa del DMS.
    for (const row of seguras) {
        const empresaReal = empresasPorPlanta.get(String(row.planta_key));
        if (empresaReal !== EMPRESA_FAREGAS) {
            row.estado = 'SEDE_NO_HOMOLOGADA';
            row.motivo = 'PLANTA_PERTENECE_A_OTRA_EMPRESA';
            row.empresa_real = empresaReal;
        } else {
            row.empresa_key = EMPRESA_FAREGAS;
        }
    }
    const actualesResult = await queryable.query(`
        SELECT s.* FROM fg_serie_comprobante s
        JOIN fg_planta p ON p.key::text = s.planta_key::text
        WHERE COALESCE(s.empresa_key, p.empresa_key) = $1
        ${bloquear ? 'FOR UPDATE OF s' : ''}
    `, [EMPRESA_FAREGAS]);
    const actuales = new Map(actualesResult.rows.map((row) => [clave(row), row]));

    const filasAnalizadas = normalizadas.map((row) => {
        if (row.estado) return row;
        const actual = actuales.get(clave(row));
        if (!actual) return { ...row, estado: 'CREAR', ultimo_numero_faregas: null, ultimo_numero_final: row.ultimo_numero_dms };
        const final = Math.max(Number(actual.ultimo_numero), row.ultimo_numero_dms);
        const campos = [
            'nombre_dms', 'codigo_local_dms', 'nombre_local_dms', 'telefono_local_dms',
            'correo_local_dms', 'direccion_comercial_dms', 'autogenerada', 'activo',
            'tipo_documento_referencia', 'serie_pos', 'contingencia'
        ];
        const diferencias = campos.filter((campo) => !igual(actual[campo], row[campo]));
        if (final !== Number(actual.ultimo_numero)) diferencias.push('ultimo_numero');
        return {
            ...row,
            // La importación solo agrega filas faltantes. Diferencias quedan
            // reportadas para revisión; no se pisan series ya configuradas.
            estado: 'YA_EXISTE',
            diferencias,
            serie_id: Number(actual.id),
            ultimo_numero_faregas: Number(actual.ultimo_numero),
            ultimo_numero_final: Number(actual.ultimo_numero),
            proveedor_emision_actual: actual.proveedor_emision,
            entorno_emision_actual: actual.entorno_emision
        };
    });

    const resumen = Object.fromEntries([
        'CREAR', 'ACTUALIZAR', 'YA_EXISTE', 'SEDE_NO_HOMOLOGADA', 'REVISAR_MANUAL'
    ].map((estado) => [estado, filasAnalizadas.filter((row) => row.estado === estado).length]));
    return { total: filasAnalizadas.length, resumen, filas: filasAnalizadas };
};

const destinoAuditoria = (row) => ({
    planta_key: row.planta_key,
    tipo_comprobante: row.tipo_comprobante,
    serie: row.serie,
    numero_dms: row.numero_dms,
    ultimo_numero: row.ultimo_numero_final,
    autogenerada: row.autogenerada,
    contingencia: row.contingencia,
    activo: row.activo,
    tipo_documento_referencia: row.tipo_documento_referencia,
    serie_pos: row.serie_pos,
    nombre_dms: row.nombre_dms,
    codigo_local_dms: row.codigo_local_dms,
    nombre_local_dms: row.nombre_local_dms,
    telefono_local_dms: row.telefono_local_dms,
    correo_local_dms: row.correo_local_dms,
    direccion_comercial_dms: row.direccion_comercial_dms
});

const aplicar = async (filas, { confirmar, username, ipDireccion }, dependencies = {}) => {
    if (confirmar !== true) throw new Error('HOMOLOGACION_DMS_CONFIRMACION_REQUERIDA');
    const pool = dependencies.db || db;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const antes = await analizar(filas, client, { bloquear: true });
        const pendientes = antes.resumen.SEDE_NO_HOMOLOGADA + antes.resumen.REVISAR_MANUAL;
        if (antes.total !== TOTAL_FILAS_DMS || pendientes !== 0) {
            throw new Error('HOMOLOGACION_DMS_REQUIERE_RESOLVER_HOMOLOGACIONES');
        }

        for (const row of antes.filas.filter((item) => item.estado === 'CREAR')) {
            const insertado = await client.query(`
                INSERT INTO fg_serie_comprobante (
                    planta_key, empresa_key, tipo_comprobante, serie, ultimo_numero,
                    es_predeterminada, autogenerada, contingencia, activo,
                    proveedor_emision, entorno_emision, tipo_documento_referencia, serie_pos,
                    nombre_dms, codigo_local_dms, nombre_local_dms, telefono_local_dms,
                    correo_local_dms, direccion_comercial_dms
                ) VALUES (
                    $1::text, (SELECT empresa_key FROM fg_planta WHERE key::text = $1::text AND empresa_key = $16), $2, $3, $4,
                    FALSE, $5, $6, $7, 'LEGACY', 'PRODUCCION', $8, $9,
                    $10, $11, $12, $13, $14, $15
                ) RETURNING *
            `, [
                row.planta_key, row.tipo_comprobante, row.serie, row.ultimo_numero_final,
                row.autogenerada, row.contingencia, row.activo,
                row.tipo_documento_referencia, row.serie_pos, row.nombre_dms,
                row.codigo_local_dms, row.nombre_local_dms, row.telefono_local_dms,
                row.correo_local_dms, row.direccion_comercial_dms,
                EMPRESA_FAREGAS
            ]);
            if (!insertado.rows[0]) throw new Error('HOMOLOGACION_DMS_PLANTA_NO_ES_FAREGAS');
            await configService.registrarAuditoria(client, {
                username,
                entidad: 'SERIE_COMPROBANTE',
                accion: 'HOMOLOGAR_SERIE_DMS_CREAR',
                identificador: clave(row),
                detalles: { filaDms: row.fila, antes: null, despues: destinoAuditoria(row) },
                planta_key: row.planta_key,
                ip_direccion: ipDireccion
            });
            row.serie_id = Number(insertado.rows[0].id);
        }

        const despues = await analizar(filas, client);
        if (despues.resumen.CREAR !== 0 || despues.resumen.ACTUALIZAR !== 0
            || despues.resumen.YA_EXISTE !== TOTAL_FILAS_DMS) {
            throw new Error('HOMOLOGACION_DMS_VERIFICACION_FINAL_FALLIDA');
        }
        await client.query('COMMIT');
        return { antes, despues };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    previsualizar: (filas, queryable = db) => analizar(filas, queryable),
    aplicar,
    _private: {
        CAMPOS_DMS,
        MAPA_LOCAL_PLANTA,
        TOTAL_FILAS_DMS,
        identidadDocumento,
        normalizarFila,
        analizar,
        clave
    }
};
