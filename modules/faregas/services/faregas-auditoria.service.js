const db = require('../../../config/database');
const paginacion = require('./faregas-paginacion.rules');

const texto = (valor, maximo) => {
    if (valor === undefined || valor === null || valor === '') return null;
    return String(valor).trim().substring(0, maximo);
};

const obtenerIp = (req) => {
    const reenviada = req?.headers?.['x-forwarded-for'];
    const valor = Array.isArray(reenviada) ? reenviada[0] : reenviada;
    return texto(valor ? String(valor).split(',')[0] : (req?.ip || req?.socket?.remoteAddress), 45);
};

const CAMPOS_SENSIBLES = new Set([
    'password', 'contrasena', 'clave', 'hash', 'token', 'jwt',
    'secret', 'client_secret', 'api_key', 'apikey', 'private_key',
    'tarjeta_numero', 'card_number', 'cvv', 'cvc', 'pin', 'cert_content'
]);

const sanitizarObjeto = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizarObjeto);
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (CAMPOS_SENSIBLES.has(lowerKey) || lowerKey.includes('password') || lowerKey.includes('token') || lowerKey.includes('secret')) {
            sanitized[key] = '[PROTEGIDO]';
        } else if (value && typeof value === 'object') {
            sanitized[key] = sanitizarObjeto(value);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
};

