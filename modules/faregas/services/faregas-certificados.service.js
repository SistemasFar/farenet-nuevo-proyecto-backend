const { faregasFormatosService: formatosService } = require('./faregas-formatos.service');
const db = require('../../../config/database');
const integrationsConfig = require('../../../config/integrations.config');
const { paraPlantilla } = require('../mappers/faregas-vehiculo.mapper');
const tarifasService = require('./faregas-tarifas.service');
const chipCertificadoService = require('./faregas-chip-certificado.service');
const { normalizarNumeroChip, esNumeroChipCertificadoValido } = require('./faregas-chips.rules');
const { extraerVariablesHtml } = require('./faregas-formatos-html');
const { obtenerCatalogoVariables } = require('./faregas-formatos.variables');

const VARIABLES_FORMATO_AUTOMATICAS = new Set([
    'certificado.numero',
    'certificado.fecha_emision',
    'certificado.modalidad',
    'certificado.titulo'
]);

const CLAVE_VARIABLE_FORMATO = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

const configuracionFormato = (value) => {
    if (!value) return {};
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch (_error) { return {}; }
    }
    return typeof value === 'object' && !Array.isArray(value) ? value : {};
};

const valorAnidado = (objeto, clave) => String(clave || '').split('.')
    .reduce((actual, parte) => (actual == null ? undefined : actual[parte]), objeto);

const asignarValorAnidado = (objeto, clave, valor) => {
    const partes = String(clave || '').split('.');
    let actual = objeto;
    partes.forEach((parte, index) => {
        if (index === partes.length - 1) actual[parte] = valor;
        else {
            if (!actual[parte] || typeof actual[parte] !== 'object' || Array.isArray(actual[parte])) actual[parte] = {};
            actual = actual[parte];
        }
    });
};

const combinarObjetos = (base, adicional) => {
    const resultado = { ...(base || {}) };
    Object.entries(adicional || {}).forEach(([clave, valor]) => {
        if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
            resultado[clave] = combinarObjetos(resultado[clave], valor);
        } else {
            resultado[clave] = valor;
        }
    });
    return resultado;
};

const TIPOS_CORRELATIVO = Object.freeze({
    GNV_INICIAL: { tipoBase: 'GNV_ANUAL', modalidad: 'INICIAL' },
    GNV_ANUAL: { tipoBase: 'GNV_ANUAL', modalidad: 'ANUAL' },
    GLP_INICIAL: { tipoBase: 'GLP_ANUAL', modalidad: 'INICIAL' },
    GLP_ANUAL: { tipoBase: 'GLP_ANUAL', modalidad: 'ANUAL' },
    CONFORMIDAD: { tipoBase: 'CONFORMIDAD', modalidad: 'UNICA' }
});

const resolverTipoCorrelativo = (clave) => TIPOS_CORRELATIVO[String(clave || '').trim().toUpperCase()] || null;

exports.obtenerTiposActivos = async () => {
    const res = await db.query(`
        SELECT DISTINCT
            CASE
                WHEN t.clave = 'CONFORMIDAD' THEN 'CONFORMIDAD'
                ELSE split_part(t.clave, '_', 1) || '_' || s.modalidad
            END AS clave,
            t.clave AS "tipoBase",
            CASE WHEN t.clave = 'CONFORMIDAD' THEN 'UNICA' ELSE s.modalidad END AS modalidad,
            t.codigo,
            CASE
                WHEN t.clave = 'CONFORMIDAD' THEN 'Conformidad'
                ELSE split_part(t.clave, '_', 1) || ' ' || initcap(lower(s.modalidad))
            END AS nombre
        FROM fg_servicio s
        JOIN fg_tipo_certificado t ON t.clave = s.tipo_certificado_clave
        WHERE t.activo = TRUE
          AND s.activo = TRUE
          AND s.requiere_certificado = TRUE
          AND (t.clave = 'CONFORMIDAD' OR s.modalidad IN ('INICIAL', 'ANUAL'))
        ORDER BY codigo, clave
    `);
    return res.rows;
};

exports.obtenerCorrelativos = async (filters) => {
    let q = `
        WITH active_services AS (
            SELECT 
                ta.planta_key,
                t.clave AS tipo_base,
                CASE WHEN t.clave = 'CONFORMIDAD' THEN 'UNICA' ELSE s.modalidad END AS modalidad,
                json_agg(json_build_object(
                    'servicioId', s.id,
                    'codigo', s.codigo,
                    'nombre', s.nombre,
                    'formatoId', s.formato_id
                ) ORDER BY s.codigo) AS operaciones
            FROM fg_servicio s
            JOIN fg_tarifa ta ON ta.servicio_id = s.id
            JOIN fg_tipo_certificado t ON t.clave = s.tipo_certificado_clave
            WHERE s.activo = TRUE 
              AND s.requiere_certificado = TRUE 
              AND ta.activo = TRUE 
            GROUP BY ta.planta_key, t.clave, CASE WHEN t.clave = 'CONFORMIDAD' THEN 'UNICA' ELSE s.modalidad END
        ),
        required_combinations AS (
            SELECT
                a.planta_key,
                p.nombre AS planta_nombre,
                a.tipo_base,
                t.codigo AS tipo_codigo,
                a.modalidad,
                CASE WHEN a.tipo_base = 'CONFORMIDAD' THEN 'CONFORMIDAD' ELSE split_part(a.tipo_base, '_', 1) || '_' || a.modalidad END AS tipo_clave,
                CASE WHEN a.tipo_base = 'CONFORMIDAD' THEN 'Conformidad' ELSE split_part(a.tipo_base, '_', 1) || ' ' || initcap(lower(a.modalidad)) END AS tipo_nombre,
                a.operaciones
            FROM active_services a
            JOIN fg_planta p ON p.key = a.planta_key
            JOIN fg_tipo_certificado t ON t.clave = a.tipo_base
            WHERE p.activo = TRUE
        ),
        existing_ranges AS (
            SELECT c.id, c.planta_key,
                   CASE WHEN c.tipo_certificado_clave = 'CONFORMIDAD' THEN 'CONFORMIDAD' ELSE split_part(c.tipo_certificado_clave, '_', 1) || '_' || c.modalidad END AS tipo_clave,
                   c.tipo_certificado_clave, c.modalidad,
                   c.nro_inicio, c.nro_actual, c.nro_maximo,
                   c.activo, (c.nro_maximo - c.nro_actual) AS disponibles,
                   (c.nro_actual >= c.nro_maximo) AS agotado,
                   c.fecha_asignacion, c.fecha_cierre
            FROM fg_correlativo_certificado c
        ),
        final_results AS (
            SELECT 
                er.id,
                req.planta_key AS "plantaKey",
                req.planta_nombre AS "plantaNombre",
                req.tipo_clave AS "tipoClave",
                req.tipo_base AS "tipoBase",
                req.modalidad,
                req.tipo_codigo AS "tipoCodigo",
                req.tipo_nombre AS "tipoNombre",
                er.nro_inicio AS "nroInicio",
                er.nro_actual AS "nroActual",
                er.nro_maximo AS "nroMaximo",
                COALESCE(er.activo, FALSE) AS activo,
                COALESCE(er.disponibles, 0) AS disponibles,
                COALESCE(er.agotado, FALSE) AS agotado,
                er.fecha_asignacion AS "fechaAsignacion",
                er.fecha_cierre AS "fechaCierre",
                CASE WHEN er.id IS NULL THEN true ELSE false END AS "sinRango",
                req.operaciones AS "operacionesAsociadas"
            FROM required_combinations req
            LEFT JOIN existing_ranges er 
                ON er.planta_key = req.planta_key 
                AND er.tipo_certificado_clave = req.tipo_base 
                AND er.modalidad = req.modalidad
                AND er.activo = TRUE
            
            UNION ALL
            
            SELECT 
                c.id, c.planta_key AS "plantaKey", p.nombre AS "plantaNombre",
                CASE WHEN c.tipo_certificado_clave = 'CONFORMIDAD' THEN 'CONFORMIDAD' ELSE split_part(c.tipo_certificado_clave, '_', 1) || '_' || c.modalidad END AS "tipoClave",
                c.tipo_certificado_clave AS "tipoBase", c.modalidad,
                t.codigo AS "tipoCodigo",
                CASE WHEN c.tipo_certificado_clave = 'CONFORMIDAD' THEN 'Conformidad' ELSE split_part(c.tipo_certificado_clave, '_', 1) || ' ' || initcap(lower(c.modalidad)) END AS "tipoNombre",
                c.nro_inicio AS "nroInicio", c.nro_actual AS "nroActual", c.nro_maximo AS "nroMaximo",
                c.activo, (c.nro_maximo - c.nro_actual) AS disponibles,
                (c.nro_actual >= c.nro_maximo) AS agotado,
                c.fecha_asignacion AS "fechaAsignacion", c.fecha_cierre AS "fechaCierre",
                false AS "sinRango",
                COALESCE(a.operaciones, '[]'::json) AS "operacionesAsociadas"
            FROM fg_correlativo_certificado c
            JOIN fg_planta p ON p.key = c.planta_key
            JOIN fg_tipo_certificado t ON t.clave = c.tipo_certificado_clave
            LEFT JOIN active_services a 
                ON a.planta_key = c.planta_key 
                AND a.tipo_base = c.tipo_certificado_clave 
                AND a.modalidad = c.modalidad
            WHERE c.activo = FALSE
        )
        SELECT * FROM final_results
        WHERE 1=1
    `;
    const params = [];
    if (filters.plantaKey) {
        params.push(filters.plantaKey);
        q += ` AND "plantaKey" = $${params.length}`;
    }
    if (filters.tipo) {
        const tipo = resolverTipoCorrelativo(filters.tipo);
        if (!tipo) return [];
        params.push(tipo.tipoBase);
        q += ` AND "tipoBase" = $${params.length}`;
        params.push(tipo.modalidad);
        q += ` AND "modalidad" = $${params.length}`;
    }
    
    q += ` ORDER BY "plantaKey", "tipoBase", modalidad, "fechaAsignacion" DESC NULLS FIRST`;
    
    const res = await db.query(q, params);
    return res.rows;
};

exports.obtenerRangoActivo = async (plantaKey, tipo) => {
    const tipoCorrelativo = resolverTipoCorrelativo(tipo);
    if (!tipoCorrelativo) throw new Error('TIPO_NOT_FOUND');
    const q = `
        SELECT c.id, c.planta_key AS "plantaKey", p.nombre AS "plantaNombre",
               $3 AS "tipoClave", c.tipo_certificado_clave AS "tipoBase", c.modalidad,
               t.codigo AS "tipoCodigo", t.nombre AS "tipoNombre",
               c.nro_inicio AS "nroInicio", c.nro_actual AS "nroActual", c.nro_maximo AS "nroMaximo",
               c.activo, (c.nro_maximo - c.nro_actual) AS disponibles,
               (c.nro_actual >= c.nro_maximo) AS agotado,
               c.fecha_asignacion AS "fechaAsignacion", c.fecha_cierre AS "fechaCierre"
        FROM fg_correlativo_certificado c
        JOIN fg_planta p ON p.key = c.planta_key
        JOIN fg_tipo_certificado t ON t.clave = c.tipo_certificado_clave
        WHERE c.planta_key = $1 AND c.tipo_certificado_clave = $2
          AND c.modalidad = $4 AND c.activo = true
    `;
    const res = await db.query(q, [plantaKey, tipoCorrelativo.tipoBase, String(tipo).toUpperCase(), tipoCorrelativo.modalidad]);
    if (res.rowCount === 0) throw new Error('RANGO_NOT_FOUND');
    return res.rows[0];
};

