const db = require('../../../config/database');
const authService = require('./faregas-auth.service');
const {
    normalizarNumeroChip,
    esNumeroChipCertificadoValido,
    normalizarLoteScanner
} = require('./faregas-chips.rules');
const { redondear } = require('./faregas-pagos.rules');

const normalizarCodigoProducto = (valor) => String(valor || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const normalizarNombreProducto = (valor) => String(valor || '').trim();

const normalizarSedesProducto = (sedes) => {
    if (!Array.isArray(sedes)) return [];
    const unicas = new Map();
    for (const sede of sedes) {
        const plantaKey = String(sede?.plantaKey || sede || '').trim();
        if (!plantaKey) continue;
        const precio = Number(sede?.precio);
        unicas.set(plantaKey, {
            plantaKey,
            precio,
            stockPermitido: sede?.stockPermitido !== false,
            ventaHabilitada: sede?.ventaHabilitada === true,
            productoFacturacionId: sede?.productoFacturacionId
                ? Number(sede.productoFacturacionId)
                : null
        });
    }
    return [...unicas.values()];
};

const validarAcceso = async (user, plantaKey) => {
    if (!await authService.validarAccesoPlanta(user.username, user.perfil_id, plantaKey)) {
        throw new Error('PLANTA_NO_AUTORIZADA');
    }
};

const productoInventariableEnSede = async (queryable, plantaKey, productoInventariableId = null, bloquear = false) => {
    const result = await queryable.query(`
        SELECT pi.id, pi.codigo, pi.nombre,
               COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id) AS producto_facturacion_id,
               pis.precio, pis.activo, pis.stock_permitido, pis.venta_habilitada,
               CASE
                   WHEN pf.id IS NOT NULL
                    AND pf.activo = TRUE
                    AND pf.es_para_venta = TRUE
                    AND UPPER(BTRIM(pf.unidad)) IN ('NIU', 'ZZ')
                    AND BTRIM(pf.tipo_afectacion_igv) = '10'
                    AND (
                        COALESCE(BTRIM(pf.codigo_clasificacion_sunat), '') = ''
                        OR BTRIM(pf.codigo_clasificacion_sunat) ~ '^\\d{8}$'
                    )
                   THEN TRUE ELSE FALSE
               END AS producto_fiscal_valido
        FROM fg_producto_inventariable pi
        JOIN fg_producto_inventariable_sede pis ON pis.producto_inventariable_id = pi.id
        JOIN fg_planta p ON p.key = pis.planta_key AND p.activo = TRUE
        LEFT JOIN fg_producto_facturacion pf
          ON pf.id = COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id)
        WHERE pi.activo = TRUE AND pis.planta_key = $1
          AND (($2::bigint IS NULL AND pi.codigo = 'CHIP') OR pi.id = $2::bigint)
          AND pis.activo = TRUE${bloquear ? ' FOR UPDATE OF pis' : ''}
    `, [plantaKey, productoInventariableId]);
    if (!result.rowCount) throw new Error('PRODUCTO_INVENTARIABLE_NO_CONFIGURADO_SEDE');
    return result.rows[0];
};

const productoChip = (queryable, plantaKey, bloquear = false) =>
    productoInventariableEnSede(queryable, plantaKey, null, bloquear);

const productoInventariable = async (queryable, productoInventariableId = null, bloquear = false) => {
    const result = await queryable.query(`
        SELECT id, codigo, nombre, tipo
        FROM fg_producto_inventariable
        WHERE activo = TRUE
          AND (($1::bigint IS NULL AND codigo = 'CHIP') OR id = $1::bigint)
        ${bloquear ? 'FOR UPDATE' : ''}
    `, [productoInventariableId]);
    if (!result.rowCount) throw new Error('PRODUCTO_INVENTARIABLE_NO_ENCONTRADO');
    return result.rows[0];
};

const exigirStockPermitido = (config) => {
    if (config.stock_permitido !== true) throw new Error('STOCK_CHIP_NO_PERMITIDO');
};

const exigirVentaHabilitada = (config) => {
    if (config.venta_habilitada !== true) throw new Error('VENTA_CHIP_NO_HABILITADA');
    if (config.producto_fiscal_valido !== true) throw new Error('PRODUCTO_FISCAL_CHIP_INVALIDO');
};

exports.listar = async ({ plantaKey, productoInventariableId, estado, buscar, page = 1, pageSize = 50 }, user) => {
    await validarAcceso(user, plantaKey);
    const params = [plantaKey];
    const filtros = ['c.planta_actual_key = $1'];
    if (productoInventariableId) {
        params.push(Number(productoInventariableId));
        filtros.push(`c.producto_inventariable_id = $${params.length}`);
    }
    if (estado) { params.push(estado); filtros.push(`c.estado = $${params.length}`); }
    if (buscar) { params.push(`%${buscar}%`); filtros.push(`c.numero_chip ILIKE $${params.length}`); }
    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    params.push(limit, offset);
    const result = await db.query(`
        SELECT c.id, c.numero_chip, c.estado, c.planta_actual_key, p.nombre planta_nombre,
               c.producto_inventariable_id, pi.codigo producto_codigo, pi.nombre producto_nombre,
               c.creado_en, c.actualizado_en,
               (SELECT MAX(m.fecha) FROM fg_chip_movimiento m WHERE m.chip_id=c.id) ultimo_movimiento,
               COUNT(*) OVER()::int total
        FROM fg_chip c
        JOIN fg_planta p ON p.key=c.planta_actual_key
        JOIN fg_producto_inventariable pi ON pi.id=c.producto_inventariable_id
        WHERE ${filtros.join(' AND ')} ORDER BY c.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    return { items: result.rows, total: result.rows[0]?.total || 0 };
};

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const errorFiltroVentas = (codigo, mensaje) => {
    const error = new Error(codigo);
    error.code = codigo;
    error.statusCode = 400;
    error.detalles = mensaje;
    return error;
};

const normalizarFechaFiltro = (valor, nombre) => {
    if (valor === undefined || valor === null || String(valor).trim() === '') return null;
    const fecha = String(valor).trim();
    if (!FECHA_ISO.test(fecha)) {
        throw errorFiltroVentas('FECHA_INVALIDA', `${nombre} debe tener formato AAAA-MM-DD.`);
    }
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const comprobacion = new Date(Date.UTC(anio, mes - 1, dia));
    if (comprobacion.getUTCFullYear() !== anio
        || comprobacion.getUTCMonth() !== mes - 1
        || comprobacion.getUTCDate() !== dia) {
        throw errorFiltroVentas('FECHA_INVALIDA', `${nombre} no es una fecha válida.`);
    }
    return fecha;
};

const construirFiltrosFechasVentas = (query = {}) => {
    const fechaDesde = normalizarFechaFiltro(query.fechaDesde, 'fechaDesde');
    const fechaHasta = normalizarFechaFiltro(query.fechaHasta, 'fechaHasta');
    if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
        throw errorFiltroVentas('RANGO_FECHAS_INVALIDO', 'La fecha Desde no puede ser posterior a la fecha Hasta.');
    }
    return { fechaDesde, fechaHasta };
};

exports.listarVentas = async (plantaKey, user, filtros = {}) => {
    await validarAcceso(user, plantaKey);
    const { fechaDesde, fechaHasta } = construirFiltrosFechasVentas(filtros);
    const params = [plantaKey];
    const condiciones = [
        'oc.planta_key = $1',
        "oc.estado IN ('PAGADO', 'FACTURADO', 'ANULADO')"
    ];
    if (fechaDesde) {
        params.push(fechaDesde);
        condiciones.push(`oc.fecha_creacion >= $${params.length}::date`);
    }
    if (fechaHasta) {
        params.push(fechaHasta);
        condiciones.push(`oc.fecha_creacion < $${params.length}::date + INTERVAL '1 day'`);
    }
    const result = await db.query(`
        SELECT oc.id AS operacion_id,
               oc.fecha_creacion AS creado_en,
               oc.tipo_documento_cliente_snapshot,
               oc.documento_cliente_snapshot,
               oc.nombre_cliente_snapshot,
               oc.estado AS estado_venta,
               oc.importe_total,
               ARRAY_AGG(c.numero_chip ORDER BY c.numero_chip) AS chips,
               f.id AS facturacion_id,
               f.estado AS comprobante_estado,
               f.nro_comprobante,
               f.enlace_pdf
        FROM fg_operacion_comercial oc
        JOIN fg_operacion_detalle od
          ON od.operacion_id = oc.id
        JOIN fg_operacion_detalle_chip odc
          ON odc.operacion_detalle_id = od.id
        JOIN fg_chip c
          ON c.id = odc.chip_id
        LEFT JOIN fg_facturacion f
          ON f.operacion_id = oc.id
         AND f.certificado_id IS NULL
        WHERE ${condiciones.join(' AND ')}
        GROUP BY oc.id, f.id
        ORDER BY oc.fecha_creacion DESC, oc.id DESC
        LIMIT 100
    `, params);

    return result.rows.map((row) => ({
        operacionId: Number(row.operacion_id),
        creadoEn: row.creado_en,
        tipoDocumentoCliente: row.tipo_documento_cliente_snapshot,
        documentoCliente: row.documento_cliente_snapshot,
        nombreCliente: row.nombre_cliente_snapshot,
        chips: row.chips || [],
        estadoVenta: row.estado_venta,
        importeTotal: Number(row.importe_total),
        facturacion: row.facturacion_id == null ? null : {
            id: Number(row.facturacion_id),
            estado: row.comprobante_estado,
            nroComprobante: row.nro_comprobante,
            enlacePdf: row.enlace_pdf
        }
    }));
};

const mapPagoVenta = (row) => ({
    id: row.pago_id == null ? null : Number(row.pago_id),
    estado: row.pago_estado,
    tipo: row.tipocontado_key
        ? 'EFECTIVO'
        : row.tarjeta_key ? 'TARJETA' : row.entidadfinanciera_key ? 'BANCO' : 'OTRO',
    medioPago: row.tipocontado_key || row.tarjeta_key || row.entidadfinanciera_key || null,
    entidadFinanciera: row.entidadfinanciera_key || null,
    numeroOperacion: row.nrooperacionbanco || row.nrooperaciontarjeta || null,
    fechaDeposito: row.fechdeposito || null,
    importe: Number(row.importe || 0)
});

const mapDetalleVenta = (row, plantaKey) => ({
    id: Number(row.detalle_id),
    tipoItem: row.tipo_item,
    codigo: row.codigo_sku_snapshot,
    descripcion: row.descripcion_snapshot,
    unidad: row.unidad_snapshot,
    afectacionIgv: row.afectacion_igv_snapshot,
    codigoSunat: row.codigo_sunat_snapshot,
    cantidad: Number(row.cantidad || 0),
    valorUnitario: Number(row.valor_unitario || 0),
    precioUnitario: Number(row.precio_unitario || 0),
    baseImponible: Number(row.base_imponible || 0),
    igv: Number(row.igv || 0),
    importeTotal: Number(row.importe_total || 0),
    chip: row.chip_id == null ? null : {
        id: Number(row.chip_id),
        numero: row.numero_chip,
        estado: row.chip_estado,
        sedeKey: plantaKey,
        sedeNombre: row.planta_nombre || plantaKey
    }
});

const mapFacturacionVenta = (row) => !row || row.facturacion_id == null ? null : {
    id: Number(row.facturacion_id),
    estado: row.comprobante_estado,
    tipoComprobante: row.tipo_comprobante,
    serie: row.serie,
    numero: row.numero == null ? null : Number(row.numero),
    nroComprobante: row.nro_comprobante,
    sunatResponseCode: row.sunat_responsecode || row.respuesta_proveedor?.codigo || row.respuesta_proveedor?.sunat_responsecode || null,
    sunatDescription: row.sunat_description,
    mensajeRechazo: row.sunat_description || row.intento_error || null,
    enlacePdf: row.enlace_pdf,
    intentos: Number(row.intentos || 0),
    fechaUltimoIntento: row.fecha_ultimo_intento,
    ultimoIntento: row.intento_numero == null ? null : {
        numero: Number(row.intento_numero),
        estado: row.intento_estado,
        httpStatus: row.intento_http_status,
        error: row.intento_error
    }
};

exports.obtenerDetalleVenta = async (operacionId, user) => {
    const id = Number(operacionId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('OPERACION_ID_INVALIDO');

    const operacionResult = await db.query(
        'SELECT * FROM fg_operacion_comercial WHERE id = $1',
        [id]
    );
    if (!operacionResult.rowCount) throw new Error('OPERACION_NOT_FOUND');
    const operacion = operacionResult.rows[0];
    await validarAcceso(user, operacion.planta_key);

    const [detallesResult, ordenResult, facturacionResult] = await Promise.all([
        db.query(`
            SELECT od.id AS detalle_id, od.tipo_item,
                   od.codigo_sku_snapshot, od.descripcion_snapshot,
                   od.unidad_snapshot, od.afectacion_igv_snapshot,
                   od.codigo_sunat_snapshot, od.cantidad,
                   od.valor_unitario, od.precio_unitario,
                   od.base_imponible, od.igv, od.importe_total,
                   c.id AS chip_id, c.numero_chip, c.estado AS chip_estado,
                   c.planta_actual_key, p.nombre AS planta_nombre
              FROM fg_operacion_detalle od
              LEFT JOIN fg_operacion_detalle_chip odc
                ON odc.operacion_detalle_id = od.id
              LEFT JOIN fg_chip c ON c.id = odc.chip_id
              LEFT JOIN fg_planta p ON p.key = c.planta_actual_key
             WHERE od.operacion_id = $1
             ORDER BY od.orden, od.id
        `, [id]),
        db.query(`
            SELECT op.id AS orden_id, op.estado AS orden_estado,
                   op.importe_total, op.importe_pagado, op.saldo_pendiente,
                   op.moneda_key, op.formapago_key,
                   p.id AS pago_id, p.estado AS pago_estado, p.importe,
                   p.tipocontado_key, p.tarjeta_key, p.entidadfinanciera_key,
                   p.nrooperacionbanco, p.nrooperaciontarjeta,
                   p.fechdeposito
              FROM fg_orden_pago op
              LEFT JOIN fg_pago p ON p.orden_pago_id = op.id
             WHERE op.operacion_id = $1
             ORDER BY p.id
        `, [id]),
        db.query(`
            SELECT f.id AS facturacion_id, f.estado AS comprobante_estado,
                   f.tipo_comprobante, f.serie, f.numero, f.nro_comprobante,
                   f.sunat_responsecode, f.sunat_description, f.respuesta_proveedor,
                   f.enlace_pdf, f.intentos, f.fecha_ultimo_intento,
                   i.numero_intento AS intento_numero,
                   i.estado AS intento_estado,
                   i.http_status AS intento_http_status,
                   i.error AS intento_error
              FROM fg_facturacion f
              LEFT JOIN LATERAL (
                  SELECT numero_intento, estado, http_status, error
                    FROM fg_facturacion_intento
                   WHERE facturacion_id = f.id
                   ORDER BY numero_intento DESC, id DESC
                   LIMIT 1
              ) i ON TRUE
             WHERE f.operacion_id = $1
               AND f.certificado_id IS NULL
             ORDER BY f.id DESC
             LIMIT 1
        `, [id])
    ]);

    const ordenRow = ordenResult.rows[0] || null;
    const pagos = ordenResult.rows
        .filter((row) => row.pago_id != null)
        .map(mapPagoVenta);
    const importePagado = ordenRow?.importe_pagado == null
        ? pagos.reduce((total, pago) => total + pago.importe, 0)
        : Number(ordenRow.importe_pagado);

    return {
        operacionId: Number(operacion.id),
        plantaKey: operacion.planta_key,
        fechaOperacion: operacion.fecha_creacion,
        estado: operacion.estado,
        cliente: {
            tipoDocumento: operacion.tipo_documento_cliente_snapshot,
            documento: operacion.documento_cliente_snapshot,
            nombre: operacion.nombre_cliente_snapshot,
            direccion: operacion.direccion_cliente_snapshot
        },
        moneda: operacion.moneda_key,
        total: Number(operacion.importe_total || 0),
        detalles: detallesResult.rows.map((row) => mapDetalleVenta(row, operacion.planta_key)),
        ordenPago: ordenRow ? {
            id: Number(ordenRow.orden_id),
            estado: ordenRow.orden_estado,
            condicionPago: String(ordenRow.formapago_key || 'CONTADO').toUpperCase(),
            total: Number(ordenRow.importe_total || 0),
            pagado: importePagado,
            saldoPendiente: Number(ordenRow.saldo_pendiente || 0)
        } : null,
        pagos,
        facturacion: mapFacturacionVenta(facturacionResult.rows[0] || null)
    };
};

exports.resumen = async (plantaKey, user, productoInventariableId = null) => {
    await validarAcceso(user, plantaKey);
    const producto = await productoInventariable(db, productoInventariableId);
    const [result, configuracion] = await Promise.all([
        db.query(`
        SELECT COUNT(*)::int total,
               COUNT(*) FILTER (WHERE estado='DISPONIBLE')::int disponibles,
               COUNT(*) FILTER (WHERE estado='RESERVADO')::int reservados,
               COUNT(*) FILTER (WHERE estado='VENDIDO')::int vendidos,
               COUNT(*) FILTER (WHERE estado='BAJA')::int baja
        FROM fg_chip WHERE planta_actual_key=$1 AND producto_inventariable_id=$2
        `, [plantaKey, producto.id]),
        db.query(`
            SELECT precio, venta_habilitada
            FROM fg_producto_inventariable_sede
            WHERE producto_inventariable_id = $1
              AND planta_key = $2
              AND activo = TRUE
        `, [producto.id, plantaKey])
    ]);
    const configuracionSede = configuracion.rows[0];
    return {
        ...result.rows[0],
        productoInventariableId: Number(producto.id),
        productoCodigo: producto.codigo,
        productoNombre: producto.nombre,
        // Se conserva como metadato de compatibilidad para consumidores antiguos.
        // El inventario físico ya no depende de esta configuración comercial.
        precio: Number(configuracionSede?.precio || 0),
        stockPermitido: true,
        ventaHabilitada: configuracionSede?.venta_habilitada === true,
        mappingFiscalCompleto: false
    };
};

exports.listarProductosInventariables = async (plantaKey, user) => {
    await validarAcceso(user, plantaKey);
    const result = await db.query(`
        SELECT pi.id, pi.codigo, pi.nombre, pi.tipo, pi.control_stock, pi.activo,
               pi.producto_facturacion_id,
               COALESCE((
                   SELECT json_agg(json_build_object(
                       'plantaKey', p.key,
                       'plantaNombre', p.nombre,
                       'precio', pis.precio,
                       'stockPermitido', pis.stock_permitido,
                       'ventaHabilitada', pis.venta_habilitada,
                       'productoFacturacionId', COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id),
                       'productoFiscalCodigo', pf.codigo_sku,
                       'productoFiscalDescripcion', pf.descripcion
                   ) ORDER BY p.nombre)
                   FROM fg_producto_inventariable_sede pis
                   JOIN fg_planta p ON p.key = pis.planta_key
                   LEFT JOIN fg_producto_facturacion pf
                     ON pf.id = COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id)
                   WHERE pis.producto_inventariable_id = pi.id
                     AND pis.activo = TRUE
                     AND p.activo = TRUE
                     AND p.empresa_key = 'FAREGAS'
               ), '[]'::json) AS sedes,
               (SELECT COUNT(*)::int FROM fg_chip c
                WHERE c.producto_inventariable_id = pi.id) AS stock_total,
               (SELECT COUNT(*)::int FROM fg_chip c
                WHERE c.producto_inventariable_id = pi.id
                  AND c.planta_actual_key = $1) AS stock_sede,
               (SELECT COUNT(*)::int FROM fg_chip c
                WHERE c.producto_inventariable_id = pi.id
                  AND c.planta_actual_key = $1 AND c.estado = 'DISPONIBLE') AS disponibles_sede,
               (SELECT COUNT(*)::int FROM fg_chip c
                WHERE c.producto_inventariable_id = pi.id
                  AND c.planta_actual_key = $1 AND c.estado = 'RESERVADO') AS reservados_sede,
               (SELECT COUNT(*)::int FROM fg_chip c
                WHERE c.producto_inventariable_id = pi.id
                  AND c.planta_actual_key = $1 AND c.estado = 'VENDIDO') AS vendidos_sede,
               (SELECT COUNT(*)::int FROM fg_chip c
                WHERE c.producto_inventariable_id = pi.id
                  AND c.planta_actual_key = $1 AND c.estado = 'BAJA') AS bajas_sede
        FROM fg_producto_inventariable pi
        WHERE pi.activo = TRUE
        ORDER BY pi.nombre, pi.codigo
    `, [plantaKey]);
    return result.rows.map((row) => ({
        id: Number(row.id),
        codigo: row.codigo,
        nombre: row.nombre,
        tipo: row.tipo,
        controlStock: row.control_stock === true,
        activo: row.activo === true,
        productoFacturacionId: row.producto_facturacion_id ? Number(row.producto_facturacion_id) : null,
        sedes: row.sedes,
        stockTotal: Number(row.stock_total),
        stockSede: Number(row.stock_sede),
        disponiblesSede: Number(row.disponibles_sede),
        reservadosSede: Number(row.reservados_sede),
        vendidosSede: Number(row.vendidos_sede),
        bajasSede: Number(row.bajas_sede)
    }));
};

exports.catalogosProductosInventariables = async (plantaKey, user) => {
    await validarAcceso(user, plantaKey);
    const sedes = await db.query(`
        SELECT key, nombre
        FROM fg_planta
        WHERE activo = TRUE AND empresa_key = 'FAREGAS'
        ORDER BY nombre
    `);
    return { sedes: sedes.rows };
};

exports.crearProductoInventariable = async (data, user, ipDireccion = null) => {
    const codigo = normalizarCodigoProducto(data.codigo);
    const nombre = normalizarNombreProducto(data.nombre);
    const tipo = String(data.tipo || 'CHIP_SERIALIZADO').trim().toUpperCase();
    const sedes = normalizarSedesProducto(data.sedes);
    const productoFacturacionId = data.productoFacturacionId ? Number(data.productoFacturacionId) : null;

    if (codigo.length < 2 || codigo.length > 60) throw new Error('CODIGO_PRODUCTO_INVENTARIABLE_INVALIDO');
    if (nombre.length < 2 || nombre.length > 200) throw new Error('NOMBRE_PRODUCTO_INVENTARIABLE_INVALIDO');
    if (tipo.length < 2 || tipo.length > 100) throw new Error('TIPO_PRODUCTO_INVENTARIABLE_INVALIDO');
    if (sedes.some((sede) => !Number.isFinite(sede.precio) || sede.precio <= 0)) {
        throw new Error('PRECIO_PRODUCTO_INVENTARIABLE_INVALIDO');
    }
    if (sedes.some((sede) => sede.ventaHabilitada && !sede.productoFacturacionId && !productoFacturacionId)) {
        throw new Error('VENTA_REQUIERE_PRODUCTO_FISCAL');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const plantas = await client.query(`
            SELECT key
            FROM fg_planta
            WHERE key = ANY($1::varchar[])
              AND activo = TRUE
              AND empresa_key = 'FAREGAS'
        `, [sedes.map((sede) => sede.plantaKey)]);
        if (plantas.rowCount !== sedes.length) throw new Error('SEDE_FAREGAS_INVALIDA');

        const productosFiscales = sedes
            .map((sede) => sede.productoFacturacionId || productoFacturacionId)
            .filter(Boolean);
        if (productosFiscales.length) {
            const fiscales = await client.query(`
                SELECT id
                FROM fg_producto_facturacion
                WHERE id = ANY($1::bigint[])
                  AND activo = TRUE
                  AND es_para_venta = TRUE
                  AND COALESCE(BTRIM(codigo_sku), '') <> ''
                  AND COALESCE(BTRIM(descripcion), '') <> ''
                  AND UPPER(BTRIM(unidad)) IN ('NIU', 'ZZ')
                  AND BTRIM(tipo_afectacion_igv) = '10'
                  AND (COALESCE(BTRIM(codigo_clasificacion_sunat), '') = '' OR BTRIM(codigo_clasificacion_sunat) ~ '^\\d{8}$')
            `, [productosFiscales]);
            if (fiscales.rowCount !== new Set(productosFiscales).size) {
                throw new Error('PRODUCTO_FISCAL_INVALIDO');
            }
        }

        if (productoFacturacionId) {
            const fiscal = await client.query(`
                SELECT id FROM fg_producto_facturacion
                WHERE id = $1 AND activo = TRUE AND es_para_venta = TRUE
                  AND COALESCE(BTRIM(codigo_sku), '') <> ''
                  AND COALESCE(BTRIM(descripcion), '') <> ''
                  AND UPPER(BTRIM(unidad)) IN ('NIU', 'ZZ')
                  AND BTRIM(tipo_afectacion_igv) = '10'
                  AND (COALESCE(BTRIM(codigo_clasificacion_sunat), '') = '' OR BTRIM(codigo_clasificacion_sunat) ~ '^\\d{8}$')
            `, [productoFacturacionId]);
            if (!fiscal.rowCount) throw new Error('PRODUCTO_FISCAL_INVALIDO');
        }

        const producto = await client.query(`
            INSERT INTO fg_producto_inventariable
                (codigo, nombre, tipo, producto_facturacion_id, control_stock, activo)
            VALUES ($1, $2, $3, $4, TRUE, TRUE)
            RETURNING id, codigo, nombre, tipo
        `, [codigo, nombre, tipo, productoFacturacionId]);
        const productoId = Number(producto.rows[0].id);

        for (const sede of sedes) {
            await client.query(`
                INSERT INTO fg_producto_inventariable_sede (
                    producto_inventariable_id, planta_key, precio, activo,
                    stock_permitido, venta_habilitada, producto_facturacion_id
                ) VALUES ($1, $2, $3, TRUE, $4, $5, $6)
            `, [
                productoId,
                sede.plantaKey,
                sede.precio,
                sede.stockPermitido,
                sede.ventaHabilitada,
                sede.productoFacturacionId
            ]);
        }

        await client.query(`
            INSERT INTO fg_auditoria_config
                (username, entidad, accion, identificador, detalles, planta_key, ip_direccion)
            VALUES ($1, 'PRODUCTO_INVENTARIABLE', 'CREAR_PRODUCTO_INVENTARIABLE', $2, $3, NULL, $4)
        `, [
            user.username,
            codigo,
            JSON.stringify({ producto: producto.rows[0], sedes }),
            ipDireccion
        ]);

        await client.query('COMMIT');
        return { ...producto.rows[0], id: productoId };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw new Error('PRODUCTO_INVENTARIABLE_DUPLICADO');
        throw error;
    } finally {
        client.release();
    }
};


exports.editarProductoInventariable = async (id, data, user, ipDireccion = null) => {
    const nombre = normalizarNombreProducto(data.nombre);
    const tipo = String(data.tipo || 'OTRO_PRODUCTO_FISICO').trim().toUpperCase();
    const sedes = normalizarSedesProducto(data.sedes);
    const recibeProductoFacturacion = Object.prototype.hasOwnProperty.call(data || {}, 'productoFacturacionId');
    const productoFacturacionId = recibeProductoFacturacion && data.productoFacturacionId !== null && data.productoFacturacionId !== ''
        ? Number(data.productoFacturacionId)
        : null;

    if (nombre.length < 2 || nombre.length > 200) throw new Error('NOMBRE_PRODUCTO_INVENTARIABLE_INVALIDO');
    if (tipo.length < 2 || tipo.length > 100) throw new Error('TIPO_PRODUCTO_INVENTARIABLE_INVALIDO');
    if (sedes.some((sede) => !Number.isFinite(sede.precio) || sede.precio <= 0)) {
        throw new Error('PRECIO_PRODUCTO_INVENTARIABLE_INVALIDO');
    }
    if (sedes.some((sede) => sede.ventaHabilitada && !sede.productoFacturacionId && !productoFacturacionId)) {
        throw new Error('VENTA_REQUIERE_PRODUCTO_FISCAL');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const check = await client.query('SELECT codigo FROM fg_producto_inventariable WHERE id = $1 AND activo = TRUE FOR UPDATE', [id]);
        if (!check.rowCount) throw new Error('PRODUCTO_INVENTARIABLE_NO_ENCONTRADO');
        const codigo = check.rows[0].codigo;

        if (sedes.length > 0) {
            const plantas = await client.query(`
                SELECT key
                FROM fg_planta
                WHERE key = ANY($1::varchar[])
                  AND activo = TRUE
                  AND empresa_key = 'FAREGAS'
            `, [sedes.map((sede) => sede.plantaKey)]);
            if (plantas.rowCount !== sedes.length) throw new Error('SEDE_FAREGAS_INVALIDA');
        }

        const productosFiscales = sedes
            .map((sede) => sede.productoFacturacionId || productoFacturacionId)
            .filter(Boolean);
        if (productosFiscales.length) {
            const fiscales = await client.query(`
                SELECT id
                FROM fg_producto_facturacion
                WHERE id = ANY($1::bigint[])
                  AND activo = TRUE
                  AND es_para_venta = TRUE
                  AND COALESCE(BTRIM(codigo_sku), '') <> ''
                  AND COALESCE(BTRIM(descripcion), '') <> ''
                  AND UPPER(BTRIM(unidad)) IN ('NIU', 'ZZ')
                  AND BTRIM(tipo_afectacion_igv) = '10'
                  AND (COALESCE(BTRIM(codigo_clasificacion_sunat), '') = '' OR BTRIM(codigo_clasificacion_sunat) ~ '^\\d{8}$')
            `, [productosFiscales]);
            if (fiscales.rowCount !== new Set(productosFiscales).size) {
                throw new Error('PRODUCTO_FISCAL_INVALIDO');
            }
        }

        if (productoFacturacionId) {
            const fiscal = await client.query(`
                SELECT id FROM fg_producto_facturacion
                WHERE id = $1 AND activo = TRUE AND es_para_venta = TRUE
                  AND COALESCE(BTRIM(codigo_sku), '') <> ''
                  AND COALESCE(BTRIM(descripcion), '') <> ''
                  AND UPPER(BTRIM(unidad)) IN ('NIU', 'ZZ')
                  AND BTRIM(tipo_afectacion_igv) = '10'
                  AND (COALESCE(BTRIM(codigo_clasificacion_sunat), '') = '' OR BTRIM(codigo_clasificacion_sunat) ~ '^\\d{8}$')
            `, [productoFacturacionId]);
            if (!fiscal.rowCount) throw new Error('PRODUCTO_FISCAL_INVALIDO');
        }

        if (recibeProductoFacturacion) {
            await client.query(`
                UPDATE fg_producto_inventariable
                SET nombre = $1, tipo = $2, producto_facturacion_id = $3, fecha_modificacion = NOW()
                WHERE id = $4
            `, [nombre, tipo, productoFacturacionId, id]);
        } else {
            await client.query(`
                UPDATE fg_producto_inventariable
                SET nombre = $1, tipo = $2, fecha_modificacion = NOW()
                WHERE id = $3
            `, [nombre, tipo, id]);
        }

        await client.query(`
            UPDATE fg_producto_inventariable_sede
            SET activo = FALSE
            WHERE producto_inventariable_id = $1
        `, [id]);

        for (const sede of sedes) {
            await client.query(`
                INSERT INTO fg_producto_inventariable_sede (
                    producto_inventariable_id, planta_key, precio, activo,
                    stock_permitido, venta_habilitada, producto_facturacion_id
                ) VALUES ($1, $2, $3, TRUE, $4, $5, $6)
                ON CONFLICT (producto_inventariable_id, planta_key)
                DO UPDATE SET
                    precio = EXCLUDED.precio,
                    activo = TRUE,
                    stock_permitido = EXCLUDED.stock_permitido,
                    venta_habilitada = EXCLUDED.venta_habilitada,
                    producto_facturacion_id = EXCLUDED.producto_facturacion_id
            `, [
                id,
                sede.plantaKey,
                sede.precio,
                sede.stockPermitido,
                sede.ventaHabilitada,
                sede.productoFacturacionId || null
            ]);
        }

        await client.query(`
            INSERT INTO fg_auditoria_config
                (username, entidad, accion, identificador, detalles, planta_key, ip_direccion)
            VALUES ($1, 'PRODUCTO_INVENTARIABLE', 'EDITAR_PRODUCTO_INVENTARIABLE', $2, $3, NULL, $4)
        `, [
            user.username,
            codigo,
            JSON.stringify({ nombre, tipo, sedes }),
            ipDireccion
        ]);

        await client.query('COMMIT');
        return { id, codigo, nombre, tipo };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.consultarDisponibilidad = async ({ plantaKey, numeroChip, certificadoId }, user) => {
    await validarAcceso(user, plantaKey);
    const numero = normalizarNumeroChip(numeroChip);
    if (!esNumeroChipCertificadoValido(numero)) throw new Error('NUMERO_CHIP_INVALIDO');
    exigirStockPermitido(await productoChip(db, plantaKey));

    const idCertificado = certificadoId === undefined || certificadoId === null || certificadoId === ''
        ? null
        : Number(certificadoId);
    if (idCertificado !== null && (!Number.isSafeInteger(idCertificado) || idCertificado <= 0)) {
        throw new Error('CERTIFICADO_INVALIDO');
    }
    if (idCertificado !== null) {
        const certificado = await db.query(
            'SELECT planta_key FROM fg_certificado WHERE id = $1',
            [idCertificado]
        );
        if (!certificado.rowCount || certificado.rows[0].planta_key !== plantaKey) {
            throw new Error('CERTIFICADO_INVALIDO');
        }
    }

    const result = await db.query(`
        SELECT c.id, c.numero_chip, c.estado, c.planta_actual_key,
               p.nombre AS planta_nombre,
               cc.certificado_id
        FROM fg_chip c
        JOIN fg_planta p ON p.key = c.planta_actual_key
        LEFT JOIN fg_certificado_chip cc ON cc.chip_id = c.id
        WHERE c.numero_chip = $1
    `, [numero]);

    if (!result.rowCount) {
        return {
            numeroChip: numero,
            encontrado: false,
            disponible: false,
            asignadoAlCertificado: false,
            codigo: 'CHIP_NO_ENCONTRADO'
        };
    }

    const chip = result.rows[0];
    const asignadoAlCertificado = idCertificado !== null
        && Number(chip.certificado_id) === idCertificado;
    let codigo = 'CHIP_NO_DISPONIBLE';
    if (chip.planta_actual_key !== plantaKey) codigo = 'CHIP_OTRA_SEDE';
    else if (asignadoAlCertificado && ['DISPONIBLE', 'VENDIDO'].includes(chip.estado)) codigo = 'ASIGNADO_CERTIFICADO';
    else if (!chip.certificado_id && chip.estado === 'DISPONIBLE') codigo = 'DISPONIBLE';

    return {
        id: Number(chip.id),
        numeroChip: chip.numero_chip,
        encontrado: true,
        disponible: codigo === 'DISPONIBLE' || codigo === 'ASIGNADO_CERTIFICADO',
        asignadoAlCertificado,
        estado: chip.estado,
        plantaNombre: chip.planta_nombre,
        codigo
    };
};

exports.ingresar = async ({ plantaKey, productoInventariableId, numeros, referencia }, user) => {
    await validarAcceso(user, plantaKey);
    const lote = normalizarLoteScanner(Array.isArray(numeros) ? numeros.join('\n') : numeros);
    if (!lote.validos.length || lote.duplicados.length || lote.errores.length) {
        const error = new Error('LOTE_CHIPS_INVALIDO'); error.detalles = lote; throw error;
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const producto = await productoInventariable(client, productoInventariableId || null, true);
        const existentes = await client.query('SELECT numero_chip FROM fg_chip WHERE numero_chip = ANY($1::varchar[])', [lote.validos]);
        if (existentes.rowCount) {
            const error = new Error('CHIP_DUPLICADO'); error.detalles = existentes.rows.map(r => r.numero_chip); throw error;
        }
        const creados = [];
        for (const numero of lote.validos) {
            const chip = await client.query(`INSERT INTO fg_chip
                (producto_inventariable_id,numero_chip,planta_actual_key,creado_por)
                VALUES ($1,$2,$3,$4) RETURNING id,numero_chip,estado`, [producto.id, numero, plantaKey, user.username]);
            creados.push(chip.rows[0]);
            await client.query(`INSERT INTO fg_chip_movimiento
                (chip_id,tipo_movimiento,planta_destino_key,usuario,referencia)
                VALUES ($1,'INGRESO',$2,$3,$4)`, [chip.rows[0].id, plantaKey, user.username, referencia || null]);
        }
        await client.query('COMMIT'); return creados;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
};

exports.transferir = async ({ origenKey, destinoKey, productoInventariableId, numeros, referencia }, user) => {
    if (origenKey === destinoKey) throw new Error('SEDES_IGUALES');
    await validarAcceso(user, origenKey); await validarAcceso(user, destinoKey);
    const lote = normalizarLoteScanner(Array.isArray(numeros) ? numeros.join('\n') : numeros);
    if (!lote.validos.length || lote.duplicados.length || lote.errores.length) throw new Error('LOTE_CHIPS_INVALIDO');
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const producto = await productoInventariable(client, productoInventariableId || null, true);
        const chips = await client.query(`SELECT id,numero_chip,estado,planta_actual_key FROM fg_chip
            WHERE numero_chip=ANY($1::varchar[])
              AND producto_inventariable_id=$2
            ORDER BY id FOR UPDATE`, [lote.validos, producto.id]);
        if (chips.rowCount !== lote.validos.length) throw new Error('CHIP_NO_ENCONTRADO');
        for (const chip of chips.rows) {
            if (chip.planta_actual_key !== origenKey) throw new Error('CHIP_OTRA_SEDE');
            if (chip.estado !== 'DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');
            const seleccionado = await client.query('SELECT 1 FROM fg_certificado_chip WHERE chip_id = $1', [chip.id]);
            if (seleccionado.rowCount) throw new Error('CHIP_ASIGNADO_CERTIFICADO');
            await client.query(`UPDATE fg_chip SET planta_actual_key=$2,actualizado_por=$3,actualizado_en=NOW() WHERE id=$1`, [chip.id,destinoKey,user.username]);
            await client.query(`INSERT INTO fg_chip_movimiento
                (chip_id,tipo_movimiento,planta_origen_key,planta_destino_key,usuario,referencia)
                VALUES ($1,'TRANSFERENCIA',$2,$3,$4,$5)`, [chip.id,origenKey,destinoKey,user.username,referencia||null]);
        }
        await client.query('COMMIT'); return chips.rowCount;
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
};

exports.reservar = async ({ plantaKey, numeroChip, operacionId, certificadoId }, user) => {
    await validarAcceso(user, plantaKey);
    const numero = normalizarNumeroChip(numeroChip);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const config = await productoChip(client, plantaKey, true);
        exigirStockPermitido(config);
        const chipRes = await client.query('SELECT * FROM fg_chip WHERE numero_chip=$1 FOR UPDATE', [numero]);
        if (!chipRes.rowCount) throw new Error('CHIP_NO_ENCONTRADO');
        const chip = chipRes.rows[0];
        if (chip.planta_actual_key !== plantaKey) throw new Error('CHIP_OTRA_SEDE');
        if (chip.estado !== 'DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');
        const op = await client.query('SELECT id,planta_key,estado FROM fg_operacion_comercial WHERE id=$1 FOR UPDATE', [operacionId]);
        if (!op.rowCount || op.rows[0].planta_key !== plantaKey || !['BORRADOR','PENDIENTE_PAGO'].includes(op.rows[0].estado)) throw new Error('OPERACION_NO_RESERVABLE');
        if (certificadoId) {
            const cert = await client.query('SELECT id,planta_key FROM fg_certificado WHERE id=$1', [certificadoId]);
            if (!cert.rowCount || cert.rows[0].planta_key !== plantaKey) throw new Error('CERTIFICADO_INVALIDO');
            await client.query('INSERT INTO fg_certificado_chip(certificado_id,chip_id) VALUES($1,$2)', [certificadoId,chip.id]);
        }
        await client.query(`UPDATE fg_chip SET estado='RESERVADO',operacion_reserva_id=$2,reservado_en=NOW(),actualizado_por=$3,actualizado_en=NOW() WHERE id=$1`, [chip.id,operacionId||null,user.username]);
        await client.query(`INSERT INTO fg_chip_movimiento(chip_id,tipo_movimiento,planta_origen_key,usuario,certificado_id,operacion_comercial_id)
            VALUES($1,'RESERVA',$2,$3,$4,$5)`, [chip.id,plantaKey,user.username,certificadoId||null,operacionId||null]);
        await client.query('COMMIT'); return { id: chip.id, numeroChip: chip.numero_chip, estado: 'RESERVADO' };
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
};

exports.liberar = async ({ plantaKey, numeroChip, operacionId, referencia }, user) => {
    await validarAcceso(user, plantaKey); const numero=normalizarNumeroChip(numeroChip);
    const client=await db.connect();
    try { await client.query('BEGIN');
        const r=await client.query('SELECT * FROM fg_chip WHERE numero_chip=$1 FOR UPDATE',[numero]);
        if(!r.rowCount) throw new Error('CHIP_NO_ENCONTRADO'); const chip=r.rows[0];
        if(chip.planta_actual_key!==plantaKey) throw new Error('CHIP_OTRA_SEDE');
        if(chip.estado!=='RESERVADO' || Number(chip.operacion_reserva_id)!==Number(operacionId)) throw new Error('RESERVA_NO_COINCIDE');
        await client.query('DELETE FROM fg_certificado_chip WHERE chip_id=$1',[chip.id]);
        await client.query(`UPDATE fg_chip SET estado='DISPONIBLE',operacion_reserva_id=NULL,reservado_en=NULL,actualizado_por=$2,actualizado_en=NOW() WHERE id=$1`,[chip.id,user.username]);
        await client.query(`INSERT INTO fg_chip_movimiento(chip_id,tipo_movimiento,planta_origen_key,usuario,operacion_comercial_id,referencia) VALUES($1,'LIBERACION',$2,$3,$4,$5)`,[chip.id,plantaKey,user.username,operacionId,referencia||null]);
        await client.query('COMMIT');
    } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
};

exports.iniciarVentaSoloChip = async ({ plantaKey, numeroChip, clienteId }, user) => {
    await validarAcceso(user, plantaKey);
    const numero = normalizarNumeroChip(numeroChip);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const config = await productoChip(client, plantaKey, true);
        exigirStockPermitido(config);
        exigirVentaHabilitada(config);

        const chipRes = await client.query('SELECT * FROM fg_chip WHERE numero_chip=$1 FOR UPDATE', [numero]);
        if (!chipRes.rowCount) throw new Error('CHIP_NO_ENCONTRADO');
        const chip = chipRes.rows[0];
        if (chip.planta_actual_key !== plantaKey) throw new Error('CHIP_OTRA_SEDE');
        if (chip.estado !== 'DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');

        const pf = await client.query('SELECT * FROM fg_producto_facturacion WHERE id=$1', [config.producto_facturacion_id]);
        if (!pf.rowCount) throw new Error('PRODUCTO_FISCAL_CHIP_INVALIDO');
        const pfData = pf.rows[0];

        const base = redondear(Number(config.precio) / 1.18);
        const igv = redondear(Number(config.precio) - base);

        const operacion = await client.query(`
            INSERT INTO fg_operacion_comercial (
                planta_key, cliente_id, moneda_key, base_imponible, igv,
                importe_total, estado, usuario_creacion
            ) VALUES ($1,$2,'sol',$3,$4,$5,'PENDIENTE_PAGO',$6) RETURNING id
        `, [plantaKey, clienteId || null, base, igv, Number(config.precio), user.username]);
        const operacionId = Number(operacion.rows[0].id);

        await client.query(`
            INSERT INTO fg_operacion_detalle (
                operacion_id, tipo_item, cantidad, codigo_sku_snapshot, descripcion_snapshot,
                unidad_snapshot, afectacion_igv_snapshot, codigo_sunat_snapshot,
                producto_facturacion_id, valor_unitario, precio_unitario, base_imponible, igv,
                importe_total, genera_certificado_snapshot, orden
            ) VALUES ($1,'PRODUCTO',1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,$9,FALSE,1)
        `, [
            operacionId,
            pfData.codigo_sku,
            pfData.descripcion,
            pfData.unidad,
            pfData.tipo_afectacion_igv,
            pfData.codigo_clasificacion_sunat,
            pfData.id,
            base,
            Number(config.precio),
            igv
        ]);

        await client.query(`UPDATE fg_chip SET estado='RESERVADO',operacion_reserva_id=$2,reservado_en=NOW(),actualizado_por=$3,actualizado_en=NOW() WHERE id=$1`, [chip.id,operacionId,user.username]);
        await client.query(`INSERT INTO fg_chip_movimiento(chip_id,tipo_movimiento,planta_origen_key,usuario,operacion_comercial_id)
            VALUES($1,'RESERVA',$2,$3,$4)`, [chip.id,plantaKey,user.username,operacionId]);
        
        await client.query('COMMIT');
        return { operacionId, chipId: chip.id, numeroChip: chip.numero_chip, precio: Number(config.precio) };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.vender = async ({ plantaKey, numeroChip, operacionId, detalleId }, user) => {
    await validarAcceso(user, plantaKey); const numero=normalizarNumeroChip(numeroChip);
    const client=await db.connect();
    try { await client.query('BEGIN');
        const config=await productoChip(client,plantaKey,true);
        exigirStockPermitido(config);
        exigirVentaHabilitada(config);
        const r=await client.query('SELECT * FROM fg_chip WHERE numero_chip=$1 FOR UPDATE',[numero]);
        if(!r.rowCount) throw new Error('CHIP_NO_ENCONTRADO'); const chip=r.rows[0];
        if(chip.planta_actual_key!==plantaKey) throw new Error('CHIP_OTRA_SEDE');
        if(chip.estado!=='RESERVADO' || Number(chip.operacion_reserva_id)!==Number(operacionId)) throw new Error('RESERVA_NO_COINCIDE');
        const op=await client.query('SELECT estado FROM fg_operacion_comercial WHERE id=$1 FOR UPDATE',[operacionId]);
        if(!op.rowCount || !['PAGADO','FACTURADO'].includes(op.rows[0].estado)) throw new Error('OPERACION_NO_PAGADA');
        const detalle=await client.query('SELECT id,operacion_id,producto_facturacion_id FROM fg_operacion_detalle WHERE id=$1',[detalleId]);
        if(!detalle.rowCount || Number(detalle.rows[0].operacion_id)!==Number(operacionId) || Number(detalle.rows[0].producto_facturacion_id)!==Number(config.producto_facturacion_id)) throw new Error('DETALLE_CHIP_INVALIDO');
        await client.query('INSERT INTO fg_operacion_detalle_chip(operacion_detalle_id,chip_id) VALUES($1,$2)',[detalleId,chip.id]);
        await client.query(`UPDATE fg_chip SET estado='VENDIDO',operacion_reserva_id=NULL,reservado_en=NULL,actualizado_por=$2,actualizado_en=NOW() WHERE id=$1`,[chip.id,user.username]);
        await client.query(`INSERT INTO fg_chip_movimiento(chip_id,tipo_movimiento,planta_origen_key,usuario,operacion_comercial_id) VALUES($1,'VENTA',$2,$3,$4)`,[chip.id,plantaKey,user.username,operacionId]);
        await client.query('COMMIT');
    } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
};

exports.baja = async ({ plantaKey, numeroChip, referencia }, user) => {
    await validarAcceso(user,plantaKey); const numero=normalizarNumeroChip(numeroChip); const client=await db.connect();
    try{await client.query('BEGIN'); const r=await client.query('SELECT * FROM fg_chip WHERE numero_chip=$1 FOR UPDATE',[numero]);
        if(!r.rowCount) throw new Error('CHIP_NO_ENCONTRADO'); const chip=r.rows[0];
        if(chip.planta_actual_key!==plantaKey) throw new Error('CHIP_OTRA_SEDE'); if(chip.estado!=='DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');
        await client.query(`UPDATE fg_chip SET estado='BAJA',actualizado_por=$2,actualizado_en=NOW() WHERE id=$1`,[chip.id,user.username]);
        await client.query(`INSERT INTO fg_chip_movimiento(chip_id,tipo_movimiento,planta_origen_key,usuario,referencia) VALUES($1,'BAJA',$2,$3,$4)`,[chip.id,plantaKey,user.username,referencia||null]); await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
};

exports.historial = async (id, user) => {
    const chip=await db.query('SELECT planta_actual_key FROM fg_chip WHERE id=$1',[id]);
    if(!chip.rowCount) throw new Error('CHIP_NO_ENCONTRADO'); await validarAcceso(user,chip.rows[0].planta_actual_key);
    const r=await db.query(`SELECT m.*,po.nombre planta_origen,pd.nombre planta_destino FROM fg_chip_movimiento m
        LEFT JOIN fg_planta po ON po.key=m.planta_origen_key LEFT JOIN fg_planta pd ON pd.key=m.planta_destino_key
        WHERE m.chip_id=$1 ORDER BY m.fecha DESC,m.id DESC`,[id]); return r.rows;
};

exports.listarCatalogoChipsFiscales = async () => {
    const result = await db.query(`
        SELECT id, codigo, nombre
        FROM fg_producto_inventariable
        WHERE activo = TRUE AND control_stock = TRUE AND tipo = 'CHIP_SERIALIZADO'
        ORDER BY nombre ASC
    `);
    return result.rows;
};