// Cache para verificar qué columnas tiene la tabla fg_auditoria_acceso
let columnasAuditoriaCache = null;
const obtenerColumnasAuditoria = async () => {
    if (columnasAuditoriaCache) return columnasAuditoriaCache;
    try {
        const res = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'fg_auditoria_acceso';
        `);
        columnasAuditoriaCache = new Set(res.rows.map(r => r.column_name));
        return columnasAuditoriaCache;
    } catch (e) {
        return new Set(['id', 'username', 'evento', 'exitoso', 'mensaje', 'planta_key', 'ip_direccion', 'user_agent', 'fecha_evento', 'categoria', 'entidad', 'entidad_id', 'certificado_id', 'numero_certificado', 'placa', 'tipo_certificado', 'paso', 'datos', 'perfil']);
    }
};

// Cache en memoria para deduplicar eventos de guardado automático idénticos (3 segundos)
const ultimosEventos = new Map();
const esEventoDuplicadoAutosave = (key) => {
    const ahora = Date.now();
    const previo = ultimosEventos.get(key);
    if (previo && (ahora - previo) < 3000) {
        return true;
    }
    ultimosEventos.set(key, ahora);
    // Limpieza periódica
    if (ultimosEventos.size > 1000) {
        for (const [k, t] of ultimosEventos.entries()) {
            if (ahora - t > 10000) ultimosEventos.delete(k);
        }
    }
    return false;
};

exports.contextoRequest = (req, datos = {}) => ({
    usuario_id: req?.user?.id || req?.user?.usuario_id || null,
    username: req?.user?.username || null,
    perfil: req?.user?.perfil_id || req?.user?.perfil || null,
    planta_key: req?.user?.planta_key || req?.user?.plantaKey || null,
    ip_direccion: obtenerIp(req),
    user_agent: req?.headers?.['user-agent'] || null,
    correlacion_id: req?.headers?.['x-correlation-id'] || req?.headers?.['x-request-id'] || null,
    ...datos
});

exports.registrarEvento = async ({
    usuario_id,
    username,
    evento,
    exitoso = true,
    resultado = 'EXITO',
    mensaje,
    motivo_error,
    planta_key,
    ip_direccion,
    user_agent,
    perfil,
    categoria = 'ACCESO',
    modulo,
    entidad,
    entidad_id,
    certificado_id,
    numero_certificado,
    documento_referencia,
    placa,
    tipo_certificado,
    paso,
    es_automatico = false,
    correlacion_id,
    datos,
    datos_previos,
    datos_nuevos
}) => {
    try {
        // Deduplicación de autosave
        if (evento && (evento.includes('AUTOSAVE') || evento.includes('GUARDADO_PASO'))) {
            const dupKey = `${username}_${evento}_${certificado_id || entidad_id || ''}_${paso || ''}`;
            if (esEventoDuplicadoAutosave(dupKey)) {
                return;
            }
        }

        const moduloFinal = texto(modulo || categoria, 50) || 'ACCESOS';
        const categoriaFinal = texto(categoria, 50) || 'ACCESO';
        const docRefFinal = texto(documento_referencia || numero_certificado, 100);
        const resultadoFinal = exitoso ? texto(resultado, 20) || 'EXITO' : 'ERROR';
        const datosLimpios = sanitizarObjeto(datos);
        const previosLimpios = sanitizarObjeto(datos_previos);
        const nuevosLimpios = sanitizarObjeto(datos_nuevos);

        const columnas = await obtenerColumnasAuditoria();
        const tieneNuevasColumnas = columnas.has('modulo') && columnas.has('resultado');

        if (tieneNuevasColumnas) {
            await db.query(`
                INSERT INTO fg_auditoria_acceso (
                    username, evento, exitoso, mensaje, planta_key, ip_direccion, user_agent, perfil,
                    categoria, entidad, entidad_id, certificado_id, numero_certificado,
                    placa, tipo_certificado, paso, datos,
                    usuario_id, modulo, resultado, motivo_error, documento_referencia,
                    es_automatico, correlacion_id, datos_previos, datos_nuevos
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    COALESCE($8, (SELECT perfil_id FROM fg_usuario WHERE username = $1::varchar LIMIT 1)),
                    $9, $10, $11, $12, $13,
                    $14, $15, $16, $17::jsonb,
                    $18, $19, $20, $21, $22,
                    $23, $24, $25::jsonb, $26::jsonb
                )
            `, [
                texto(username, 255),
                texto(evento, 100),
                Boolean(exitoso),
                texto(mensaje, 4000),
                texto(planta_key, 20),
                texto(ip_direccion, 45),
                texto(user_agent, 1000),
                texto(perfil, 50),
                categoriaFinal,
                texto(entidad, 50),
                entidad_id ? Number(entidad_id) : null,
                certificado_id ? Number(certificado_id) : null,
                texto(numero_certificado, 80),
                texto(placa, 20)?.toUpperCase() || null,
                texto(tipo_certificado, 50),
                texto(paso, 50),
                datosLimpios ? JSON.stringify(datosLimpios) : null,
                usuario_id ? Number(usuario_id) : null,
                moduloFinal,
                resultadoFinal,
                texto(motivo_error, 2000),
                docRefFinal,
                Boolean(es_automatico),
                texto(correlacion_id, 100),
                previosLimpios ? JSON.stringify(previosLimpios) : null,
                nuevosLimpios ? JSON.stringify(nuevosLimpios) : null
            ]);
        } else {
            // Compatibilidad si la migración aún no se ejecutó en la base
            await db.query(`
                INSERT INTO fg_auditoria_acceso (
                    username, evento, exitoso, mensaje, planta_key, ip_direccion, user_agent, perfil,
                    categoria, entidad, entidad_id, certificado_id, numero_certificado,
                    placa, tipo_certificado, paso, datos
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    COALESCE($8, (SELECT perfil_id FROM fg_usuario WHERE username = $1::varchar LIMIT 1)),
                    $9, $10, $11, $12, $13,
                    $14, $15, $16, $17::jsonb
                )
            `, [
                texto(username, 255),
                texto(evento, 50),
                Boolean(exitoso),
                texto(mensaje, 4000),
                texto(planta_key, 20),
                texto(ip_direccion, 45),
                texto(user_agent, 1000),
                texto(perfil, 50),
                categoriaFinal.substring(0, 30),
                texto(entidad, 50),
                entidad_id ? Number(entidad_id) : null,
                certificado_id ? Number(certificado_id) : null,
                texto(numero_certificado, 80),
                texto(placa, 20)?.toUpperCase() || null,
                texto(tipo_certificado, 50),
                texto(paso, 50),
                datosLimpios ? JSON.stringify(datosLimpios) : null
            ]);
        }
    } catch (error) {
        console.error('Error crítico al registrar auditoría en FAREGAS:', error);
    }
};

exports.registrarEventoCertificado = async (datosEvento) => {
    try {
        const certificadoId = Number(datosEvento.certificado_id || datosEvento.certificadoId);
        if (!Number.isInteger(certificadoId) || certificadoId <= 0) {
            return exports.registrarEvento(datosEvento);
        }

        const result = await db.query(`
            SELECT
                c.id,
                c.numero_certificado,
                c.planta_key,
                c.tipo_certificado_clave,
                c.paso_actual,
                v.placa
            FROM fg_certificado c
            LEFT JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
            WHERE c.id = $1
        `, [certificadoId]);
        const certificado = result.rows[0] || {};

        return exports.registrarEvento({
            ...datosEvento,
            categoria: datosEvento.categoria || 'CERTIFICADO',
            modulo: datosEvento.modulo || 'CERTIFICADOS',
            entidad: datosEvento.entidad || 'fg_certificado',
            entidad_id: datosEvento.entidad_id || certificadoId,
            certificado_id: certificadoId,
            numero_certificado: datosEvento.numero_certificado || certificado.numero_certificado,
            documento_referencia: datosEvento.documento_referencia || datosEvento.numero_certificado || certificado.numero_certificado,
            planta_key: datosEvento.planta_key || certificado.planta_key,
            placa: datosEvento.placa || certificado.placa,
            tipo_certificado: datosEvento.tipo_certificado || certificado.tipo_certificado_clave,
            paso: datosEvento.paso || certificado.paso_actual
        });
    } catch (error) {
        console.error('Error al enriquecer auditoría de certificado FAREGAS:', error);
        return exports.registrarEvento(datosEvento);
    }
};

const CATEGORIAS_MODULOS = {
    INICIO: ['CERTIFICADO', 'PAGO', 'FACTURACION', 'OPERACION'],
    CERTIFICADOS: ['CERTIFICADO', 'CERTIFICADOS'],
    BORRADORES: ['BORRADORES', 'CERTIFICADO'],
    DUPLICADOS: ['DUPLICADOS', 'CERTIFICADO'],
    RECTIFICACIONES: ['RECTIFICACIONES', 'CERTIFICADO'],
    FACTURACION: ['FACTURACION', 'COMPROBANTES'],
    NOTAS_CREDITO: ['NOTAS_CREDITO', 'FACTURACION'],
    ANULACIONES: ['ANULACIONES', 'FACTURACION', 'CERTIFICADO'],
    PAGOS: ['PAGO', 'PAGOS'],
    CREDITOS: ['CREDITOS', 'CREDITO', 'CUOTAS'],
    INVENTARIO: ['INVENTARIO', 'CHIP', 'CHIPS'],
    DESCUENTOS: ['DESCUENTO', 'DESCUENTOS'],
    USUARIOS: ['USUARIOS', 'USUARIO'],
    PERFILES: ['PERFILES', 'PERMISOS', 'PERFIL'],
    CONFIGURACION: ['CONFIGURACION', 'TARIFA', 'SERVICIO', 'PRODUCTO'],
    ACCESOS: ['ACCESO', 'ACCESOS', 'SESION', 'SESIONES'],
    SOLICITUDES: ['SOLICITUDES', 'SOLICITUD'],
    MULTISEDE: ['MULTISEDE', 'SEDE', 'PLANTAS', 'PLANTA']
};

const armarFiltrosAuditoria = async (filtros) => {
    const {
        username, evento, exitoso, fechaInicio, fechaFin,
        categoria, placa, certificadoId, plantaKey, buscar, modulo, resultado
    } = filtros;

    // Obligatorio: Validar rango con máximo 1 mes calendario
    const rango = paginacion.normalizarRangoFechas({
        fechaDesde: fechaInicio ?? filtros.desde,
        fechaHasta: fechaFin ?? filtros.hasta
    }, { maximoUnMes: true });

    let whereSql = ' WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    // Filtro por rango de fechas (máximo 1 mes garantizado)
    whereSql += ` AND a.fecha_evento >= $${paramIndex}::date`;
    params.push(rango.fechaDesde);
    paramIndex++;

    whereSql += ` AND a.fecha_evento < $${paramIndex}::date + INTERVAL '1 day'`;
    params.push(rango.fechaHasta);
    paramIndex++;

    if (username) {
        whereSql += ` AND a.username ILIKE $${paramIndex}`;
        params.push(`%${username.trim()}%`);
        paramIndex++;
    }

    if (evento) {
        whereSql += ` AND a.evento = $${paramIndex}`;
        params.push(evento.trim());
        paramIndex++;
    }

    if (categoria) {
        whereSql += ` AND a.categoria = $${paramIndex}`;
        params.push(categoria.trim());
        paramIndex++;
    }

    if (modulo && modulo !== 'TODOS') {
        const modUpper = String(modulo).trim().toUpperCase();
        const categorias = CATEGORIAS_MODULOS[modUpper] || [modUpper];

        if (modUpper === 'BORRADORES') {
            whereSql += ` AND (COALESCE(a.modulo, '') = 'BORRADORES' OR (a.categoria = 'CERTIFICADO' AND a.evento ILIKE '%BORRADOR%'))`;
        } else if (modUpper === 'DUPLICADOS') {
            whereSql += ` AND (COALESCE(a.modulo, '') = 'DUPLICADOS' OR (a.categoria = 'CERTIFICADO' AND a.evento ILIKE '%DUPLICADO%'))`;
        } else if (modUpper === 'RECTIFICACIONES') {
            whereSql += ` AND (COALESCE(a.modulo, '') = 'RECTIFICACIONES' OR (a.categoria = 'CERTIFICADO' AND a.evento ILIKE '%RECTIFICAC%'))`;
        } else if (modUpper === 'NOTAS_CREDITO') {
            whereSql += ` AND (COALESCE(a.modulo, '') = 'NOTAS_CREDITO' OR a.evento ILIKE '%NOTA_CREDITO%')`;
        } else if (modUpper === 'ANULACIONES') {
            whereSql += ` AND (COALESCE(a.modulo, '') = 'ANULACIONES' OR a.evento ILIKE '%ANULA%')`;
        } else if (modUpper === 'CREDITOS') {
            whereSql += ` AND (COALESCE(a.modulo, '') = 'CREDITOS' OR a.evento ILIKE '%CREDITO%' OR a.evento ILIKE '%CUOTA%')`;
        } else if (modUpper === 'SOLICITUDES') {
            whereSql += ` AND (COALESCE(a.modulo, '') = 'SOLICITUDES' OR a.categoria = 'SOLICITUDES' OR a.evento ILIKE '%SOLICITUD%')`;
        } else if (modUpper === 'MULTISEDE') {
            whereSql += ` AND (COALESCE(a.modulo, '') = 'MULTISEDE' OR a.evento ILIKE '%PLANTA%' OR a.evento ILIKE '%SEDE%')`;
        } else {
            whereSql += ` AND (COALESCE(a.modulo, '') = $${paramIndex} OR a.categoria = ANY($${paramIndex + 1}::varchar[]))`;
            params.push(modUpper, categorias);
            paramIndex += 2;
        }
    }

    if (placa) {
        whereSql += ` AND a.placa ILIKE $${paramIndex}`;
        params.push(`%${placa.trim()}%`);
        paramIndex++;
    }

    if (certificadoId) {
        whereSql += ` AND a.certificado_id = $${paramIndex}`;
        params.push(Number(certificadoId));
        paramIndex++;
    }

    if (plantaKey) {
        whereSql += ` AND a.planta_key = $${paramIndex}`;
        params.push(plantaKey.trim());
        paramIndex++;
    }

    if (buscar) {
        whereSql += ` AND (
            COALESCE(a.numero_certificado, '') ILIKE $${paramIndex}
            OR COALESCE(a.placa, '') ILIKE $${paramIndex}
            OR COALESCE(a.mensaje, '') ILIKE $${paramIndex}
            OR COALESCE(a.documento_referencia, '') ILIKE $${paramIndex}
            OR COALESCE(a.certificado_id::text, '') ILIKE $${paramIndex}
        )`;
        params.push(`%${buscar.trim()}%`);
        paramIndex++;
    }

    if (exitoso !== undefined && exitoso !== '') {
        whereSql += ` AND a.exitoso = $${paramIndex}`;
        params.push(exitoso === 'true' || exitoso === true);
        paramIndex++;
    }

    if (resultado) {
        whereSql += ` AND COALESCE(a.resultado, CASE WHEN a.exitoso THEN 'EXITO' ELSE 'ERROR' END) = $${paramIndex}`;
        params.push(String(resultado).trim().toUpperCase());
        paramIndex++;
    }

    return { whereSql, params, paramIndex, rango };
};

exports.listarAccesos = async (filtros) => {
    const { whereSql, params, paramIndex, rango: _rango } = await armarFiltrosAuditoria(filtros);

    const conteo = await db.query(
        `SELECT COUNT(*)::int AS total FROM fg_auditoria_acceso a${whereSql}`,
        params
    );

    const { page, limit, offset } = paginacion.normalizarPaginacion(filtros);

    const query = `
        SELECT
            a.id,
            a.username,
            a.evento,
            a.exitoso,
            a.mensaje,
            a.planta_key,
            a.ip_direccion,
            a.user_agent,
            a.fecha_evento,
            a.categoria,
            COALESCE(a.modulo, a.categoria) AS modulo,
            COALESCE(a.resultado, CASE WHEN a.exitoso THEN 'EXITO' ELSE 'ERROR' END) AS resultado,
            a.motivo_error,
            COALESCE(a.documento_referencia, a.numero_certificado) AS documento_referencia,
            COALESCE(a.es_automatico, false) AS es_automatico,
            a.entidad,
            a.entidad_id,
            a.certificado_id,
            a.numero_certificado,
            a.placa,
            a.tipo_certificado,
            a.paso,
            a.datos,
            a.datos_previos,
            a.datos_nuevos,
            a.perfil
        FROM fg_auditoria_acceso a
        ${whereSql}
        ORDER BY a.fecha_evento DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    params.push(limit, offset);

    const result = await db.query(query, params);
    return paginacion.respuestaPaginada(
        result.rows,
        Number(conteo.rows[0]?.total || 0),
        page,
        limit
    );
};

/**
 * Exporta los registros de auditoría que coinciden con los filtros en formato CSV
 * optimizado para Excel en español con UTF-8 BOM y límite de seguridad de 10,000 filas.
 */
exports.exportarAuditoriaCsv = async (filtros, metaUsuario = {}) => {
    const { whereSql, params, rango } = await armarFiltrosAuditoria(filtros);

    const LIMITE_EXPORTACION = 10000;
    const query = `
        SELECT
            a.id,
            a.fecha_evento,
            a.username,
            a.perfil,
            a.planta_key,
            COALESCE(a.modulo, a.categoria) AS modulo,
            a.evento,
            a.mensaje,
            a.entidad,
            a.entidad_id,
            COALESCE(a.documento_referencia, a.numero_certificado, a.placa, '') AS referencia,
            COALESCE(a.resultado, CASE WHEN a.exitoso THEN 'EXITO' ELSE 'ERROR' END) AS resultado,
            COALESCE(a.motivo_error, '') AS motivo_error,
            COALESCE(a.es_automatico, false) AS es_automatico
        FROM fg_auditoria_acceso a
        ${whereSql}
        ORDER BY a.fecha_evento DESC
        LIMIT ${LIMITE_EXPORTACION};
    `;

    const result = await db.query(query, params);
    const filas = result.rows;

    const escaparCsv = (valor) => {
        if (valor === null || valor === undefined) return '';
        const s = String(valor).replace(/"/g, '""');
        return `"${s}"`;
    };

    // Encabezados con metadatos de los filtros
    const ahoraLima = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' });
    const lineas = [
        `# REPORTE DE AUDITORÍA — FAREGAS`,
        `# Período: ${rango.fechaDesde} al ${rango.fechaHasta} (Máximo 1 mes calendario)`,
        `# Módulo: ${filtros.modulo || 'TODOS'} | Filtro Búsqueda: ${filtros.buscar || 'NINGUNO'}`,
        `# Generado por: ${metaUsuario.username || 'USUARIO'} | Fecha de emisión: ${ahoraLima}`,
        `# Total registros exportados: ${filas.length} (Tope máximo de seguridad: ${LIMITE_EXPORTACION})`,
        ``
    ];

    const cabeceras = [
        'ID Evento',
        'Fecha y Hora (Lima)',
        'Usuario',
        'Perfil',
        'Sede',
        'Módulo',
        'Acción',
        'Descripción',
        'Entidad Afectada',
        'ID Registro',
        'Referencia / Documento',
        'Resultado',
        'Motivo de Error',
        'Automático / Worker'
    ];
    lineas.push(cabeceras.map(escaparCsv).join(';'));

    for (const r of filas) {
        const fechaLima = new Date(r.fecha_evento).toLocaleString('es-PE', { timeZone: 'America/Lima' });
        const fila = [
            r.id,
            fechaLima,
            r.username || '-',
            r.perfil || '-',
            r.planta_key || '-',
            r.modulo || '-',
            r.evento || '-',
            r.mensaje || '-',
            r.entidad || '-',
            r.entidad_id || '-',
            r.referencia || '-',
            r.resultado || (r.exitoso ? 'EXITO' : 'ERROR'),
            r.motivo_error || '',
            r.es_automatico ? 'SI (WORKER)' : 'NO (USUARIO)'
        ];
        lineas.push(fila.map(escaparCsv).join(';'));
    }

    // Prefijo UTF-8 BOM para apertura perfecta en Microsoft Excel
    return '\uFEFF' + lineas.join('\r\n');
};