exports.crearRango = async (data) => {
    const { plantaKey, tipoCertificadoClave, nroInicio, nroMaximo } = data;
    const tipoCorrelativo = resolverTipoCorrelativo(tipoCertificadoClave);
    if (!tipoCorrelativo) throw new Error('TIPO_NOT_FOUND');
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const pRes = await client.query('SELECT 1 FROM fg_planta WHERE key = $1', [plantaKey]);
        if (pRes.rowCount === 0) throw new Error('PLANTA_NOT_FOUND');
        
        const tRes = await client.query('SELECT activo FROM fg_tipo_certificado WHERE clave = $1', [tipoCorrelativo.tipoBase]);
        if (tRes.rowCount === 0) throw new Error('TIPO_NOT_FOUND');
        if (!tRes.rows[0].activo) throw new Error('TIPO_INACTIVO');

        const servicioRes = await client.query(`
            SELECT 1
            FROM fg_servicio
            WHERE tipo_certificado_clave = $1
              AND COALESCE(modalidad, 'UNICA') = $2
              AND tipo_flujo = 'CERTIFICACION'
              AND activo = TRUE
            LIMIT 1
        `, [tipoCorrelativo.tipoBase, tipoCorrelativo.modalidad]);
        if (!servicioRes.rowCount) throw new Error('TIPO_INACTIVO');
        
        const actRes = await client.query(`SELECT id FROM fg_correlativo_certificado
            WHERE planta_key = $1 AND tipo_certificado_clave = $2 AND modalidad = $3 AND activo = true`,
        [plantaKey, tipoCorrelativo.tipoBase, tipoCorrelativo.modalidad]);
        if (actRes.rowCount > 0) throw new Error('RANGO_ACTIVO_EXISTENTE');
        
        const nroActual = nroInicio - 1;
        
        const q = `
            INSERT INTO fg_correlativo_certificado 
            (planta_key, tipo_certificado_clave, modalidad, nro_inicio, nro_actual, nro_maximo, activo, fecha_cierre)
            VALUES ($1, $2, $3, $4, $5, $6, true, NULL)
            RETURNING id
        `;
        const res = await client.query(q, [plantaKey, tipoCorrelativo.tipoBase, tipoCorrelativo.modalidad, nroInicio, nroActual, nroMaximo]);
        
        await client.query('COMMIT');
        return { id: res.rows[0].id };
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23P01' || e.constraint === 'excl_fg_correlativo_rango') {
            throw new Error('RANGO_SOLAPADO');
        }
        if (e.constraint === 'fg_correlativo_certificado_hist_key') {
            throw new Error('RANGO_DUPLICADO');
        }
        if (e.code === '23505' && e.constraint === 'fg_correlativo_certificado_activo_idx') {
            throw new Error('RANGO_ACTIVO_EXISTENTE');
        }
        throw e;
    } finally {
        client.release();
    }
};

exports.cerrarRango = async (id) => {
    const qCheck = 'SELECT activo FROM fg_correlativo_certificado WHERE id = $1';
    const resCheck = await db.query(qCheck, [id]);
    if (resCheck.rowCount === 0) throw new Error('RANGO_NOT_FOUND');
    
    if (!resCheck.rows[0].activo) {
        return { message: 'El rango ya se encontraba cerrado' };
    }
    
    const qUp = `
        UPDATE fg_correlativo_certificado 
        SET activo = false, fecha_cierre = CURRENT_TIMESTAMP, fecha_modificacion = CURRENT_TIMESTAMP 
        WHERE id = $1
    `;
    await db.query(qUp, [id]);
    return { message: 'Rango cerrado correctamente' };
};

exports.actualizarRango = async (id, data) => {
    const nroInicio = Number(data.nroInicio);
    const nroMaximo = Number(data.nroMaximo);
    if (!Number.isSafeInteger(nroInicio) || nroInicio <= 0
        || !Number.isSafeInteger(nroMaximo) || nroMaximo < nroInicio) {
        throw new Error('RANGO_INVALIDO');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query(`
            SELECT id, nro_inicio, nro_actual, nro_maximo, activo
            FROM fg_correlativo_certificado
            WHERE id = $1
            FOR UPDATE
        `, [id]);
        if (!actual.rowCount) throw new Error('RANGO_NOT_FOUND');

        const rango = actual.rows[0];
        if (!rango.activo) throw new Error('RANGO_CERRADO_NO_EDITABLE');
        const usado = Number(rango.nro_actual) >= Number(rango.nro_inicio);
        if (usado && nroInicio !== Number(rango.nro_inicio)) {
            throw new Error('RANGO_INICIO_NO_EDITABLE');
        }
        if (usado && nroMaximo < Number(rango.nro_actual)) {
            throw new Error('RANGO_MAXIMO_MENOR_ACTUAL');
        }

        const nuevoActual = usado ? Number(rango.nro_actual) : nroInicio - 1;
        const resultado = await client.query(`
            UPDATE fg_correlativo_certificado
            SET nro_inicio = $2,
                nro_actual = $3,
                nro_maximo = $4,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, nro_inicio, nro_actual, nro_maximo,
                      (nro_maximo - nro_actual) AS disponibles
        `, [id, nroInicio, nuevoActual, nroMaximo]);
        await client.query('COMMIT');
        return resultado.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23P01' || error.constraint === 'excl_fg_correlativo_rango') {
            throw new Error('RANGO_SOLAPADO');
        }
        if (error.constraint === 'fg_correlativo_certificado_hist_key') {
            throw new Error('RANGO_DUPLICADO');
        }
        throw error;
    } finally {
        client.release();
    }
};

// ============================================
// FASE 3: BORRADORES DE CERTIFICADOS
// ============================================

const faregasAuthService = require('./faregas-auth.service');

const PASOS_BORRADOR = Object.freeze([
    'DATOS_INICIALES',
    'PAGO',
    'VEHICULO',
    'PREVISUALIZACION',
    'FACTURACION',
    'VERIFICACION_EMISION'
]);

// Función helper para validar si el usuario puede acceder a la planta del certificado
const validarAccesoCertificado = async (username, perfilId, plantaKey) => {
    const acceso = await faregasAuthService.validarAccesoPlanta(username, perfilId, plantaKey);
    if (!acceso) {
        throw new Error('PLANTA_NO_AUTORIZADA');
    }
};

const normalizarFechaFiltro = (valor) => {
    const fecha = String(valor || '').trim();
    if (!fecha) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('FECHA_INVALIDA');
    const fechaUtc = new Date(`${fecha}T00:00:00.000Z`);
    if (Number.isNaN(fechaUtc.getTime()) || fechaUtc.toISOString().slice(0, 10) !== fecha) {
        throw new Error('FECHA_INVALIDA');
    }
    return fecha;
};

exports.obtenerBorradores = async (page = 1, pageSize = 10, search = '', userContext, filtrosFecha = {}) => {
    // Compatibilidad con llamadas internas anteriores: (page, pageSize, userContext).
    if (search && typeof search === 'object' && !userContext) {
        userContext = search;
        search = '';
    }
    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 10;
    if (pageSize > 100) pageSize = 100;

    const offset = (page - 1) * pageSize;

    // 1. Obtener plantas permitidas
    const pRes = await faregasAuthService.getPlantasPorUsuario(userContext.username, userContext.perfil_id);
    // Validar acceso (opcional si getPlantasPorUsuario ya valida que esté en la lista, pero la regla dice "SEDE ACTIVA" que es userContext.planta_key)
    const tieneAcceso = pRes.some(p => p.key === userContext.planta_key);
    if (!tieneAcceso) {
        return { data: [], total: 0, page, pageSize, totalPages: 0 };
    }

    const termino = String(search || '').trim();
    const fechaDesde = normalizarFechaFiltro(filtrosFecha.fechaDesde);
    const fechaHasta = normalizarFechaFiltro(filtrosFecha.fechaHasta);
    if (Boolean(fechaDesde) !== Boolean(fechaHasta)) throw new Error('RANGO_FECHAS_INCOMPLETO');
    if (fechaDesde && fechaDesde > fechaHasta) throw new Error('RANGO_FECHAS_INVALIDO');

    const parametrosBase = [userContext.planta_key];
    const condiciones = ['c.planta_key = $1']; // Se removio filtro de estado para mostrar todos
    const estadoCertificado = filtrosFecha && filtrosFecha.estado ? filtrosFecha.estado : '';
    if (estadoCertificado && estadoCertificado !== 'TODOS') {
        parametrosBase.push(estadoCertificado);
        const indiceEstado = parametrosBase.length;
        condiciones.push(`c.estado = $${indiceEstado}`);
    }
    if (termino) {
        parametrosBase.push(`%${termino}%`);
        const indiceBusqueda = parametrosBase.length;
        condiciones.push(`(
            c.id::text ILIKE $${indiceBusqueda}
            OR COALESCE(v.placa, '') ILIKE $${indiceBusqueda}
            OR COALESCE(tit.nro_documento, '') ILIKE $${indiceBusqueda}
            OR COALESCE(tit.nombre_razon_social, '') ILIKE $${indiceBusqueda}
        )`);
    }
    if (fechaDesde && fechaHasta) {
        parametrosBase.push(fechaDesde);
        const indiceDesde = parametrosBase.length;
        parametrosBase.push(fechaHasta);
        const indiceHasta = parametrosBase.length;
        condiciones.push(`c.fecha_creacion >= $${indiceDesde}::date`);
        condiciones.push(`c.fecha_creacion < ($${indiceHasta}::date + INTERVAL '1 day')`);
    } else {
        condiciones.push('c.fecha_creacion >= CURRENT_DATE');
        condiciones.push("c.fecha_creacion < (CURRENT_DATE + INTERVAL '1 day')");
    }
    const filtroWhere = condiciones.join('\n        AND ');
    const qTotal = `
        SELECT COUNT(DISTINCT c.id)
        FROM fg_certificado c
        LEFT JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
        LEFT JOIN fg_certificado_titular tit ON tit.certificado_id = c.id AND tit.orden = 1
        WHERE ${filtroWhere}`;
    const resTotal = await db.query(qTotal, parametrosBase);
    const total = parseInt(resTotal.rows[0].count);

    if (total === 0) {
        return { data: [], total: 0, page, pageSize, totalPages: 0 };
    }

    const qData = `
        SELECT 
            c.id, 
            c.fecha_creacion AS "fechaCreacion",
            c.fecha_modificacion AS "fechaActualizacion",
            c.estado,
            c.paso_actual AS "pasoActual",
            v.placa,
            tit.nro_documento AS "clienteDocumento",
            tit.nombre_razon_social AS "clienteNombre",
            t.clave AS "tipoCertificadoClave",
            COALESCE(s.nombre, t.nombre) AS "conceptoVehicular",
            op.estado AS "estadoPago",
            f.estado AS "estadoFacturacion",
            f.aceptada_sunat AS "aceptadaSunat",
            f.enlace_pdf AS "enlacePdf",
            f.nro_comprobante AS "nroComprobante"
        FROM fg_certificado c
        LEFT JOIN fg_certificado_vehiculo v ON c.id = v.certificado_id
        LEFT JOIN fg_certificado_titular tit ON c.id = tit.certificado_id AND tit.orden = 1
        LEFT JOIN fg_tipo_certificado t ON c.tipo_certificado_clave = t.clave
        LEFT JOIN fg_tarifa ta ON ta.codigo = c.tarifa_codigo AND ta.planta_key = c.planta_key
        LEFT JOIN fg_servicio s ON s.id = ta.servicio_id
        LEFT JOIN fg_orden_pago op ON op.certificado_id = c.id
        LEFT JOIN fg_facturacion f ON f.certificado_id = c.id
        WHERE ${filtroWhere}
        ORDER BY COALESCE(c.fecha_modificacion, c.fecha_creacion) DESC, c.id DESC
        LIMIT $${parametrosBase.length + 1} OFFSET $${parametrosBase.length + 2}
    `;

    const resData = await db.query(qData, [...parametrosBase, pageSize, offset]);

    return {
        data: resData.rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
    };
};

