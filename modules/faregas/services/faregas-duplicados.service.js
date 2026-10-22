const db = require('../../../config/database');
const authService = require('./faregas-auth.service');
const certificadosService = require('./faregas-certificados.service');
const clientesService = require('./faregas-clientes.service');
const pagosService = require('./faregas-pagos.service');
const facturacionService = require('./faregas-facturacion.service');
const { agregarMarcaDuplicado } = require('./faregas-duplicado-pdf.service');

const PRECIO_DUPLICADO = 50;
const BASE_DUPLICADO = 42.37;
const IGV_DUPLICADO = 7.63;
const HISTORIAL_POR_PAGINA = 10;

const errorNegocio = (codigo, statusCode = 400, detalles) => {
    const error = new Error(codigo);
    error.code = codigo;
    error.statusCode = statusCode;
    error.detalles = detalles;
    return error;
};

const normalizarPlaca = (valor) => String(valor || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizarFechaFiltro = (valor) => {
    const fecha = String(valor || '').trim();
    if (!fecha) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw errorNegocio('FECHA_HISTORIAL_INVALIDA', 400);
    const date = new Date(`${fecha}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== fecha) {
        throw errorNegocio('FECHA_HISTORIAL_INVALIDA', 400);
    }
    return fecha;
};
const normalizarTipoFiltro = (valor) => {
    const filtro = String(valor || 'TODOS').trim().toUpperCase();
    if (!filtro || filtro === 'TODOS') return { clave: null, modalidad: null };
    const [clave, modalidad = 'ANUAL'] = filtro.split(':');
    if (!/^(GLP|GNV)/.test(clave) || !/^(INICIAL|ANUAL)$/.test(modalidad)) {
        throw errorNegocio('TIPO_CERTIFICADO_INVALIDO', 400);
    }
    return { clave, modalidad };
};

const etiquetaTipo = (clave, modalidad) => {
    const familia = String(clave || '').toUpperCase().startsWith('GNV') ? 'GNV' : 'GLP';
    return `Certificado ${String(modalidad || 'ANUAL').toUpperCase() === 'INICIAL' ? 'Inicial' : 'Anual'} ${familia}`;
};

const validarAccesoPlanta = async (userContext, plantaKey) => {
    const acceso = await authService.validarAccesoPlanta(
        userContext?.username,
        userContext?.perfil_id,
        plantaKey
    );
    if (!acceso) throw errorNegocio('PLANTA_NO_AUTORIZADA', 403);
};

const mapearCandidato = (row) => ({
    certificadoId: Number(row.certificado_id),
    numeroCertificado: row.numero_certificado,
    placa: row.placa,
    tipoCertificadoClave: row.tipo_certificado_clave,
    modalidad: row.modalidad,
    tipoNombre: etiquetaTipo(row.tipo_certificado_clave, row.modalidad),
    fechaEmision: row.fecha_emision,
    fechaLimiteDuplicado: row.fecha_limite_duplicado,
    vigente: row.vigente === true,
    anulacionAceptada: row.anulacion_aceptada === true,
    duplicable: row.vigente === true && row.anulacion_aceptada !== true,
    duplicadosEmitidosCount: Number(row.duplicados_emitidos_count || 0),
    motivoNoDisponible: row.anulacion_aceptada === true
        ? 'El certificado fue anulado.'
        : row.vigente !== true ? 'El certificado superó un año desde su emisión.' : null,
    plantaKey: row.planta_key,
    plantaNombre: row.planta_nombre,
    cliente: {
        tipoDocumento: row.cliente_tipo_documento || '',
        nroDocumento: row.cliente_documento || '',
        nombreRazonSocial: row.cliente_nombre || '',
        direccion: row.cliente_direccion || '',
        email: row.cliente_email || '',
        telefono: row.cliente_telefono || ''
    }
});

const consultarUltimosEmitidos = async ({ placa, tipo, plantaKey }, queryable = db) => {
    const placaNormalizada = normalizarPlaca(placa);
    if (placaNormalizada.length < 5 || placaNormalizada.length > 10) {
        throw errorNegocio('PLACA_INVALIDA', 400);
    }
    const filtro = normalizarTipoFiltro(tipo);
    const result = await queryable.query(`
        WITH candidatos AS (
            SELECT c.id AS certificado_id, c.numero_certificado, c.tipo_certificado_clave,
                   c.planta_key, p.nombre AS planta_nombre,
                   v.placa,
                   COALESCE(NULLIF(UPPER(BTRIM(s.modalidad)), ''), 'ANUAL') AS modalidad,
                   to_char(c.fecha_emision, 'YYYY-MM-DD') AS fecha_emision,
                   to_char(c.fecha_emision + INTERVAL '1 year', 'YYYY-MM-DD') AS fecha_limite_duplicado,
                   CURRENT_DATE <= (c.fecha_emision + INTERVAL '1 year')::date AS vigente,
                   EXISTS (
                       SELECT 1
                       FROM fg_facturacion fac
                       JOIN fg_documento_anulacion anu ON anu.facturacion_id = fac.id
                       WHERE fac.certificado_id = c.id AND anu.estado = 'ACEPTADO'
                   ) AS anulacion_aceptada,
                   COALESCE(tit.tipo_documento, fac_original.tipo_documento_cliente) AS cliente_tipo_documento,
                   COALESCE(tit.nro_documento, fac_original.nro_documento) AS cliente_documento,
                   COALESCE(tit.nombre_razon_social, fac_original.nombre_razon_social) AS cliente_nombre,
                   COALESCE(tit.direccion, fac_original.direccion) AS cliente_direccion,
                   fac_original.email AS cliente_email,
                   fac_original.telefono AS cliente_telefono,
                   (
                       SELECT COUNT(*)::int
                       FROM fg_certificado_duplicado dup
                       WHERE dup.certificado_original_id = c.id
                         AND dup.estado = 'DISPONIBLE'
                   ) AS duplicados_emitidos_count,
                   ROW_NUMBER() OVER (
                       PARTITION BY c.tipo_certificado_clave,
                                    COALESCE(NULLIF(UPPER(BTRIM(s.modalidad)), ''), 'ANUAL')
                       ORDER BY c.fecha_emision DESC, c.id DESC
                   ) AS posicion
            FROM fg_certificado c
            JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
            JOIN fg_planta p ON p.key = c.planta_key
            LEFT JOIN fg_tarifa ta ON ta.codigo = c.tarifa_codigo AND ta.planta_key = c.planta_key
            LEFT JOIN fg_servicio s ON s.id = ta.servicio_id
            LEFT JOIN fg_certificado_titular tit ON tit.certificado_id = c.id AND tit.orden = 1
            LEFT JOIN fg_facturacion fac_original ON fac_original.certificado_id = c.id
            WHERE c.estado = 'EMITIDO'
              AND c.fecha_emision IS NOT NULL
              AND c.numero_certificado IS NOT NULL
              AND c.planta_key = $2
              AND regexp_replace(UPPER(BTRIM(v.placa)), '[^A-Z0-9]', '', 'g') = $1
              AND (UPPER(c.tipo_certificado_clave) LIKE 'GLP%' OR UPPER(c.tipo_certificado_clave) LIKE 'GNV%')
              AND ($3::varchar IS NULL OR c.tipo_certificado_clave = $3)
              AND ($4::varchar IS NULL OR COALESCE(NULLIF(UPPER(BTRIM(s.modalidad)), ''), 'ANUAL') = $4)
        )
        SELECT *
        FROM candidatos
        WHERE posicion = 1
        ORDER BY tipo_certificado_clave, modalidad
    `, [placaNormalizada, plantaKey, filtro.clave, filtro.modalidad]);
    return result.rows.map(mapearCandidato);
};

exports.listarTipos = async (userContext) => {
    const result = await db.query(`
        SELECT DISTINCT c.tipo_certificado_clave AS clave,
               COALESCE(NULLIF(UPPER(BTRIM(s.modalidad)), ''), 'ANUAL') AS modalidad
        FROM fg_certificado c
        LEFT JOIN fg_tarifa ta ON ta.codigo = c.tarifa_codigo AND ta.planta_key = c.planta_key
        LEFT JOIN fg_servicio s ON s.id = ta.servicio_id
        WHERE c.estado = 'EMITIDO'
          AND c.planta_key = $1
          AND (UPPER(c.tipo_certificado_clave) LIKE 'GLP%' OR UPPER(c.tipo_certificado_clave) LIKE 'GNV%')
        ORDER BY c.tipo_certificado_clave, modalidad
    `, [userContext.planta_key]);
    return result.rows.map((row) => ({
        valor: `${row.clave}:${row.modalidad}`,
        clave: row.clave,
        modalidad: row.modalidad,
        nombre: etiquetaTipo(row.clave, row.modalidad)
    }));
};

exports.buscar = async (filtros, userContext) => {
    if (!userContext?.planta_key) throw errorNegocio('PLANTA_REQUERIDA', 400);
    await validarAccesoPlanta(userContext, userContext.planta_key);
    return consultarUltimosEmitidos({ ...filtros, plantaKey: userContext.planta_key });
};

const obtenerCandidato = async (certificadoId, userContext) => {
    const base = await db.query(`
        SELECT c.id, c.planta_key, c.tipo_certificado_clave, v.placa,
               COALESCE(NULLIF(UPPER(BTRIM(s.modalidad)), ''), 'ANUAL') AS modalidad
        FROM fg_certificado c
        JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
        LEFT JOIN fg_tarifa ta ON ta.codigo = c.tarifa_codigo AND ta.planta_key = c.planta_key
        LEFT JOIN fg_servicio s ON s.id = ta.servicio_id
        WHERE c.id = $1
    `, [Number(certificadoId)]);
    if (!base.rowCount) throw errorNegocio('CERTIFICADO_NOT_FOUND', 404);
    const row = base.rows[0];
    await validarAccesoPlanta(userContext, row.planta_key);
    const candidatos = await consultarUltimosEmitidos({
        placa: row.placa,
        tipo: `${row.tipo_certificado_clave}:${row.modalidad}`,
        plantaKey: row.planta_key
    });
    const candidato = candidatos[0];
    if (!candidato || candidato.certificadoId !== Number(certificadoId)) {
        throw errorNegocio('CERTIFICADO_NO_ES_ULTIMO', 409);
    }
    if (!candidato.duplicable) throw errorNegocio('CERTIFICADO_NO_DUPLICABLE', 409, candidato);
    return candidato;
};

const obtenerDuplicadoAutorizado = async (duplicadoId, userContext, queryable = db, forUpdate = false) => {
    const result = await queryable.query(`
        SELECT d.*, c.numero_certificado, c.tipo_certificado_clave,
               o.estado AS operacion_estado, o.importe_total,
               f.id AS facturacion_id_real, f.estado AS facturacion_estado,
               f.aceptada_sunat, f.entorno_facturador, f.nro_comprobante,
               f.tipo_comprobante, f.serie, f.numero,
               f.enlace_pdf, f.enlace_xml, f.enlace_pdf_faregas,
               CASE
                   WHEN d.estado = 'DISPONIBLE' THEN (
                       SELECT COUNT(*)::int
                       FROM fg_certificado_duplicado prev
                       WHERE prev.certificado_original_id = d.certificado_original_id
                         AND prev.estado = 'DISPONIBLE'
                         AND (prev.fecha_disponible < d.fecha_disponible
                              OR (prev.fecha_disponible = d.fecha_disponible AND prev.id <= d.id)
                              OR (d.fecha_disponible IS NULL AND prev.id <= d.id))
                   )
                   ELSE (
                       SELECT COUNT(*)::int + 1
                       FROM fg_certificado_duplicado prev
                       WHERE prev.certificado_original_id = d.certificado_original_id
                         AND prev.estado = 'DISPONIBLE'
                   )
               END AS numero_duplicado
        FROM fg_certificado_duplicado d
        JOIN fg_certificado c ON c.id = d.certificado_original_id
        JOIN fg_operacion_comercial o ON o.id = d.operacion_id
        LEFT JOIN fg_facturacion f ON f.operacion_id = o.id AND f.certificado_id IS NULL
        WHERE d.id = $1
        ${forUpdate ? 'FOR UPDATE OF d, o' : ''}
    `, [Number(duplicadoId)]);
    if (!result.rowCount) throw errorNegocio('DUPLICADO_NOT_FOUND', 404);
    const duplicado = result.rows[0];
    await validarAccesoPlanta(userContext, duplicado.planta_key);

    const pagosResult = await queryable.query(`
        SELECT p.id, p.importe, p.tipocontado_key AS "tipoContadoKey",
               p.tarjeta_key AS "tarjetaKey", p.modalidad_tarjeta AS "modalidadTarjeta",
               p.nrooperaciontarjeta AS "nroOperacionTarjeta",
               p.nrooperacionbanco AS "nroOperacionBanco",
               p.cuentacorriente_key AS "cuentaCorrienteKey",
               p.entidadfinanciera_key AS "entidadFinancieraKey",
               p.fechdeposito AS "fechaDeposito"
        FROM fg_orden_pago o
        JOIN fg_pago p ON p.orden_pago_id = o.id
        WHERE o.operacion_id = $1
        ORDER BY p.id ASC
    `, [duplicado.operacion_id]).catch(() => ({ rows: [] }));
    duplicado.pagos = pagosResult.rows || [];

    return duplicado;
};

const respuestaDuplicado = (row) => ({
    id: Number(row.id),
    certificadoOriginalId: Number(row.certificado_original_id),
    operacionId: Number(row.operacion_id),
    facturacionId: row.facturacion_id_real ? Number(row.facturacion_id_real) : null,
    numeroCertificado: row.numero_certificado,
    numeroDuplicado: row.numero_duplicado ? Number(row.numero_duplicado) : null,
    placa: row.placa,
    tipoNombre: row.tipo_nombre_snapshot,
    fechaEmision: row.fecha_emision_snapshot,
    fechaLimiteDuplicado: row.fecha_limite_snapshot,
    precio: Number(row.precio),
    estado: row.estado,
    operacionEstado: row.operacion_estado,
    facturacionEstado: row.facturacion_estado || null,
    nroComprobante: row.nro_comprobante || null,
    tipoComprobante: row.tipo_comprobante || null,
    fechaSolicitud: row.fecha_solicitud || null,
    fechaDisponible: row.fecha_disponible || null,
    solicitadoPor: row.solicitado_por || null,
    enlacePdf: row.enlace_pdf || null,
    enlacePdfFaregas: row.enlace_pdf_faregas || null,
    pagos: Array.isArray(row.pagos) ? row.pagos.map((p) => ({
        id: p.id ? Number(p.id) : undefined,
        tipo: String(p.tipoContadoKey || p.tipo || '').toUpperCase(),
        importe: Number(p.importe),
        tarjetaKey: p.tarjetaKey || undefined,
        modalidadTarjeta: p.modalidadTarjeta || undefined,
        nroOperacion: p.nroOperacionTarjeta || p.nroOperacionBanco || p.nroOperacion || undefined,
        entidadFinancieraKey: p.entidadFinancieraKey || undefined,
        cuentaCorrienteKey: p.cuentaCorrienteKey || undefined,
        fechaDeposito: p.fechaDeposito ? String(p.fechaDeposito).slice(0, 10) : undefined
    })) : []
});

const consultarHistorial = async (plantaKey, filtros = {}, queryable = db) => {
    const desde = normalizarFechaFiltro(filtros.desde);
    const hasta = normalizarFechaFiltro(filtros.hasta);
    if (desde && hasta && desde > hasta) throw errorNegocio('RANGO_FECHAS_INVALIDO', 400);
    const pagina = Math.max(1, Number.parseInt(filtros.pagina, 10) || 1);
    const offset = (pagina - 1) * HISTORIAL_POR_PAGINA;
    const result = await queryable.query(`
        WITH duplicados_con_ordinal AS (
            SELECT d.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY d.certificado_original_id
                       ORDER BY d.fecha_disponible ASC, d.id ASC
                   ) AS numero_duplicado
            FROM fg_certificado_duplicado d
            WHERE d.estado = 'DISPONIBLE'
        ),
        historial AS (
            SELECT d.*, c.numero_certificado, c.tipo_certificado_clave,
                   o.estado AS operacion_estado, o.importe_total,
                   f.id AS facturacion_id_real, f.estado AS facturacion_estado,
                   f.aceptada_sunat, f.entorno_facturador, f.nro_comprobante,
                   f.tipo_comprobante, f.enlace_pdf, f.enlace_xml, f.enlace_pdf_faregas
            FROM duplicados_con_ordinal d
            JOIN fg_certificado c ON c.id = d.certificado_original_id
            JOIN fg_operacion_comercial o ON o.id = d.operacion_id
            JOIN fg_facturacion f ON f.id = d.facturacion_id
            WHERE d.planta_key = $1
              AND ($2::date IS NULL OR d.fecha_disponible::date >= $2::date)
              AND ($3::date IS NULL OR d.fecha_disponible::date <= $3::date)
        )
        SELECT historial.*, COUNT(*) OVER() AS total_registros
        FROM historial
        ORDER BY fecha_disponible DESC NULLS LAST, id DESC
        LIMIT ${HISTORIAL_POR_PAGINA} OFFSET $4
    `, [plantaKey, desde, hasta, offset]);
    const total = Number(result.rows[0]?.total_registros || 0);
    return {
        items: result.rows.map(respuestaDuplicado),
        paginacion: {
            pagina,
            porPagina: HISTORIAL_POR_PAGINA,
            total,
            totalPaginas: Math.max(1, Math.ceil(total / HISTORIAL_POR_PAGINA))
        }
    };
};

exports.listarHistorial = async (filtros, userContext) => {
    if (!userContext?.planta_key) throw errorNegocio('PLANTA_REQUERIDA', 400);
    await validarAccesoPlanta(userContext, userContext.planta_key);
    return consultarHistorial(userContext.planta_key, filtros);
};

exports.crearSolicitud = async (certificadoId, userContext) => {
    const candidato = await obtenerCandidato(certificadoId, userContext);
    const preview = await certificadosService.obtenerPrevisualizacion(certificadoId, userContext);
    if (!preview?.html) throw errorNegocio('CERTIFICADO_SIN_CONTENIDO', 409);

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const existente = await client.query(`
            SELECT d.id
            FROM fg_certificado_duplicado d
            WHERE d.certificado_original_id = $1
              AND d.solicitado_por = $2
              AND d.estado = 'PENDIENTE_PAGO'
            ORDER BY d.id DESC LIMIT 1 FOR UPDATE
        `, [certificadoId, userContext.username]);
        if (existente.rowCount) {
            await client.query('COMMIT');
            return respuestaDuplicado(await obtenerDuplicadoAutorizado(existente.rows[0].id, userContext));
        }

        const operacion = await client.query(`
            INSERT INTO fg_operacion_comercial (
                planta_key, cliente_id, tipo_documento_cliente_snapshot,
                documento_cliente_snapshot, nombre_cliente_snapshot,
                direccion_cliente_snapshot, placa, moneda_key, base_imponible,
                igv, importe_total, estado, usuario_creacion
            ) VALUES ($1, NULL, $2, $3, $4, $5, $6, 'sol', $7, $8, $9, 'BORRADOR', $10)
            RETURNING id
        `, [
            candidato.plantaKey,
            candidato.cliente.tipoDocumento || null,
            candidato.cliente.nroDocumento || null,
            candidato.cliente.nombreRazonSocial || null,
            candidato.cliente.direccion || null,
            candidato.placa,
            BASE_DUPLICADO,
            IGV_DUPLICADO,
            PRECIO_DUPLICADO,
            userContext.username
        ]);
        const operacionId = Number(operacion.rows[0].id);
        await client.query(`
            INSERT INTO fg_operacion_detalle (
                operacion_id, tipo_item, producto_facturacion_id, cantidad,
                codigo_sku_snapshot, descripcion_snapshot, unidad_snapshot,
                afectacion_igv_snapshot, codigo_sunat_snapshot, valor_unitario,
                precio_unitario, base_imponible, igv, importe_total,
                genera_certificado_snapshot, orden
            ) VALUES ($1, 'PRODUCTO', NULL, 1, 'DUPLICADO_CERTIFICADO', $2, 'ZZ',
                      '10', '82121500', $3, $4, $3, $5, $4, FALSE, 1)
        `, [operacionId, `DUPLICADO - ${candidato.tipoNombre}`, BASE_DUPLICADO, PRECIO_DUPLICADO, IGV_DUPLICADO]);

        const duplicado = await client.query(`
            INSERT INTO fg_certificado_duplicado (
                certificado_original_id, operacion_id, planta_key, placa,
                tipo_certificado_clave, modalidad, numero_certificado_snapshot,
                tipo_nombre_snapshot, fecha_emision_snapshot, fecha_limite_snapshot,
                html_original_snapshot, motivo, precio, estado, solicitado_por
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PERDIDA',$12,'PENDIENTE_PAGO',$13)
            RETURNING id
        `, [
            candidato.certificadoId, operacionId, candidato.plantaKey, candidato.placa,
            candidato.tipoCertificadoClave, candidato.modalidad, candidato.numeroCertificado,
            candidato.tipoNombre, candidato.fechaEmision, candidato.fechaLimiteDuplicado,
            preview.html, PRECIO_DUPLICADO, userContext.username
        ]);
        await client.query('COMMIT');
        return respuestaDuplicado(await obtenerDuplicadoAutorizado(duplicado.rows[0].id, userContext));
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505' && error.constraint === 'uq_fg_certificado_duplicado_pendiente_usuario') {
            const existente = await db.query(`
                SELECT id FROM fg_certificado_duplicado
                WHERE certificado_original_id=$1 AND solicitado_por=$2
                  AND estado = 'PENDIENTE_PAGO'
                ORDER BY id DESC LIMIT 1
            `, [certificadoId, userContext.username]);
            if (existente.rowCount) {
                return respuestaDuplicado(await obtenerDuplicadoAutorizado(existente.rows[0].id, userContext));
            }
        }
        throw error;
    } finally {
        client.release();
    }
};

const facturacionOperable = (facturacion) => {
    const entorno = String(facturacion?.entornoFacturador || facturacion?.entorno_facturador || '').toUpperCase();
    // Las consultas del duplicado traen d.estado y f.estado en la misma fila.
    // Usar primero el alias fiscal evita interpretar "DISPONIBLE" como estado
    // del comprobante y bloquear documentos que sí fueron generados.
    const estado = String(
        facturacion?.facturacionEstado
        || facturacion?.facturacion_estado
        || facturacion?.estado
        || ''
    ).toUpperCase();
    return (estado === 'ACEPTADO' && (facturacion?.aceptadaSunat === true || facturacion?.aceptada_sunat === true))
        || (entorno === 'DEMO' && estado === 'PENDIENTE_SUNAT'
            && Boolean(facturacion?.nroComprobante || facturacion?.nro_comprobante)
            && Boolean(facturacion?.enlacePdf || facturacion?.enlace_pdf || facturacion?.enlaceXml || facturacion?.enlace_xml));
};

const asegurarSnapshotOperacion = async (operacionId, queryable = db) => {
    const result = await queryable.query(`
        UPDATE fg_facturacion f
        SET fecha_documento = COALESCE(f.fecha_documento, f.fecha_creacion::date,
                                       (CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date),
            sede_nombre_snapshot = COALESCE(f.sede_nombre_snapshot, p.nombre),
            sede_direccion_snapshot = COALESCE(f.sede_direccion_snapshot, p.direccion),
            sede_telefono_snapshot = COALESCE(f.sede_telefono_snapshot, p.telefono),
            sede_correo_snapshot = COALESCE(f.sede_correo_snapshot, p.correo),
            fecha_modificacion = CURRENT_TIMESTAMP
        FROM fg_operacion_comercial o
        JOIN fg_planta p ON p.key = o.planta_key
        WHERE f.operacion_id = o.id
          AND f.certificado_id IS NULL
          AND o.id = $1
        RETURNING f.id
    `, [Number(operacionId)]);
    if (!result.rowCount) throw errorNegocio('FACTURACION_FALTANTE', 409);
    return Number(result.rows[0].id);
};

exports.procesar = async (duplicadoId, payload, userContext, dependencies = {}) => {
    let duplicado = await obtenerDuplicadoAutorizado(duplicadoId, userContext);
    if (duplicado.estado === 'DISPONIBLE' && facturacionOperable(duplicado)) return respuestaDuplicado(duplicado);
    if (duplicado.estado === 'ANULADO') throw errorNegocio('DUPLICADO_ANULADO', 409);
    if (Number(duplicado.precio) !== PRECIO_DUPLICADO) throw errorNegocio('PRECIO_DUPLICADO_INVALIDO', 409);

    const fiscal = payload?.facturacion || {};
    if (String(fiscal.condicionPago || 'CONTADO').toUpperCase() !== 'CONTADO') {
        throw errorNegocio('DUPLICADO_SOLO_CONTADO', 400);
    }

    const pagosPayload = Array.isArray(payload?.pagos) ? payload.pagos : [];
    if (['BORRADOR', 'PENDIENTE_PAGO'].includes(String(duplicado.operacion_estado))) {
        if (pagosPayload.length === 0) {
            throw errorNegocio('PAGOS_REQUERIDOS', 400, 'Debe registrar al menos un medio de pago.');
        }
        const totalPagos = Math.round((pagosPayload.reduce((acc, p) => acc + Number(p.importe || 0), 0) + Number.EPSILON) * 100) / 100;
        if (totalPagos < PRECIO_DUPLICADO - 0.009) {
            throw errorNegocio('PAGO_INCOMPLETO', 400, `El total de pagos (S/ ${totalPagos.toFixed(2)}) es menor al precio del duplicado (S/ ${PRECIO_DUPLICADO.toFixed(2)}).`);
        }
        if (totalPagos > PRECIO_DUPLICADO + 0.009) {
            throw errorNegocio('PAGO_EXCEDE_TOTAL', 400, `El total de pagos (S/ ${totalPagos.toFixed(2)}) excede el precio del duplicado (S/ ${PRECIO_DUPLICADO.toFixed(2)}).`);
        }
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        duplicado = await obtenerDuplicadoAutorizado(duplicadoId, userContext, client, true);
        const cliente = await clientesService.asegurarCliente({
            tipoDocumento: fiscal.tipoDocumentoCliente,
            nroDocumento: fiscal.nroDocumento,
            nombreRazonSocial: fiscal.nombreRazonSocial,
            direccion: fiscal.direccion,
            correo: fiscal.email,
            telefono: fiscal.telefono
        }, client);
        await client.query(`
            UPDATE fg_operacion_comercial
            SET cliente_id=$2, tipo_documento_cliente_snapshot=$3,
                documento_cliente_snapshot=$4, nombre_cliente_snapshot=$5,
                direccion_cliente_snapshot=$6, usuario_modificacion=$7,
                fecha_modificacion=CURRENT_TIMESTAMP
            WHERE id=$1
        `, [
            duplicado.operacion_id, cliente.id, fiscal.tipoDocumentoCliente,
            fiscal.nroDocumento, fiscal.nombreRazonSocial, fiscal.direccion,
            userContext.username
        ]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    try {
        if (['BORRADOR', 'PENDIENTE_PAGO'].includes(String(duplicado.operacion_estado))) {
            await (dependencies.pagosService || pagosService).guardarPagosOperacion(
                duplicado.operacion_id,
                { importeTotal: PRECIO_DUPLICADO, pagos: pagosPayload, condicionPago: 'CONTADO' },
                userContext
            );
        }
        await (dependencies.facturacionService || facturacionService).guardarFacturacionOperacion(
            duplicado.operacion_id,
            { ...fiscal, condicionPago: 'CONTADO', cuotas: [] },
            userContext
        );
        // Las ventas por operación no pasan por el snapshot de un certificado.
        // El comprobante del duplicado necesita su propia foto inmutable de fecha y sede.
        await asegurarSnapshotOperacion(duplicado.operacion_id);
        const facturacionActual = await db.query(
            'SELECT estado FROM fg_facturacion WHERE operacion_id=$1 AND certificado_id IS NULL',
            [duplicado.operacion_id]
        );
        const servicioFacturacion = dependencies.facturacionService || facturacionService;
        const facturacion = String(facturacionActual.rows[0]?.estado || '').toUpperCase() === 'RECHAZADO'
            ? await servicioFacturacion.reintentarFacturacionOperacion(duplicado.operacion_id, userContext, dependencies.nubefact || {})
            : await servicioFacturacion.emitirFacturacionOperacion(duplicado.operacion_id, userContext, dependencies.nubefact || {});
        const disponible = facturacionOperable(facturacion);
        const factRow = await db.query(
            'SELECT id FROM fg_facturacion WHERE operacion_id=$1 AND certificado_id IS NULL',
            [duplicado.operacion_id]
        );
        await db.query(`
            UPDATE fg_certificado_duplicado
            SET facturacion_id=$2, estado=$3::varchar,
                fecha_disponible=CASE WHEN $3::varchar='DISPONIBLE' THEN CURRENT_TIMESTAMP ELSE fecha_disponible END,
                fecha_modificacion=CURRENT_TIMESTAMP
            WHERE id=$1
        `, [duplicadoId, factRow.rows[0]?.id || null, disponible ? 'DISPONIBLE' : 'PENDIENTE_COMPROBANTE']);
        return respuestaDuplicado(await obtenerDuplicadoAutorizado(duplicadoId, userContext));
    } catch (error) {
        await db.query(`
            UPDATE fg_certificado_duplicado
            SET estado='PENDIENTE_COMPROBANTE', fecha_modificacion=CURRENT_TIMESTAMP
            WHERE id=$1 AND estado <> 'DISPONIBLE'
        `, [duplicadoId]).catch(() => undefined);
        error.detalles = { ...(error.detalles || {}), duplicadoId: Number(duplicadoId), operacionId: Number(duplicado.operacion_id) };
        throw error;
    }
};

exports.obtener = async (duplicadoId, userContext) => respuestaDuplicado(
    await obtenerDuplicadoAutorizado(duplicadoId, userContext)
);

exports.obtenerDocumento = async (duplicadoId, userContext) => {
    const duplicado = await obtenerDuplicadoAutorizado(duplicadoId, userContext);
    if (duplicado.estado !== 'DISPONIBLE' || !facturacionOperable(duplicado)) {
        throw errorNegocio('DUPLICADO_NO_DISPONIBLE', 409);
    }
    await db.query(`
        UPDATE fg_certificado_duplicado
        SET cantidad_descargas=cantidad_descargas+1, ultima_descarga=CURRENT_TIMESTAMP,
            fecha_modificacion=CURRENT_TIMESTAMP
        WHERE id=$1
    `, [duplicadoId]);
    return {
        html: agregarMarcaDuplicado(duplicado.html_original_snapshot),
        filename: `DUPLICADO-${String(duplicado.numero_certificado || duplicado.id).replace(/[^A-Za-z0-9_-]/g, '-')}.pdf`
    };
};

exports.obtenerVista = async (duplicadoId, userContext) => {
    const duplicado = await obtenerDuplicadoAutorizado(duplicadoId, userContext);
    if (duplicado.estado !== 'DISPONIBLE' || !facturacionOperable(duplicado)) {
        throw errorNegocio('DUPLICADO_NO_DISPONIBLE', 409);
    }
    return {
        html: agregarMarcaDuplicado(duplicado.html_original_snapshot),
        numeroCertificado: duplicado.numero_certificado || duplicado.numero_certificado_snapshot
    };
};

exports.obtenerFacturacionParaDescarga = async (duplicadoId, userContext) => {
    const duplicado = await obtenerDuplicadoAutorizado(duplicadoId, userContext);
    if (!duplicado.facturacion_id_real || !facturacionOperable(duplicado)) {
        throw errorNegocio('COMPROBANTE_NO_DISPONIBLE', 409);
    }
    return {
        id: Number(duplicado.facturacion_id_real),
        enlacePdf: duplicado.enlace_pdf || null,
        tipoComprobante: duplicado.tipo_comprobante || null,
        serie: duplicado.serie || null,
        numero: duplicado.numero || null
    };
};

exports._private = {
    PRECIO_DUPLICADO,
    normalizarPlaca,
    normalizarFechaFiltro,
    normalizarTipoFiltro,
    etiquetaTipo,
    mapearCandidato,
    facturacionOperable,
    asegurarSnapshotOperacion,
    consultarHistorial,
    HISTORIAL_POR_PAGINA,
    consultarUltimosEmitidos
};