exports.crearBorrador = async (data, userContext) => {
    // data: tarifaCodigo, clienteId, observaciones
    // userContext: username, perfil_id, planta_key
    
    const { tarifaCodigo, clienteId, observaciones, placa, categoria } = data;
    const { username, planta_key } = userContext;

    if (!tarifaCodigo) {
        throw new Error('TARIFA_REQUERIDA');
    }

    // Validar tarifa y obtener tipo_certificado_clave
    const tarifa = tarifasService.validarTarifaCertificacion(
        await tarifasService.obtenerTarifaOperativaPorCodigo(planta_key, tarifaCodigo)
    );

    const tipoCertificadoClave = tarifa.tipo_certificado_clave;

    if (observaciones && observaciones.length > 250 && tipoCertificadoClave && tipoCertificadoClave.startsWith('GNV')) {
        const err = new Error('Las observaciones no pueden superar los 250 caracteres.');
        err.status = 400;
        throw err;
    }

    // Validar tipo (sólo por si acaso)
    const tipo = await db.query('SELECT activo FROM fg_tipo_certificado WHERE clave = $1', [tipoCertificadoClave]);
    if (tipo.rowCount === 0) throw new Error('TIPO_NOT_FOUND');
    if (!tipo.rows[0].activo) throw new Error('TIPO_INACTIVO');

    // Validar cliente si viene informado
    if (clienteId) {
        const cli = await db.query('SELECT estado FROM fg_cliente WHERE id = $1', [clienteId]);
        if (cli.rowCount === 0) throw new Error('CLIENTE_NOT_FOUND');
        if (!cli.rows[0].estado) throw new Error('CLIENTE_INACTIVO');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query(`
            INSERT INTO fg_certificado (
                tipo_certificado_clave, tarifa_codigo, cliente_id, planta_key,
                numero_certificado, fecha_emision, estado, paso_actual,
                observaciones, usuario_creacion, usuario_modificacion
            ) VALUES (
                $1, $2, $3, $4, NULL, NULL, 'BORRADOR', 'DATOS_INICIALES', $5, $6, $6
            ) RETURNING id, estado, paso_actual AS "pasoActual"
        `, [tipoCertificadoClave, tarifaCodigo, clienteId || null, planta_key, observaciones || null, username]);
        const borrador = res.rows[0];
        await client.query(`
            INSERT INTO fg_certificado_vehiculo (certificado_id, placa, categoria)
            VALUES ($1, $2, $3)
            ON CONFLICT (certificado_id) DO UPDATE
            SET placa = EXCLUDED.placa, categoria = EXCLUDED.categoria
        `, [borrador.id, placa || null, categoria || null]);
        await client.query('COMMIT');
        return borrador;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.obtenerBorradorCompleto = async (id, userContext) => {
    // Cabecera
    const qCab = `
        SELECT c.*, 
               t.codigo AS tipo_codigo, t.nombre AS tipo_nombre,
               p.nombre AS planta_nombre,
               cl.tipo_documento AS cliente_tipo_doc, cl.nro_documento AS cliente_nro_doc, cl.nombre_razon_social AS cliente_nombre,
               s.codigo AS servicio_codigo, s.nombre AS servicio_nombre, s.modalidad AS servicio_modalidad,
               s.tipo_flujo AS servicio_tipo_flujo, s.formato_id AS servicio_formato_id,
               f.nombre AS formato_nombre,
               fv.id AS formato_version_resuelta_id, fv.version AS formato_version,
               fv.estado AS formato_version_estado, fv.motor AS formato_version_motor,
               fv.configuracion AS formato_version_configuracion,
               ta.precio AS tarifa_precio
        FROM fg_certificado c
        LEFT JOIN fg_tipo_certificado t ON c.tipo_certificado_clave = t.clave
        LEFT JOIN fg_planta p ON c.planta_key = p.key
        LEFT JOIN fg_cliente cl ON c.cliente_id = cl.id
        LEFT JOIN fg_tarifa ta ON ta.codigo = c.tarifa_codigo AND ta.planta_key = c.planta_key
        LEFT JOIN fg_servicio s ON s.id = ta.servicio_id
        LEFT JOIN fg_certificado_formato f ON f.id = s.formato_id
        LEFT JOIN LATERAL (
            SELECT version.id, version.version, version.estado, version.motor, version.configuracion
            FROM fg_certificado_formato_version version
            WHERE version.formato_id = f.id
              AND (version.id = c.formato_version_id OR version.estado IN ('VIGENTE', 'BORRADOR'))
            ORDER BY
                CASE
                    WHEN version.id = c.formato_version_id THEN 0
                    WHEN version.estado = 'VIGENTE' THEN 1
                    ELSE 2
                END,
                version.version DESC
            LIMIT 1
        ) fv ON TRUE
        WHERE c.id = $1
    `;
    const resCab = await db.query(qCab, [id]);
    if (resCab.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    
    const cert = resCab.rows[0];

    // Validar politica de planta
    await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);

    // Snapshot Vehicular
    const qVeh = `SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1`;
    const resVeh = await db.query(qVeh, [id]);
    
    // Titulares
    const qTit = `SELECT * FROM fg_certificado_titular WHERE certificado_id = $1 ORDER BY orden ASC`;
    const resTit = await db.query(qTit, [id]);

    const versionConfig = configuracionFormato(cert.formato_version_configuracion);
    const variablesConfiguradas = Array.isArray(versionConfig.variables_usadas)
        ? versionConfig.variables_usadas
        : [];
    const variablesHtml = cert.formato_version_motor === 'HTML_DINAMICO'
        ? extraerVariablesHtml(versionConfig.html || '')
        : [];
    const variablesUsadas = [...new Set([...variablesConfiguradas, ...variablesHtml]
        .map((key) => String(key || '').trim())
        .filter((key) => CLAVE_VARIABLE_FORMATO.test(key)))];
    const catalogoPorClave = new Map(obtenerCatalogoVariables(versionConfig).map((variable) => [variable.key, variable]));
    const valoresBase = combinarObjetos({
        certificado: {
            numero: cert.numero_certificado || '',
            fecha_emision: cert.fecha_emision || '',
            modalidad: cert.servicio_modalidad || '',
            titulo: cert.tipo_nombre || cert.servicio_nombre || ''
        },
        taller: {
            nombre: cert.entidad_certificadora_nombre || '',
            direccion: cert.lugar_emision || '',
            telefono: cert.telefono_certificadora || '',
            ciudad: '',
            representante_legal: '',
            numero_autorizacion: cert.resolucion_directoral || ''
        },
        empresa: {
            razon_social: cert.cliente_nombre || '',
            ruc: cert.cliente_nro_doc || '',
            resolucion: cert.resolucion_directoral || '',
            direccion: cert.domicilio_fiscal || '',
            telefono: cert.telefono_certificadora || ''
        },
        inspeccion: {
            observaciones: cert.observaciones || '',
            fecha_proxima_inspeccion: ''
        }
    }, cert.formato_datos_snapshot || {});
    const camposFormato = variablesUsadas
        .filter((key) => !VARIABLES_FORMATO_AUTOMATICAS.has(key))
        .map((key) => {
            const variable = catalogoPorClave.get(key) || {};
            return {
                key,
                label: variable.label || key.split('.').pop().replaceAll('_', ' '),
                grupo: variable.grupo || 'Datos del certificado',
                tipo: variable.tipo === 'date' ? 'date' : 'text',
                requerido: key !== 'inspeccion.observaciones',
                valor: valorAnidado(valoresBase, key) ?? ''
            };
        });

    return {
        id: cert.id,
        estado: cert.estado,
        pasoActual: cert.paso_actual,
        tarifaCodigo: cert.tarifa_codigo,
        servicio: cert.servicio_codigo ? {
            codigo: cert.servicio_codigo,
            nombre: cert.servicio_nombre,
            modalidad: cert.servicio_modalidad,
            tipoFlujo: cert.servicio_tipo_flujo,
            precio: cert.tarifa_precio === null ? null : Number(cert.tarifa_precio)
        } : null,
        fechaCreacion: cert.fecha_creacion,
        fechaActualizacion: cert.fecha_modificacion,
        tipo: {
            clave: cert.tipo_certificado_clave,
            codigo: cert.tipo_codigo,
            nombre: cert.tipo_nombre
        },
        planta: {
            key: cert.planta_key,
            nombre: cert.planta_nombre
        },
        cliente: cert.cliente_id ? {
            id: cert.cliente_id,
            tipoDocumento: cert.cliente_tipo_doc,
            nroDocumento: cert.cliente_nro_doc,
            nombreRazonSocial: cert.cliente_nombre
        } : null,
        numeroCertificado: cert.numero_certificado,
        fechaEmision: cert.fecha_emision,
        observaciones: cert.observaciones,
        entidadCertificadoraNombre: cert.entidad_certificadora_nombre,
        resolucionDirectoral: cert.resolucion_directoral,
        domicilioFiscal: cert.domicilio_fiscal,
        telefonoCertificadora: cert.telefono_certificadora,
        lugarEmision: cert.lugar_emision,
        formatoDatosSnapshot: cert.formato_datos_snapshot || {},
        formatoVersionId: cert.formato_version_resuelta_id || cert.formato_version_id || null,
        formatoFormulario: cert.servicio_formato_id && cert.formato_version_resuelta_id ? {
            formatoId: cert.servicio_formato_id,
            formatoNombre: cert.formato_nombre,
            versionId: cert.formato_version_resuelta_id,
            version: cert.formato_version,
            versionEstado: cert.formato_version_estado,
            motor: cert.formato_version_motor,
            campos: camposFormato,
            valores: Object.fromEntries(camposFormato.map((campo) => [campo.key, campo.valor]))
        } : null,
        vehiculo: resVeh.rowCount > 0 ? resVeh.rows[0] : null,
        titulares: resTit.rows
    };
};

exports.actualizarPasoBorrador = async (id, pasoActual, userContext) => {
    const pasoDestino = String(pasoActual || '').trim().toUpperCase();
    const destino = PASOS_BORRADOR.indexOf(pasoDestino);
    if (destino < 0) throw new Error('PASO_INVALIDO');

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            'SELECT estado, planta_key, paso_actual FROM fg_certificado WHERE id = $1 FOR UPDATE',
            [id]
        );
        if (result.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const certificado = result.rows[0];
        await validarAccesoCertificado(userContext.username, userContext.perfil_id, certificado.planta_key);
        if (certificado.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        const actual = PASOS_BORRADOR.indexOf(certificado.paso_actual || 'DATOS_INICIALES');
        if (destino > actual + 1) throw new Error('TRANSICION_PASO_INVALIDA');
        // Volver a revisar una pantalla no reduce el progreso persistido.
        const pasoPersistido = destino > actual ? pasoDestino : certificado.paso_actual;
        await client.query(`
            UPDATE fg_certificado
            SET paso_actual = $2, usuario_modificacion = $3, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [id, pasoPersistido, userContext.username]);
        await client.query('COMMIT');
        return { pasoActual: pasoPersistido };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.actualizarBorrador = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const qCheck = `SELECT estado, planta_key, tipo_certificado_clave, tarifa_codigo, numero_certificado FROM fg_certificado WHERE id = $1 FOR UPDATE`;
        const rCheck = await client.query(qCheck, [id]);
        if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCheck.rows[0];

        await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);

        if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        const campos = [];
        const values = [];
        let idx = 1;

        if (data.clienteId !== undefined) {
            campos.push(`cliente_id = $${idx++}`);
            values.push(data.clienteId);
        }
        if (data.observaciones !== undefined) {
            if (data.observaciones && data.observaciones.length > 250 && (cert.tipo_certificado_clave.startsWith('GNV') || (data.tipoCertificadoClave && data.tipoCertificadoClave.startsWith('GNV')))) {
                const err = new Error('Las observaciones no pueden superar los 250 caracteres.');
                err.status = 400;
                throw err;
            }
            campos.push(`observaciones = $${idx++}`);
            values.push(data.observaciones);
        }
        if (data.tarifaCodigo !== undefined) {
            if (data.tarifaCodigo !== cert.tarifa_codigo) {
                if (cert.numero_certificado) throw new Error('CORRELATIVO_YA_RESERVADO');
                const evidencia = await client.query(`
                    SELECT 1 FROM fg_orden_pago WHERE certificado_id = $1 AND estado = 'PAGADO'
                    UNION ALL
                    SELECT 1 FROM fg_facturacion WHERE certificado_id = $1 AND estado IN ('PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'ERROR')
                    LIMIT 1
                `, [id]);
                if (evidencia.rowCount > 0) throw new Error('DATOS_PREVIOS_NO_EDITABLES');
            }
            const tarifa = tarifasService.validarTarifaCertificacion(
                await tarifasService.obtenerTarifaOperativaPorCodigo(
                    userContext.planta_key,
                    data.tarifaCodigo,
                    client
                )
            );

            const tipoCertificadoClave = tarifa.tipo_certificado_clave;
            
            const tipo = await client.query('SELECT activo FROM fg_tipo_certificado WHERE clave = $1', 
            [tipoCertificadoClave]);
            if (tipo.rowCount === 0) throw new Error('TIPO_NOT_FOUND');
            if (!tipo.rows[0].activo) throw new Error('TIPO_INACTIVO');
            
            campos.push(`tipo_certificado_clave = $${idx++}`);
            values.push(tipoCertificadoClave);
            
            campos.push(`tarifa_codigo = $${idx++}`);
            values.push(data.tarifaCodigo);
        }

        if (campos.length > 0) {
            campos.push(`usuario_modificacion = $${idx++}`);
            values.push(userContext.username);
            campos.push(`fecha_modificacion = CURRENT_TIMESTAMP`);
            
            values.push(id);
            const qUpd = `UPDATE fg_certificado SET ${campos.join(', ')} WHERE id = $${idx}`;
            await client.query(qUpd, values);
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.guardarVehiculoBorrador = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const qCheck = `SELECT estado, planta_key FROM fg_certificado WHERE id = $1 FOR UPDATE`;
        const rCheck = await client.query(qCheck, [id]);
        if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCheck.rows[0];

        await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
        if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');
        // El flujo vigente confirma el pago antes de completar el expediente
        // técnico. Por eso un pago no puede bloquear este guardado; la
        // facturación sí congela el snapshot vehicular que será emitido.
        const evidencia = await client.query(`
            SELECT 1
            FROM fg_facturacion
            WHERE certificado_id = $1
              AND estado IN ('PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'ERROR')
            LIMIT 1
        `, [id]);
        if (evidencia.rowCount > 0) throw new Error('DATOS_PREVIOS_NO_EDITABLES');

        const qUpd = `
            INSERT INTO fg_certificado_vehiculo (
                certificado_id, placa, categoria, clase, marca, modelo, version, anio_fabricacion, 
                anio_modelo, vin, serie_chasis, numero_motor, combustible, color, carroceria, 
                numero_cilindros, cilindrada, numero_ejes, numero_ruedas, numero_asientos, 
                numero_pasajeros, longitud, ancho, alto, peso_neto, peso_bruto, carga_util, 
                potencia, formula_rodante
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 
                $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
            )
            ON CONFLICT (certificado_id) DO UPDATE SET
                placa = EXCLUDED.placa,
                categoria = EXCLUDED.categoria,
                clase = EXCLUDED.clase,
                marca = EXCLUDED.marca,
                modelo = EXCLUDED.modelo,
                version = EXCLUDED.version,
                anio_fabricacion = EXCLUDED.anio_fabricacion,
                anio_modelo = EXCLUDED.anio_modelo,
                vin = EXCLUDED.vin,
                serie_chasis = EXCLUDED.serie_chasis,
                numero_motor = EXCLUDED.numero_motor,
                combustible = EXCLUDED.combustible,
                color = EXCLUDED.color,
                carroceria = EXCLUDED.carroceria,
                numero_cilindros = EXCLUDED.numero_cilindros,
                cilindrada = EXCLUDED.cilindrada,
                numero_ejes = EXCLUDED.numero_ejes,
                numero_ruedas = EXCLUDED.numero_ruedas,
                numero_asientos = EXCLUDED.numero_asientos,
                numero_pasajeros = EXCLUDED.numero_pasajeros,
                longitud = EXCLUDED.longitud,
                ancho = EXCLUDED.ancho,
                alto = EXCLUDED.alto,
                peso_neto = EXCLUDED.peso_neto,
                peso_bruto = EXCLUDED.peso_bruto,
                carga_util = EXCLUDED.carga_util,
                potencia = EXCLUDED.potencia,
                formula_rodante = EXCLUDED.formula_rodante
        `;

        await client.query(qUpd, [
            id,
            data.placa || null,
            data.categoria || null,
            data.clase || null,
            data.marca || null,
            data.modelo || null,
            data.version || null,
            data.anioFabricacion || null,
            data.anioModelo || null,
            data.vin || null,
            data.serieChasis || null,
            data.numeroMotor || null,
            data.combustible || null,
            data.color || null,
            data.carroceria || null,
            data.numeroCilindros || null,
            data.cilindrada || null,
            data.numeroEjes || null,
            data.numeroRuedas || null,
            data.numeroAsientos || null,
            data.numeroPasajeros || null,
            data.longitud || null,
            data.ancho || null,
            data.alto || null,
            data.pesoNeto || null,
            data.pesoBruto || null,
            data.cargaUtil || null,
            data.potencia || null,
            data.formulaRodante || null
        ]);

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.agregarTitular = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const qCheck = `SELECT estado, planta_key FROM fg_certificado WHERE id = $1 FOR UPDATE`;
        const rCheck = await client.query(qCheck, [id]);
        if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCheck.rows[0];

        await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
        if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        if (data.clienteId) {
            const cli = await client.query('SELECT estado FROM fg_cliente WHERE id = $1', [data.clienteId]);
            if (cli.rowCount === 0) throw new Error('CLIENTE_NOT_FOUND');
        }

        const qIns = `
            INSERT INTO fg_certificado_titular (
                certificado_id, cliente_id, orden, tipo_documento, nro_documento, nombre_razon_social, direccion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
        `;
        const res = await client.query(qIns, [
            id,
            data.clienteId || null,
            data.orden,
            data.tipoDocumento || null,
            data.nroDocumento || null,
            data.nombreRazonSocial,
            data.direccion || null
        ]);

        await client.query('COMMIT');
        return res.rows[0].id;
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505' && e.constraint === 'fg_certificado_titular_certificado_id_orden_key') {
            throw new Error('ORDEN_TITULAR_DUPLICADO');
        }
        throw e;
    } finally {
        client.release();
    }
};

exports.actualizarTitular = async (id, titularId, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const qCheck = `SELECT estado, planta_key FROM fg_certificado WHERE id = $1 FOR UPDATE`;
        const rCheck = await client.query(qCheck, [id]);
        if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCheck.rows[0];

        await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
        if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        const qTit = `SELECT id FROM fg_certificado_titular WHERE id = $1 AND certificado_id = $2`;
        const rTit = await client.query(qTit, [titularId, id]);
        if (rTit.rowCount === 0) throw new Error('TITULAR_NOT_FOUND');

        if (data.clienteId) {
            const cli = await client.query('SELECT estado FROM fg_cliente WHERE id = $1', [data.clienteId]);
            if (cli.rowCount === 0) throw new Error('CLIENTE_NOT_FOUND');
        }

        const campos = [];
        const values = [];
        let idx = 1;

        if (data.clienteId !== undefined) { campos.push(`cliente_id = $${idx++}`); values.push(data.clienteId); }
        if (data.orden !== undefined) { campos.push(`orden = $${idx++}`); values.push(data.orden); }
        if (data.tipoDocumento !== undefined) { campos.push(`tipo_documento = $${idx++}`); values.push(data.tipoDocumento); }
        if (data.nroDocumento !== undefined) { campos.push(`nro_documento = $${idx++}`); values.push(data.nroDocumento); }
        if (data.nombreRazonSocial !== undefined) { campos.push(`nombre_razon_social = $${idx++}`); values.push(data.nombreRazonSocial); }
        if (data.direccion !== undefined) { campos.push(`direccion = $${idx++}`); values.push(data.direccion); }

        if (campos.length > 0) {
            values.push(titularId);
            const qUpd = `UPDATE fg_certificado_titular SET ${campos.join(', ')} WHERE id = $${idx}`;
            await client.query(qUpd, values);
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505' && e.constraint === 'fg_certificado_titular_certificado_id_orden_key') {
            throw new Error('ORDEN_TITULAR_DUPLICADO');
        }
        throw e;
    } finally {
        client.release();
    }
};

exports.eliminarTitular = async (id, titularId, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const qCheck = `SELECT estado, planta_key FROM fg_certificado WHERE id = $1 FOR UPDATE`;
        const rCheck = await client.query(qCheck, [id]);
        if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCheck.rows[0];

        await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
        if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        const qDel = `DELETE FROM fg_certificado_titular WHERE id = $1 AND certificado_id = $2 RETURNING id`;
        const res = await client.query(qDel, [titularId, id]);
        
        if (res.rowCount === 0) throw new Error('TITULAR_NOT_FOUND');

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

// ============================================
// FASE 4: DATOS ESPECÍFICOS DE CERTIFICADOS
// ============================================

const obtenerYValidarBorrador = async (client, id, tipoRequerido, userContext) => {
    const qCheck = `SELECT estado, planta_key, tipo_certificado_clave FROM fg_certificado WHERE id = $1 FOR UPDATE`;
    const rCheck = await client.query(qCheck, [id]);
    if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    const cert = rCheck.rows[0];

    await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
    
    if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');
    if (tipoRequerido && cert.tipo_certificado_clave !== tipoRequerido) {
        throw new Error('TIPO_CERTIFICADO_INCORRECTO');
    }
    
    return cert;
};

// ================= GNV =================

exports.guardarGNV = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const certificado = await obtenerYValidarBorrador(client, id, 'GNV_ANUAL', userContext);

        let snapshotTaller = null;
        if (data.tallerAutorizadoId) {
            const resTaller = await client.query('SELECT razon_social, sede, direccion, codigo_autorizacion FROM fg_taller_autorizado WHERE id = $1 AND estado = true', [data.tallerAutorizadoId]);
            if (resTaller.rowCount === 0) throw new Error('TALLER_NOT_FOUND');
            snapshotTaller = resTaller.rows[0];
        }

        // Validar modalidad si se envía
        const modalidadGNV = data.modalidad ? data.modalidad.trim().toUpperCase() : null;
        if (modalidadGNV && !['INICIAL', 'ANUAL'].includes(modalidadGNV)) {
            throw new Error('MODALIDAD_GNV_INVALIDA');
        }

        // Validar numero_chip
        let numeroChip = data.numeroChip ? normalizarNumeroChip(data.numeroChip) : null;
        if (numeroChip) {
            if (!esNumeroChipCertificadoValido(numeroChip)) {
                throw new Error('NUMERO_CHIP_INVALIDO');
            }
        }

        const qModActual = `SELECT modalidad FROM fg_certificado_gnv WHERE certificado_id = $1 FOR UPDATE`;
        const rModActual = await client.query(qModActual, [id]);
        const modalidadAnterior = rModActual.rowCount > 0 ? rModActual.rows[0].modalidad : null;

        if (modalidadAnterior && modalidadGNV && modalidadAnterior !== modalidadGNV) {
            if (modalidadAnterior === 'INICIAL' && modalidadGNV === 'ANUAL') {
                numeroChip = null;
                data.combustiblePosterior = null;
                data.pesoNetoPosterior = null;
                data.cargaUtilPosterior = null;
                await client.query('DELETE FROM fg_certificado_gnv_componente WHERE certificado_id = $1', [id]);
            } else if (modalidadAnterior === 'ANUAL' && modalidadGNV === 'INICIAL') {
                await client.query('DELETE FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1', [id]);
            }
        }

        const qUpd = `
            INSERT INTO fg_certificado_gnv (
                certificado_id, taller_autorizado_id, vigencia_hasta, taller_razon_social, taller_sede, taller_direccion, taller_codigo_autorizacion, modalidad, numero_chip,
                combustible_posterior, peso_neto_posterior
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (certificado_id) DO UPDATE SET
                taller_autorizado_id = EXCLUDED.taller_autorizado_id,
                vigencia_hasta = EXCLUDED.vigencia_hasta,
                taller_razon_social = EXCLUDED.taller_razon_social,
                taller_sede = EXCLUDED.taller_sede,
                taller_direccion = EXCLUDED.taller_direccion,
                taller_codigo_autorizacion = EXCLUDED.taller_codigo_autorizacion,
                modalidad = EXCLUDED.modalidad,
                numero_chip = EXCLUDED.numero_chip,
                combustible_posterior = EXCLUDED.combustible_posterior,
                peso_neto_posterior = EXCLUDED.peso_neto_posterior
        `;
        
        await client.query(qUpd, [
            id,
            data.tallerAutorizadoId || null,
            data.vigenciaHasta || null,
            snapshotTaller ? snapshotTaller.razon_social : null,
            snapshotTaller ? snapshotTaller.sede : null,
            snapshotTaller ? snapshotTaller.direccion : null,
            snapshotTaller ? snapshotTaller.codigo_autorizacion : null,
            modalidadGNV,
            numeroChip,
            data.combustiblePosterior || null,
            data.pesoNetoPosterior || null
        ]);

        await chipCertificadoService.sincronizarReserva(client, {
            certificadoId: Number(id),
            plantaKey: certificado.planta_key,
            modalidad: modalidadGNV,
            numeroChip,
            username: userContext.username
        });

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.guardarGNVComponentes = async (id, componentes, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GNV_ANUAL', userContext);

        await client.query('DELETE FROM fg_certificado_gnv_componente WHERE certificado_id = $1', [id]);

        if (componentes && componentes.length > 0) {
            const qIns = `
                INSERT INTO fg_certificado_gnv_componente (certificado_id, orden, componente, marca, modelo, capacidad_litros, mes_fabricacion, anio_fabricacion, numero_serie)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `;
            for (const c of componentes) {
                await client.query(qIns, [id, c.orden, c.componente, c.marca || null, c.modelo || null, c.capacidadLitros || null, c.mesFabricacion || null, c.anioFabricacion || null, c.numeroSerie || null]);
            }
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505' && e.constraint === 'fg_certificado_gnv_componente_certificado_id_orden_key') {
            throw new Error('COMPONENTE_INVALIDO');
        }
        throw e;
    } finally {
        client.release();
    }
};

exports.guardarGNVVerificaciones = async (id, verificaciones, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GNV_ANUAL', userContext);

        await client.query('DELETE FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1', [id]);

        if (verificaciones && verificaciones.length > 0) {
            const qIns = `
                INSERT INTO fg_certificado_gnv_verificacion (certificado_id, codigo, orden, descripcion, cumple, observacion)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            for (const v of verificaciones) {
                await client.query(qIns, [id, v.codigo, v.orden, v.descripcion, v.cumple, v.observacion || null]);
            }
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerGNV = async (id, userContext) => {
    const qCert = `SELECT planta_key FROM fg_certificado WHERE id = $1`;
    const rCert = await db.query(qCert, [id]);
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    await validarAccesoCertificado(userContext.username, userContext.perfil_id, rCert.rows[0].planta_key);

    const rGnv = await db.query(`SELECT * FROM fg_certificado_gnv WHERE certificado_id = $1`, [id]);
    const rVerif = await db.query(`SELECT * FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1 ORDER BY orden ASC`, [id]);
    const rComp = await db.query(`SELECT * FROM fg_certificado_gnv_componente WHERE certificado_id = $1 ORDER BY orden ASC`, [id]);

    return {
        gnv: rGnv.rowCount > 0 ? rGnv.rows[0] : null,
        verificaciones: rVerif.rows,
        componentes: rComp.rows
    };
};

// ================= GLP =================

exports.guardarGLP = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GLP_ANUAL', userContext);

        let snapshotTaller = null;
        if (data.tallerAutorizadoId) {
            const resTaller = await client.query('SELECT razon_social, sede, direccion, codigo_autorizacion FROM fg_taller_autorizado WHERE id = $1 AND estado = true', [data.tallerAutorizadoId]);
            if (resTaller.rowCount === 0) throw new Error('TALLER_NOT_FOUND');
            snapshotTaller = resTaller.rows[0];
        }

        // Validar modalidad si se envía
        const modalidadGLP = data.modalidad ? data.modalidad.trim().toUpperCase() : null;
        if (modalidadGLP && !['INICIAL', 'ANUAL'].includes(modalidadGLP)) {
            throw new Error('MODALIDAD_GLP_INVALIDA');
        }

        const qModActual = `SELECT modalidad FROM fg_certificado_glp WHERE certificado_id = $1 FOR UPDATE`;
        const rModActual = await client.query(qModActual, [id]);
        const modalidadAnterior = rModActual.rowCount > 0 ? rModActual.rows[0].modalidad : null;

        if (modalidadAnterior && modalidadGLP && modalidadAnterior !== modalidadGLP) {
            if (modalidadAnterior === 'INICIAL' && modalidadGLP === 'ANUAL') {
                data.combustiblePosterior = null;
                data.pesoNetoPosterior = null;
                data.cargaUtilPosterior = null;
                // NO eliminamos componentes
            } else if (modalidadAnterior === 'ANUAL' && modalidadGLP === 'INICIAL') {
                await client.query('DELETE FROM fg_certificado_glp_verificacion WHERE certificado_id = $1', [id]);
            }
        }

        const qUpd = `
            INSERT INTO fg_certificado_glp (
                certificado_id, taller_autorizado_id, expediente_tecnico, vigencia_hasta, taller_razon_social, taller_sede, taller_direccion, taller_codigo_autorizacion, modalidad,
                combustible_posterior, peso_neto_posterior, carga_util_posterior
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (certificado_id) DO UPDATE SET
                taller_autorizado_id = EXCLUDED.taller_autorizado_id,
                expediente_tecnico = EXCLUDED.expediente_tecnico,
                vigencia_hasta = EXCLUDED.vigencia_hasta,
                taller_razon_social = EXCLUDED.taller_razon_social,
                taller_sede = EXCLUDED.taller_sede,
                taller_direccion = EXCLUDED.taller_direccion,
                taller_codigo_autorizacion = EXCLUDED.taller_codigo_autorizacion,
                modalidad = EXCLUDED.modalidad,
                combustible_posterior = EXCLUDED.combustible_posterior,
                peso_neto_posterior = EXCLUDED.peso_neto_posterior,
                carga_util_posterior = EXCLUDED.carga_util_posterior
        `;
        
        await client.query(qUpd, [
            id,
            data.tallerAutorizadoId || null,
            data.expedienteTecnico || null,
            data.vigenciaHasta || null,
            snapshotTaller ? snapshotTaller.razon_social : null,
            snapshotTaller ? snapshotTaller.sede : null,
            snapshotTaller ? snapshotTaller.direccion : null,
            snapshotTaller ? snapshotTaller.codigo_autorizacion : null,
            modalidadGLP,
            data.combustiblePosterior || null,
            data.pesoNetoPosterior || null,
            data.cargaUtilPosterior || null
        ]);

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.guardarGLPComponentes = async (id, componentes, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GLP_ANUAL', userContext);

        await client.query('DELETE FROM fg_certificado_glp_componente WHERE certificado_id = $1', [id]);

        if (componentes && componentes.length > 0) {
            const qIns = `
                INSERT INTO fg_certificado_glp_componente (certificado_id, orden, componente, marca, modelo, capacidad_litros, mes_fabricacion, anio_fabricacion, numero_serie)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `;
            for (const c of componentes) {
                await client.query(qIns, [id, c.orden, c.componente, c.marca || null, c.modelo || null, c.capacidadLitros || null, c.mesFabricacion || null, c.anioFabricacion || null, c.numeroSerie || null]);
            }
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505' && e.constraint === 'fg_certificado_glp_componente_certificado_id_orden_key') {
            throw new Error('COMPONENTE_INVALIDO');
        }
        throw e;
    } finally {
        client.release();
    }
};

exports.guardarGLPVerificaciones = async (id, verificaciones, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GLP_ANUAL', userContext);

        await client.query('DELETE FROM fg_certificado_glp_verificacion WHERE certificado_id = $1', [id]);

        if (verificaciones && verificaciones.length > 0) {
            const qIns = `
                INSERT INTO fg_certificado_glp_verificacion (certificado_id, codigo, orden, descripcion, cumple, observacion)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            for (const v of verificaciones) {
                await client.query(qIns, [id, v.codigo, v.orden, v.descripcion, v.cumple, v.observacion || null]);
            }
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerGLP = async (id, userContext) => {
    const qCert = `SELECT planta_key FROM fg_certificado WHERE id = $1`;
    const rCert = await db.query(qCert, [id]);
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    await validarAccesoCertificado(userContext.username, userContext.perfil_id, rCert.rows[0].planta_key);

    const rGlp = await db.query(`SELECT * FROM fg_certificado_glp WHERE certificado_id = $1`, [id]);
    const rComp = await db.query(`SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = $1 ORDER BY orden ASC`, [id]);
    const rVerif = await db.query(`SELECT * FROM fg_certificado_glp_verificacion WHERE certificado_id = $1 ORDER BY orden ASC`, [id]);

    return {
        glp: rGlp.rowCount > 0 ? rGlp.rows[0] : null,
        componentes: rComp.rows,
        verificaciones: rVerif.rows
    };
};

// ================= CONFORMIDAD =================

exports.guardarConformidad = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'CONFORMIDAD', userContext);
        
        if (data.tipoConformidad && !['MODIFICACION', 'MONTAJE', 'FABRICACION'].includes(data.tipoConformidad)) {
            throw new Error('TIPO_CONFORMIDAD_INVALIDO');
        }

        if (data.caracteristicaRegistrable && data.caracteristicaRegistrable.length > 300) {
            const err = new Error('La característica a certificar no puede superar los 300 caracteres.');
            err.status = 400;
            throw err;
        }

        if (data.usoOriginalVehiculo && data.usoOriginalVehiculo.length > 200) {
            const err = new Error('El uso original del vehículo no puede superar los 200 caracteres.');
            err.status = 400;
            throw err;
        }

        const qUpd = `
            INSERT INTO fg_certificado_conformidad (
                certificado_id, tipo_conformidad, tipo_tramite, caracteristica_registrable, motivo, descripcion, uso_original_vehiculo, marca_modificacion, marca_montaje, marca_fabricacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (certificado_id) DO UPDATE SET
                tipo_conformidad = EXCLUDED.tipo_conformidad,
                tipo_tramite = EXCLUDED.tipo_tramite,
                caracteristica_registrable = EXCLUDED.caracteristica_registrable,
                motivo = EXCLUDED.motivo,
                descripcion = EXCLUDED.descripcion,
                uso_original_vehiculo = EXCLUDED.uso_original_vehiculo,
                marca_modificacion = EXCLUDED.marca_modificacion,
                marca_montaje = EXCLUDED.marca_montaje,
                marca_fabricacion = EXCLUDED.marca_fabricacion
        `;
        
        await client.query(qUpd, [
            id,
            data.tipoConformidad,
            data.tipoTramite || null,
            data.caracteristicaRegistrable || null,
            data.motivo || null,
            data.descripcion || null,
            data.usoOriginalVehiculo || null,
            data.marcaModificacion || false,
            data.marcaMontaje || false,
            data.marcaFabricacion || false
        ]);

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerConformidad = async (id, userContext) => {
    const qCert = `SELECT planta_key FROM fg_certificado WHERE id = $1`;
    const rCert = await db.query(qCert, [id]);
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    await validarAccesoCertificado(userContext.username, userContext.perfil_id, rCert.rows[0].planta_key);

    const rConf = await db.query(`SELECT * FROM fg_certificado_conformidad WHERE certificado_id = $1`, [id]);
    
    return {
        conformidad: rConf.rowCount > 0 ? rConf.rows[0] : null
    };
};

// ================= TALLERES =================

exports.obtenerTalleresActivos = async () => {
    const res = await db.query(`
        SELECT id, ruc, razon_social AS "razonSocial", razon_social AS "nombre", nombre_comercial AS "nombreComercial", 
               sede, direccion, codigo_autorizacion AS "codigoAutorizacion"
        FROM fg_taller_autorizado
        WHERE estado = true
        ORDER BY razon_social ASC
    `);
    return res.rows;
};


exports.validarEmision = async (id, userContext) => {
    const rCert = await db.query(`
        SELECT c.*, t.clave as tipo_clave 
        FROM fg_certificado c
        JOIN fg_tipo_certificado t ON c.tipo_certificado_clave = t.clave
        WHERE c.id = $1
    `, [id]);
    
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    const cert = rCert.rows[0];

    await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);

    if (cert.estado !== 'BORRADOR') {
        return { valido: false, errores: [{ seccion: 'general', campo: 'estado', codigo: 'ESTADO_INVALIDO', mensaje: 'El certificado no está en estado BORRADOR' }] };
    }

    const errores = [];
    const pushError = (seccion, campo, codigo, mensaje) => errores.push({ seccion, campo, codigo, mensaje });

    if (cert.tipo_clave.startsWith('GNV') && cert.observaciones && cert.observaciones.length > 250) {
        pushError('cabecera', 'observaciones', 'LONGITUD_EXCEDIDA', 'Las observaciones no pueden superar los 250 caracteres.');
    }

    // Vehículo base
    const rVeh = await db.query('SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1', [id]);
    const veh = rVeh.rows[0];
    if (!veh) {
        pushError('vehiculo', 'general', 'SECCION_FALTANTE', 'Falta el snapshot de vehículo');
    } else {
        if (!veh.placa) pushError('vehiculo', 'placa', 'CAMPO_REQUERIDO', 'Placa requerida');
        
        const checkCampos = (campos) => {
            campos.forEach(c => {
                if (veh[c] === null || veh[c] === undefined || veh[c] === '') {
                    pushError('vehiculo', c, 'CAMPO_REQUERIDO', `Campo vehiculo requerido: ${c}`);
                }
            });
        };

        if (!veh.vin && !veh.serie_chasis) {
            pushError('vehiculo', 'vin', 'CAMPO_REQUERIDO', 'Se requiere VIN o Serie de Chasis');
        }

        if (cert.tipo_clave === 'GNV_ANUAL') {
            checkCampos([
                'categoria', 'marca', 'modelo', 'version', 'anio_fabricacion', 'numero_motor',
                'numero_cilindros', 'cilindrada', 'combustible', 'numero_ejes', 'numero_ruedas',
                'numero_asientos', 'numero_pasajeros', 'longitud', 'ancho', 'alto', 'color',
                'peso_neto', 'peso_bruto'
            ]);
        } else if (cert.tipo_clave === 'GLP_ANUAL') {
            checkCampos([
                'categoria', 'marca', 'modelo', 'version', 'anio_fabricacion', 'numero_motor',
                'numero_cilindros', 'cilindrada', 'combustible', 'numero_ejes', 'numero_ruedas',
                'numero_asientos', 'numero_pasajeros', 'longitud', 'ancho', 'alto', 
                'peso_neto', 'peso_bruto', 'carga_util'
            ]);
        } else if (cert.tipo_clave === 'CONFORMIDAD') {
            checkCampos([
                'clase', 'categoria', 'modelo', 'marca', 'numero_motor', 'color', 'carroceria',
                'combustible', 'longitud', 'ancho', 'alto', 'peso_bruto', 'peso_neto', 'carga_util',
                'anio_fabricacion', 'anio_modelo', 'formula_rodante', 'potencia', 'numero_ejes',
                'numero_ruedas', 'numero_asientos', 'numero_pasajeros', 'cilindrada', 'numero_cilindros', 'version'
            ]);
        }
    }

    // Titulares
    const rTit = await db.query('SELECT * FROM fg_certificado_titular WHERE certificado_id = $1 ORDER BY orden', [id]);
    const titulares = rTit.rows;
    
    if (cert.tipo_clave === 'GLP_ANUAL' || cert.tipo_clave === 'CONFORMIDAD') {
        if (titulares.length === 0) {
            pushError('titular', 'general', 'TITULAR_REQUERIDO', 'Se requiere al menos 1 titular');
        } else {
            titulares.forEach(t => {
                if (!t.tipo_documento) pushError('titular', 'tipo_documento', 'CAMPO_REQUERIDO', 'Tipo documento requerido');
                if (!t.nro_documento) pushError('titular', 'nro_documento', 'CAMPO_REQUERIDO', 'Nro documento requerido');
                if (!t.nombre_razon_social) pushError('titular', 'nombre_razon_social', 'CAMPO_REQUERIDO', 'Nombre requerido');
                
                if (cert.tipo_clave === 'CONFORMIDAD' && !t.direccion) {
                    pushError('titular', 'direccion', 'CAMPO_REQUERIDO', 'Dirección requerida para titular de conformidad');
                }
            });
        }
    }

    // Orden y pagos Faregas. La orden es la fuente de verdad del saldo antes de emitir.
    const rOrdenPago = await db.query(
        'SELECT estado, importe_total, importe_pagado, saldo_pendiente FROM fg_orden_pago WHERE certificado_id = $1',
        [id]
    );
    if (rOrdenPago.rowCount === 0) {
        pushError('pago', 'orden', 'ORDEN_PAGO_FALTANTE', 'Falta registrar la orden de pago del certificado');
    } else {
        const orden = rOrdenPago.rows[0];
        if (orden.estado !== 'PAGADO' || Number(orden.saldo_pendiente) > 0.009) {
            pushError('pago', 'saldo', 'PAGO_INCOMPLETO', `Pago incompleto. Saldo pendiente: S/ ${Number(orden.saldo_pendiente).toFixed(2)}`);
        }
    }

    // En producción, la facturación electrónica debe estar aceptada antes de
    // consumir el correlativo definitivo. El modo de simulación es explícito,
    // solo funciona fuera de producción y nunca altera el estado SUNAT.
    const facturacionSimulada = integrationsConfig.nubefact.simulationEnabled;
    const rFacturacion = await db.query(
        'SELECT estado, nro_comprobante, aceptada_sunat FROM fg_facturacion WHERE certificado_id = $1',
        [id]
    );
    if (rFacturacion.rowCount === 0) {
        pushError('facturacion', 'general', 'FACTURACION_FALTANTE', 'Faltan los datos de facturacion');
    } else if (!facturacionSimulada && !(rFacturacion.rows[0].estado === 'ACEPTADO' && rFacturacion.rows[0].aceptada_sunat === true)) {
        pushError('facturacion', 'estado', 'FACTURACION_NO_EMITIDA', 'El comprobante debe estar aceptado por Nubefact/SUNAT antes de emitir el certificado');
    }

    // GNV Especifico
    if (cert.tipo_clave === 'GNV_ANUAL') {
        const rGnv = await db.query('SELECT * FROM fg_certificado_gnv WHERE certificado_id = $1', [id]);
        if (rGnv.rowCount === 0) {
            pushError('gnv', 'general', 'SECCION_FALTANTE', 'Faltan datos de GNV');
        } else {
            const g = rGnv.rows[0];
            if (!g.taller_autorizado_id) pushError('gnv', 'taller_autorizado_id', 'CAMPO_REQUERIDO', 'Taller autorizado requerido');
            if (!g.vigencia_hasta) pushError('gnv', 'vigencia_hasta', 'CAMPO_REQUERIDO', 'Vigencia requerida');
            // Modalidad requerida
            if (!g.modalidad || !['INICIAL', 'ANUAL'].includes(g.modalidad)) {
                pushError('gnv', 'modalidad', 'CAMPO_REQUERIDO', 'Modalidad GNV requerida (INICIAL o ANUAL)');
            }
            // Chip requerido solo para INICIAL
            if (g.modalidad === 'INICIAL') {
                pushError('gnv', 'formato', 'FORMATO_INICIAL_PENDIENTE', 'La captura GNV INICIAL está habilitada, pero su formato de emisión todavía no está configurado');
                if (!g.numero_chip) {
                    pushError('gnv', 'numero_chip', 'CAMPO_REQUERIDO', 'N° Chip requerido para GNV INICIAL');
                } else if (!esNumeroChipCertificadoValido(g.numero_chip)) {
                    pushError('gnv', 'numero_chip', 'FORMATO_INVALIDO', 'N° Chip inválido: solo alfanumérico, máx 15 caracteres');
                } else {
                    const rChip = await db.query(`
                        SELECT c.numero_chip, c.estado, c.planta_actual_key
                        FROM fg_certificado_chip cc
                        JOIN fg_chip c ON c.id = cc.chip_id
                        WHERE cc.certificado_id = $1
                    `, [id]);
                    const chip = rChip.rows[0];
                    if (
                        rChip.rowCount !== 1
                        || chip.numero_chip !== normalizarNumeroChip(g.numero_chip)
                        || chip.planta_actual_key !== cert.planta_key
                        || !['RESERVADO', 'VENDIDO'].includes(chip.estado)
                    ) {
                        pushError(
                            'gnv',
                            'numero_chip',
                            'CHIP_NO_RESERVADO',
                            'El N° Chip debe estar reservado en el inventario de esta sede antes de emitir'
                        );
                    }
                }
            }
        }

        const rVer = await db.query('SELECT * FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1', [id]);
        const verifCodes = rVer.rows.map(v => v.codigo);
        const reqCodes = ['a','b','c','d','e','f','g','h'];
        const missing = reqCodes.filter(c => !verifCodes.includes(c));
        if (missing.length > 0) {
            pushError('gnv', 'verificaciones', 'VERIFICACIONES_INCOMPLETAS', 'Faltan verificaciones GNV: ' + missing.join(', '));
        }

        rVer.rows.forEach(v => {
            if (v.cumple === null) {
                pushError('gnv', 'verificaciones', 'VERIFICACION_NO_EVALUADA', `Verificación ${v.codigo} no evaluada`);
            } else if (v.cumple === false) {
                pushError('gnv', 'verificaciones', 'VERIFICACION_NO_CUMPLE', `Verificación ${v.codigo} NO CUMPLE`);
                const obs = (v.observacion || '').trim();
                if (!obs) {
                    pushError('gnv', 'observaciones', 'CAMPO_REQUERIDO', `Verificación ${v.codigo} NO CUMPLE pero no tiene observación`);
                }
            }
        });
    }

    // GLP Especifico
    if (cert.tipo_clave === 'GLP_ANUAL') {
        const rGlp = await db.query('SELECT * FROM fg_certificado_glp WHERE certificado_id = $1', [id]);
        if (rGlp.rowCount === 0) {
            pushError('glp', 'general', 'SECCION_FALTANTE', 'Faltan datos de GLP');
        } else {
            const g = rGlp.rows[0];
            if (!g.taller_autorizado_id) pushError('glp', 'taller_autorizado_id', 'CAMPO_REQUERIDO', 'Taller autorizado requerido');
            if (!g.vigencia_hasta) pushError('glp', 'vigencia_hasta', 'CAMPO_REQUERIDO', 'Vigencia requerida');
            if (!g.expediente_tecnico) pushError('glp', 'expediente_tecnico', 'CAMPO_REQUERIDO', 'Expediente técnico requerido');
            // Modalidad requerida
            if (!g.modalidad || !['INICIAL', 'ANUAL'].includes(g.modalidad)) {
                pushError('glp', 'modalidad', 'CAMPO_REQUERIDO', 'Modalidad GLP requerida (INICIAL o ANUAL)');
            } else if (g.modalidad === 'INICIAL') {
                pushError('glp', 'formato', 'FORMATO_INICIAL_PENDIENTE', 'La captura GLP INICIAL está habilitada, pero su formato de emisión todavía no está configurado');
            }
        }

        const rComp = await db.query('SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = $1', [id]);
        const compTypes = rComp.rows.map(c => c.componente);
        if (!compTypes.includes('CILINDRO')) pushError('glp', 'componentes', 'COMPONENTE_REQUERIDO', 'Se requiere al menos 1 CILINDRO');
        if (!compTypes.includes('REGULADOR')) pushError('glp', 'componentes', 'COMPONENTE_REQUERIDO', 'Se requiere al menos 1 REGULADOR');
        
        rComp.rows.forEach(c => {
            if (!c.marca) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', `Marca requerida para componente ${c.componente}`);
            if (!c.modelo) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', `Modelo requerido para componente ${c.componente}`);
            if (c.componente === 'CILINDRO') {
                if (!c.numero_serie) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Serie requerida para CILINDRO');
                if (!c.capacidad_litros) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Capacidad requerida para CILINDRO');
                if (!c.mes_fabricacion) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Mes fabricación requerido para CILINDRO');
                if (!c.anio_fabricacion) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Año fabricación requerido para CILINDRO');
            }
        });

        const rVer = await db.query('SELECT * FROM fg_certificado_glp_verificacion WHERE certificado_id = $1', [id]);
        const verifCodes = rVer.rows.map(v => v.codigo);
        const reqCodes = ['1','2','3','4','5','6','7'];
        const missing = reqCodes.filter(c => !verifCodes.includes(c));
        if (missing.length > 0) {
            pushError('glp', 'verificaciones', 'VERIFICACIONES_INCOMPLETAS', 'Faltan verificaciones GLP: ' + missing.join(', '));
        }

        rVer.rows.forEach(v => {
            if (v.cumple === null) {
                pushError('glp', 'verificaciones', 'VERIFICACION_NO_EVALUADA', `Verificación ${v.codigo} no evaluada`);
            } else if (v.cumple === false) {
                pushError('glp', 'verificaciones', 'VERIFICACION_NO_CUMPLE', `Verificación ${v.codigo} NO CUMPLE`);
                const obs = (v.observacion || '').trim();
                if (!obs) {
                    pushError('glp', 'observaciones', 'CAMPO_REQUERIDO', `Verificación ${v.codigo} NO CUMPLE pero no tiene observación`);
                }
            }
        });
    }

    // Conformidad Especifico
    if (cert.tipo_clave === 'CONFORMIDAD') {
        const rConf = await db.query('SELECT * FROM fg_certificado_conformidad WHERE certificado_id = $1', [id]);
        if (rConf.rowCount === 0) {
            pushError('conformidad', 'general', 'SECCION_FALTANTE', 'Faltan datos de Conformidad');
        } else {
            const c = rConf.rows[0];
            const validTipos = ['MODIFICACION', 'MONTAJE', 'FABRICACION'];
            if (!validTipos.includes(c.tipo_conformidad)) pushError('conformidad', 'tipo_conformidad', 'TIPO_INVALIDO', 'Tipo de conformidad inválido');
            if (!c.tipo_tramite) pushError('conformidad', 'tipo_tramite', 'CAMPO_REQUERIDO', 'Tipo trámite requerido');
            if (!c.caracteristica_registrable) pushError('conformidad', 'caracteristica_registrable', 'CAMPO_REQUERIDO', 'Característica registrable requerida');
            if (!c.motivo) pushError('conformidad', 'motivo', 'CAMPO_REQUERIDO', 'Motivo requerido');
            if (!c.descripcion) pushError('conformidad', 'descripcion', 'CAMPO_REQUERIDO', 'Descripción requerida');
            if (!c.uso_original_vehiculo) pushError('conformidad', 'uso_original_vehiculo', 'CAMPO_REQUERIDO', 'Uso original requerido');
        }
    }

    return {
        valido: errores.length === 0,
        errores,
        modoFacturacion: facturacionSimulada ? 'SIMULACION' : 'NUBEFACT'
    };
};

exports.emitirCertificado = async (id, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        // Bloquear certificado FOR UPDATE
        const rCert = await client.query(`
            SELECT c.*, t.clave as tipo_clave, t.codigo as tipo_codigo, t.ancho_correlativo,
                   CASE WHEN t.clave = 'CONFORMIDAD' THEN 'UNICA' ELSE s.modalidad END AS modalidad_correlativo
            FROM fg_certificado c
            JOIN fg_tipo_certificado t ON c.tipo_certificado_clave = t.clave
            LEFT JOIN fg_tarifa ta ON ta.codigo = c.tarifa_codigo AND ta.planta_key = c.planta_key
            LEFT JOIN fg_servicio s ON s.id = ta.servicio_id
            WHERE c.id = $1 FOR UPDATE OF c
        `, [id]);
        
        if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCert.rows[0];

        // Validar acceso
        const { validarAccesoCertificado } = require('./faregas-auth.service');
        if(typeof validarAccesoCertificado === 'function') {
            await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
        } else {
           // fallback auth check
           const { getPlantasPorUsuario } = require('./faregas-auth.service');
           const pRes = await getPlantasPorUsuario(userContext.username, userContext.perfil_id);
           const pKeys = pRes.map(p => p.key);
           if(!pKeys.includes(cert.planta_key)) throw new Error('PLANTA_NO_AUTORIZADA');
        }

        if (cert.estado !== 'BORRADOR') throw new Error('ESTADO_INVALIDO');

        // Validar emisión internamente
        const valRes = await exports.validarEmision(id, userContext);
        if (!valRes.valido) throw new Error('NO_VALIDO_PARA_EMISION');

        // La previsualizacion reserva el correlativo real una sola vez. Si por
        // compatibilidad el borrador aun no tiene numero, se reserva aqui.
        let numero_certificado = cert.numero_certificado;
        if (!numero_certificado) {
            const rCorrelativo = await client.query(`
                SELECT * FROM fg_correlativo_certificado
                WHERE planta_key = $1 AND tipo_certificado_clave = $2
                  AND modalidad = $3 AND activo = true
                FOR UPDATE
            `, [cert.planta_key, cert.tipo_clave, cert.modalidad_correlativo]);

            if (rCorrelativo.rowCount === 0) throw new Error('NO_EXISTE_RANGO_ACTIVO');
            const rango = rCorrelativo.rows[0];
            if (rango.nro_actual >= rango.nro_maximo) throw new Error('RANGO_AGOTADO');

            const siguiente = parseInt(rango.nro_actual) + 1;
            if (siguiente > rango.nro_maximo) throw new Error('RANGO_AGOTADO');

            if (!cert.tipo_codigo || !cert.ancho_correlativo) {
                throw new Error('CONFIGURACION_NUMERACION_INCOMPLETA');
            }

            let ancho = Number(cert.ancho_correlativo);

            const numeroFormateado = String(siguiente).padStart(ancho, '0');
            numero_certificado = `DG-${cert.tipo_codigo}-${numeroFormateado}`;

            await client.query(`
                UPDATE fg_correlativo_certificado
                SET nro_actual = $1, fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [siguiente, rango.id]);
        }

        // Update certificado
        await client.query(`
            UPDATE fg_certificado
            SET estado = 'EMITIDO',
                numero_certificado = $1,
                fecha_emision = CURRENT_TIMESTAMP,
                usuario_modificacion = $2,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [numero_certificado, userContext.username, id]);

        await client.query('COMMIT');
        
        return {
            numero_certificado
        };

    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

/**
 * Reserva de forma atomica el numero que se mostrara en la previsualizacion.
 * La reserva queda persistida en fg_certificado y las siguientes consultas,
 * incluida la emision, reutilizan exactamente el mismo numero.
 */
exports.reservarNumeroPrevisualizacion = async (id, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const rCert = await client.query(`
            SELECT c.*, t.clave AS tipo_clave, t.codigo AS tipo_codigo, t.ancho_correlativo,
                   s.id AS servicio_id, s.tipo_flujo AS servicio_tipo_flujo,
                   CASE WHEN t.clave = 'CONFORMIDAD' THEN 'UNICA' ELSE s.modalidad END AS modalidad_correlativo
            FROM fg_certificado c
            JOIN fg_tipo_certificado t ON t.clave = c.tipo_certificado_clave
            LEFT JOIN fg_tarifa ta ON ta.codigo = c.tarifa_codigo AND ta.planta_key = c.planta_key
            LEFT JOIN fg_servicio s ON s.id = ta.servicio_id
            WHERE c.id = $1
            FOR UPDATE OF c
        `, [id]);

        if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCert.rows[0];
        await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);

        
        if (!cert.formato_version_id && cert.servicio_id) {
            const resFmt = await client.query('SELECT formato_id FROM fg_servicio WHERE id = $1', [cert.servicio_id]);
            if (resFmt.rowCount > 0 && resFmt.rows[0].formato_id) {
                const resV = await client.query('SELECT id FROM fg_certificado_formato_version WHERE formato_id = $1 AND estado = $2 ORDER BY version DESC LIMIT 1', [resFmt.rows[0].formato_id, 'VIGENTE']);
                if (resV.rowCount > 0) {
                    await client.query('UPDATE fg_certificado SET formato_version_id = $1 WHERE id = $2', [resV.rows[0].id, id]);
                    cert.formato_version_id = resV.rows[0].id;
                }
            }
        }
        
        if (cert.numero_certificado) {
            await client.query('COMMIT');
            return cert.numero_certificado;
        }
        if (cert.estado !== 'BORRADOR') throw new Error('ESTADO_INVALIDO');
        if (!cert.modalidad_correlativo) throw new Error('FORMATO_NUMERO_NO_CONFIGURADO');

        const rCorrelativo = await client.query(`
            SELECT * FROM fg_correlativo_certificado
            WHERE planta_key = $1 AND tipo_certificado_clave = $2
              AND modalidad = $3 AND activo = true
            FOR UPDATE
        `, [cert.planta_key, cert.tipo_clave, cert.modalidad_correlativo]);
        if (rCorrelativo.rowCount === 0) throw new Error('NO_EXISTE_RANGO_ACTIVO');

        const rango = rCorrelativo.rows[0];
        const siguiente = Number(rango.nro_actual) + 1;
        if (!Number.isSafeInteger(siguiente) || siguiente > Number(rango.nro_maximo)) {
            throw new Error('RANGO_AGOTADO');
        }

        if (!cert.tipo_codigo || !cert.ancho_correlativo) {
            throw new Error('CONFIGURACION_NUMERACION_INCOMPLETA');
        }
        let ancho = Number(cert.ancho_correlativo);

        const numeroCertificado = `DG-${cert.tipo_codigo}-${String(siguiente).padStart(ancho, '0')}`;
        await client.query(`
            UPDATE fg_correlativo_certificado
            SET nro_actual = $1, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [siguiente, rango.id]);
        await client.query(`
            UPDATE fg_certificado
            SET numero_certificado = $1,
                usuario_modificacion = $2,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [numeroCertificado, userContext.username, id]);

        await client.query('COMMIT');
        return numeroCertificado;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const generateGnvAnualHtml = require('../templates/gnv-anual.template');
const generateGnvInicialHtml = require('../templates/gnv-inicial.template');
const generateGlpAnualHtml = require('../templates/glp-anual.template');
const generateGlpInicialHtml = require('../templates/glp-inicial.template');
const generateConformidadHtml = require('../templates/conformidad.template');

exports.obtenerPrevisualizacion = async (id, userContext) => {
    await exports.reservarNumeroPrevisualizacion(id, userContext);
    const borrador = await exports.obtenerBorradorCompleto(id, userContext);
    const tipoClave = borrador.tipo ? borrador.tipo.clave : null;
    const vehiculoPlantilla = paraPlantilla(borrador.vehiculo || {});
    // La previsualizacion conserva la marca de agua, pero muestra el numero
    // real reservado para este borrador. Emitir reutiliza el mismo correlativo.
    const modoPlantilla = borrador.estado === 'EMITIDO' ? 'FINAL' : 'PREVIEW';
    const cabeceraComun = {
        id: borrador.id,
        numero_certificado: borrador.numeroCertificado,
        placa_nueva: vehiculoPlantilla.placa,
        fecha_emision: borrador.fechaEmision,
        observaciones: borrador.observaciones,
        entidad_certificadora_nombre: borrador.entidadCertificadoraNombre,
        resolucion_directoral: borrador.resolucionDirectoral,
        domicilio_fiscal: borrador.domicilioFiscal,
        telefono_certificadora: borrador.telefonoCertificadora,
        lugar_emision: borrador.lugarEmision
    };

    // Una operación con formato HTML propio se renderiza desde su versión y su
    // snapshot dinámico, aunque reutilice una clave técnica base GNV/GLP para
    // correlativos. La clave base no debe imponerle el formulario vehicular.
    if (borrador.servicio?.tipoFlujo === 'TALLER_INSPECCION' && borrador.formatoVersionId) {
        const dataFormato = buildFormatoData(borrador);
        const { data: html } = await formatosService.renderVersion(borrador.formatoVersionId, dataFormato);
        return { html, tipo: tipoClave };
    }

    if (tipoClave === 'GNV_ANUAL') {
        const dataGnv = await exports.obtenerGNV(id, userContext);
        const gnv = dataGnv.gnv || {};
        if (gnv.modalidad === 'INICIAL') {
            const html = generateGnvInicialHtml({
                cabecera: cabeceraComun,
                vehiculo: vehiculoPlantilla,
                propietario: borrador.titulares && borrador.titulares.length > 0 ? borrador.titulares[0] : {},
                gnv: { ...gnv, componentes: dataGnv.componentes },
                componentes: dataGnv.componentes,
                taller: gnv.tallerAutorizado ? { nombre: gnv.tallerAutorizado.nombre } : {}
            }, { modo: modoPlantilla });
            return { html };
        }
        const html = generateGnvAnualHtml({
            cabecera: cabeceraComun,
            vehiculo: vehiculoPlantilla,
            gnv: gnv,
            verificaciones: dataGnv.verificaciones || [],
            titulares: borrador.titulares || []
        }, { modo: modoPlantilla });
        return { html, tipo: 'GNV_ANUAL' };
    } else if (tipoClave === 'GLP_ANUAL') {
        const dataGlp = await exports.obtenerGLP(id, userContext);
        const glp = dataGlp.glp || {};
        const templateData = {
            cabecera: {
                ...cabeceraComun,
                cliente_nombre: borrador.cliente?.nombreRazonSocial,
            },
            vehiculo: vehiculoPlantilla,
            glp: glp,
            componentes: dataGlp.componentes || [],
            verificaciones: dataGlp.verificaciones || [],
            titulares: borrador.titulares || []
        };
        
        let html;
        if (glp.modalidad === 'INICIAL') {
            html = generateGlpInicialHtml(templateData, { modo: modoPlantilla });
        } else {
            html = generateGlpAnualHtml(templateData, { modo: modoPlantilla });
        }
        return { html, tipo: 'GLP_ANUAL' };
    } else if (tipoClave === 'CONFORMIDAD') {
        const dataConf = await exports.obtenerConformidad(id, userContext);
        const html = generateConformidadHtml({
            cabecera: {
                ...cabeceraComun,
                cliente_nombre: borrador.cliente?.nombreRazonSocial,
            },
            vehiculo: vehiculoPlantilla,
            conformidad: dataConf.conformidad || {},
            titulares: borrador.titulares || []
        }, { modo: modoPlantilla });
        return { html, tipo: 'CONFORMIDAD' };
    } else {
        if (!borrador.formatoVersionId) {
            throw new Error('FORMATO_NUMERO_NO_CONFIGURADO');
        }
        const dataFormato = buildFormatoData(borrador);
        const { data: html } = await formatosService.renderVersion(borrador.formatoVersionId, dataFormato);
        return { html, tipo: tipoClave };
    }
};

const buildFormatoData = (borrador) => {
    const cli = borrador.cliente || {};
    const datos = combinarObjetos({
        certificado: {
            numero: borrador.numeroCertificado || '',
            fecha_emision: borrador.fechaEmision || new Date().toISOString().slice(0, 10),
            modalidad: borrador.servicio ? borrador.servicio.modalidad : '',
            titulo: borrador.tipo ? borrador.tipo.nombre : ''
        },
        taller: {
            nombre: borrador.entidadCertificadoraNombre || '',
            direccion: borrador.lugarEmision || '',
            telefono: borrador.telefonoCertificadora || '',
            representante_legal: '',
            numero_autorizacion: borrador.resolucionDirectoral || ''
        },
        empresa: {
            razon_social: cli.nombreRazonSocial || '',
            ruc: cli.nroDocumento || '',
            resolucion: borrador.resolucionDirectoral || '',
            direccion: borrador.domicilioFiscal || '',
            telefono: borrador.telefonoCertificadora || ''
        },
        inspeccion: {
            observaciones: borrador.observaciones || ''
        }
    }, borrador.formatoDatosSnapshot || {});

    // HTML usa objetos anidados. DOCX heredado puede usar la clave completa;
    // mantenemos ambos accesos sin duplicar información persistida.
    const aplanar = (objeto, prefijo = '') => Object.entries(objeto || {}).forEach(([clave, valor]) => {
        const ruta = prefijo ? `${prefijo}.${clave}` : clave;
        if (valor && typeof valor === 'object' && !Array.isArray(valor)) aplanar(valor, ruta);
        else datos[ruta] = valor;
    });
    aplanar(datos);
    return datos;
};


exports.obtenerOperacionesDisponibles = async (plantaKey) => {
    if (!plantaKey) throw new Error('plantaKey es requerido');
    
    const query = `
        SELECT 
            s.id,
            s.codigo,
            s.nombre,
            s.tipo_flujo,
            s.tipo_certificado_clave,
            s.modalidad AS formato,
            s.requiere_certificado AS genera_certificado,
            c.codigo AS categoria,
            t.precio
        FROM fg_servicio s
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        JOIN fg_tarifa t ON t.servicio_id = s.id
        WHERE s.activo = TRUE 
          AND t.planta_key = $1
          AND t.activo = TRUE
        ORDER BY s.orden, s.nombre
    `;
    const res = await db.query(query, [plantaKey]);
    return res.rows;
};

exports.guardarTaller = async (id, payload, user) => {
    const queryVerificar = `
        SELECT c.id, c.planta_key, c.estado, c.formato_datos_snapshot
        FROM fg_certificado c
        WHERE c.id = $1
    `;
    const resVerificar = await db.query(queryVerificar, [id]);
    
    if (resVerificar.rows.length === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    const cert = resVerificar.rows[0];
    
    await validarAccesoCertificado(user.username, user.perfil_id, cert.planta_key);
    
    if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

    const updateQuery = `
        UPDATE fg_certificado 
        SET 
            formato_datos_snapshot = $1,
            fecha_modificacion = NOW(),
            usuario_modificacion = $2
        WHERE id = $3
    `;
    
    // Conserva los demás grupos de variables del formato y reemplaza únicamente
    // los datos editados en este paso.
    const snapshot = { ...(cert.formato_datos_snapshot || {}) };
    if (payload.valores && typeof payload.valores === 'object' && !Array.isArray(payload.valores)) {
        Object.entries(payload.valores).forEach(([clave, valor]) => {
            if (!CLAVE_VARIABLE_FORMATO.test(clave) || ['__proto__', 'prototype', 'constructor'].some((parte) => clave.split('.').includes(parte))) return;
            asignarValorAnidado(snapshot, clave, valor === '' || valor === undefined ? null : valor);
        });
    } else {
        snapshot.taller = {
            nombre: payload.nombre || null,
            direccion: payload.direccion || null,
            telefono: payload.telefono || null,
            ciudad: payload.ciudad || null,
            representante_legal: payload.representanteLegal || null,
            numero_autorizacion: payload.numeroAutorizacion || null
        };
        snapshot.inspeccion = {
            observaciones: payload.observaciones || null,
            fecha_proxima_inspeccion: payload.fechaProximaInspeccion || null
        };
    }

    await db.query(updateQuery, [
        snapshot,
        user.username,
        id
    ]);
};

exports.obtenerTaller = async (id, user) => {
    const query = `
        SELECT c.id, c.planta_key, c.formato_datos_snapshot
        FROM fg_certificado c
        WHERE c.id = $1
    `;
    const result = await db.query(query, [id]);
    if (result.rows.length === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    
    const cert = result.rows[0];
    const tieneAcceso = await module.exports.verificarAccesoPlanta(user, cert.planta_key);
    if (!tieneAcceso) throw new Error('PLANTA_NO_AUTORIZADA');
    
    return cert.formato_datos_snapshot;
};
