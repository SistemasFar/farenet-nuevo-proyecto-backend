const db = require('../../../config/database');
const documentoTributarioPolicy = require('./faregas-documento-tributario-policy');

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));
const unique = (values) => [...new Set(values.filter((value) => value !== null && value !== undefined))];
const idList = (rows, key = 'id') => unique(rows.map((row) => Number(row[key])));
const arrayIds = (values) => unique(values.map(Number).filter((value) => Number.isFinite(value)));

const querySiHayIds = async (client, sql, ids, params = []) => {
    if (!ids || ids.length === 0) return { rows: [], rowCount: 0 };
    return client.query(sql, [...params, ids]);
};

const obtenerTarifasAfectadas = async (client, productoId) => {
    const directas = await client.query(`
        SELECT t.id, t.servicio_id, t.activo, t.producto_facturacion_id,
               t.planta_key, t.codigo AS tarifa_codigo
        FROM fg_tarifa t
        WHERE t.producto_facturacion_id = $1
        FOR UPDATE OF t
    `, [productoId]);

    const porChip = await client.query(`
        SELECT t.id, t.servicio_id, t.activo, t.producto_facturacion_id,
               t.planta_key, t.codigo AS tarifa_codigo
        FROM fg_tarifa t
        JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
        JOIN fg_producto_inventariable pi
          ON pi.id = pf.producto_chip_id
         AND pi.activo = TRUE
         AND pi.control_stock = TRUE
         AND pi.tipo = 'CHIP_SERIALIZADO'
        LEFT JOIN fg_producto_inventariable_sede pis
          ON pis.producto_inventariable_id = pi.id
         AND pis.planta_key = t.planta_key
         AND pis.activo = TRUE
        WHERE COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id) = $1
        FOR UPDATE OF t
    `, [productoId]);

    const porId = new Map(directas.rows.map((row) => [Number(row.id), row]));
    for (const row of porChip.rows) {
        if (!porId.has(Number(row.id))) porId.set(Number(row.id), row);
    }
    return [...porId.values()];
};

const obtenerOperacionesImpacto = async (client, productoId, tarifaIds) => {
    const operaciones = await client.query(`
        WITH target_ops AS (
            SELECT DISTINCT od.operacion_id
            FROM fg_operacion_detalle od
            WHERE od.producto_facturacion_id = $1
               OR od.tarifa_id = ANY($2::integer[])
        )
        SELECT o.id, o.estado, o.planta_key, o.fecha_creacion,
               COUNT(od.id)::int AS total_detalles,
               COUNT(*) FILTER (WHERE od.producto_facturacion_id = $1)::int AS detalles_producto
        FROM target_ops x
        JOIN fg_operacion_comercial o ON o.id = x.operacion_id
        JOIN fg_operacion_detalle od ON od.operacion_id = o.id
        GROUP BY o.id, o.estado, o.planta_key, o.fecha_creacion
        ORDER BY o.id
    `, [productoId, tarifaIds]);

    if (operaciones.rowCount === 0) return [];

    const detalles = await client.query(`
        SELECT od.id, od.operacion_id, od.orden, od.tipo_item,
               od.servicio_id, od.tarifa_id, od.producto_facturacion_id,
               od.certificado_id, od.codigo_sku_snapshot,
               od.descripcion_snapshot, od.unidad_snapshot,
               od.afectacion_igv_snapshot, od.precio_unitario,
               od.importe_total,
               p.codigo_sku AS producto_codigo_sku,
               p.descripcion AS producto_descripcion
        FROM fg_operacion_detalle od
        LEFT JOIN fg_producto_facturacion p ON p.id = od.producto_facturacion_id
        WHERE od.operacion_id = ANY($1::bigint[])
        ORDER BY od.operacion_id, od.orden, od.id
    `, [operaciones.rows.map((row) => Number(row.id))]);

    const porOperacion = new Map(operaciones.rows.map((row) => [Number(row.id), {
        id: Number(row.id),
        estado: row.estado,
        planta_key: row.planta_key,
        fecha_creacion: row.fecha_creacion,
        total_detalles: Number(row.total_detalles),
        detalles_producto: Number(row.detalles_producto),
        productos: [],
        detalles: []
    }]));

    for (const detalle of detalles.rows) {
        const operacion = porOperacion.get(Number(detalle.operacion_id));
        if (!operacion) continue;
        if (detalle.producto_facturacion_id !== null && detalle.producto_facturacion_id !== undefined) {
            const productoId = Number(detalle.producto_facturacion_id);
            if (!operacion.productos.some((producto) => producto.id === productoId)) {
                operacion.productos.push({
                    id: productoId,
                    codigo_sku: detalle.producto_codigo_sku,
                    descripcion: detalle.producto_descripcion
                });
            }
        }
        operacion.detalles.push({
            id: Number(detalle.id),
            orden: Number(detalle.orden),
            tipo_item: detalle.tipo_item,
            producto_facturacion_id: toNumber(detalle.producto_facturacion_id),
            producto_codigo_sku: detalle.producto_codigo_sku,
            producto_descripcion: detalle.producto_descripcion,
            servicio_id: toNumber(detalle.servicio_id),
            tarifa_id: toNumber(detalle.tarifa_id),
            certificado_id: toNumber(detalle.certificado_id),
            codigo_sku_snapshot: detalle.codigo_sku_snapshot,
            descripcion_snapshot: detalle.descripcion_snapshot,
            unidad_snapshot: detalle.unidad_snapshot,
            afectacion_igv_snapshot: detalle.afectacion_igv_snapshot,
            precio_unitario: detalle.precio_unitario === null ? null : Number(detalle.precio_unitario),
            importe_total: detalle.importe_total === null ? null : Number(detalle.importe_total)
        });
    }

    return [...porOperacion.values()].map((operacion) => ({
        ...operacion,
        mixta: operacion.productos.length > 1,
        certificado_ids: unique(operacion.detalles.map((detalle) => detalle.certificado_id))
    }));
};

const obtenerCertificadosImpacto = async (client, productoId, certificadoIds) => {
    return client.query(`
        SELECT c.id, c.estado, c.numero_certificado, c.tipo_certificado_clave,
               c.tarifa_codigo, c.planta_key,
               c.producto_facturacion_certificado_id,
               c.producto_facturacion_chip_id
        FROM fg_certificado c
        WHERE c.producto_facturacion_certificado_id = $1
           OR c.producto_facturacion_chip_id = $1
           OR c.id = ANY($2::bigint[])
        ORDER BY c.id
    `, [productoId, certificadoIds]);
};

const obtenerFinancieroImpacto = async (client, operacionIds, certificadoIds) => {
    const hayAlguno = operacionIds.length > 0 || certificadoIds.length > 0;
    const facturaciones = hayAlguno ? await client.query(`
        SELECT f.id, f.operacion_id, f.certificado_id, f.estado,
               f.nro_comprobante, f.proveedor, f.aceptada_sunat
        FROM fg_facturacion f
        WHERE f.operacion_id = ANY($1::bigint[])
           OR f.certificado_id = ANY($2::bigint[])
        ORDER BY f.id
    `, [operacionIds, certificadoIds]) : { rows: [] };

    const ordenesPago = hayAlguno ? await client.query(`
        SELECT op.id, op.operacion_id, op.certificado_id, op.estado,
               op.importe_total, op.importe_pagado, op.saldo_pendiente
        FROM fg_orden_pago op
        WHERE op.operacion_id = ANY($1::bigint[])
           OR op.certificado_id = ANY($2::bigint[])
        ORDER BY op.id
    `, [operacionIds, certificadoIds]) : { rows: [] };

    const pagos = await querySiHayIds(client, `
        SELECT pg.id, pg.orden_pago_id, pg.importe
        FROM fg_pago pg
        WHERE pg.orden_pago_id = ANY($1::bigint[])
        ORDER BY pg.id
    `, idList(ordenesPago.rows));

    return {
        facturaciones: facturaciones.rows.map((row) => ({
            ...row,
            id: Number(row.id),
            operacion_id: toNumber(row.operacion_id),
            certificado_id: toNumber(row.certificado_id)
        })),
        ordenesPago: ordenesPago.rows.map((row) => ({
            ...row,
            id: Number(row.id),
            operacion_id: toNumber(row.operacion_id),
            certificado_id: toNumber(row.certificado_id),
            importe_total: Number(row.importe_total),
            importe_pagado: Number(row.importe_pagado),
            saldo_pendiente: Number(row.saldo_pendiente)
        })),
        pagos: pagos.rows.map((row) => ({
            ...row,
            id: Number(row.id),
            orden_pago_id: toNumber(row.orden_pago_id),
            importe: Number(row.importe)
        }))
    };
};

const obtenerMappingsImpacto = async (client, productoId) => {
    const productoSede = await client.query(`
        SELECT id, planta_key, producto_facturacion_id, precio, activo
        FROM fg_producto_sede WHERE producto_facturacion_id = $1
        ORDER BY id
    `, [productoId]);
    const inventariable = await client.query(`
        SELECT id, codigo, nombre, producto_facturacion_id, activo
        FROM fg_producto_inventariable WHERE producto_facturacion_id = $1
        ORDER BY id
    `, [productoId]);
    const inventariableSede = await client.query(`
        SELECT pis.id, pis.producto_inventariable_id, pi.codigo,
               pi.nombre, pis.planta_key, pis.producto_facturacion_id, pis.activo
        FROM fg_producto_inventariable_sede pis
        JOIN fg_producto_inventariable pi ON pi.id = pis.producto_inventariable_id
        WHERE pis.producto_facturacion_id = $1
        ORDER BY pis.id
    `, [productoId]);
    return {
        producto_sede: productoSede.rows,
        producto_inventariable: inventariable.rows,
        producto_inventariable_sede: inventariableSede.rows
    };
};

const obtenerServiciosImpacto = async (client, tarifas) => {
    const ids = unique(tarifas.map((tarifa) => Number(tarifa.servicio_id)));
    if (ids.length === 0) return [];
    const result = await client.query(`
        SELECT s.id, s.codigo, s.nombre, s.activo, c.codigo AS categoria_codigo,
               EXISTS (
                   SELECT 1
                   FROM fg_tarifa otra
                   WHERE otra.servicio_id = s.id
                     AND otra.activo = TRUE
                     AND otra.id <> ALL($2::integer[])
               ) AS tiene_otra_tarifa_activa
        FROM fg_servicio s
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        WHERE s.id = ANY($1::integer[])
        ORDER BY s.id
    `, [ids, tarifas.map((tarifa) => Number(tarifa.id))]);
    return result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        tiene_otra_tarifa_activa: Boolean(row.tiene_otra_tarifa_activa)
    }));
};

const obtenerChipsImpacto = async (client, operacionIds, certificadoIds) => {
    const reservas = await querySiHayIds(client, `
        SELECT id, numero_chip, producto_inventariable_id, operacion_reserva_id
        FROM fg_chip WHERE operacion_reserva_id = ANY($1::bigint[])
        ORDER BY id
    `, operacionIds);
    const movimientos = operacionIds.length > 0 || certificadoIds.length > 0
        ? await client.query(`
            SELECT id, chip_id, certificado_id, operacion_comercial_id, tipo_movimiento
            FROM fg_chip_movimiento
            WHERE operacion_comercial_id = ANY($1::bigint[])
               OR certificado_id = ANY($2::bigint[])
            ORDER BY id
        `, [operacionIds, certificadoIds])
        : { rows: [] };
    return { reservas: reservas.rows, movimientos: movimientos.rows };
};

const calcularImpactoEnTransaccion = async (client, productoId, productoPrevio = null) => {
    const productoResult = productoPrevio
        ? { rows: [productoPrevio] }
        : await client.query(`
            SELECT id, codigo_sku, descripcion, activo, requiere_chip, producto_chip_id
            FROM fg_producto_facturacion WHERE id = $1
        `, [productoId]);
    if (productoResult.rowCount === 0) throw new Error('PRODUCTO_NO_ENCONTRADO');
    const producto = productoResult.rows[0];

    const tarifas = await obtenerTarifasAfectadas(client, productoId);
    const tarifaIds = idList(tarifas);
    const operaciones = await obtenerOperacionesImpacto(client, productoId, tarifaIds);
    for (const operacion of operaciones) {
        if (
            operacion.detalles.some((detalle) => tarifaIds.includes(Number(detalle.tarifa_id)))
            && !operacion.productos.some((otro) => otro.id === Number(productoId))
        ) {
            operacion.productos.push({
                id: Number(productoId),
                codigo_sku: producto.codigo_sku,
                descripcion: producto.descripcion
            });
        }
        operacion.mixta = operacion.productos.length > 1;
    }
    const operacionesMixtas = operaciones.filter((operacion) => operacion.mixta);
    const certificadoIdsOperaciones = unique(
        operaciones.flatMap((operacion) => operacion.certificado_ids)
    );
    const certificados = await obtenerCertificadosImpacto(
        client, productoId, certificadoIdsOperaciones
    );
    const certificadoIdsMixtos = unique(
        operacionesMixtas.flatMap((operacion) => operacion.certificado_ids)
    );

    const externosResult = certificadoIdsMixtos.length > 0
        ? await client.query(`
            SELECT od.certificado_id,
                   COUNT(*) FILTER (
                       WHERE od.operacion_id <> ALL($1::bigint[])
                   )::int AS operacion_externas
            FROM fg_operacion_detalle od
            WHERE od.certificado_id = ANY($2::bigint[])
            GROUP BY od.certificado_id
        `, [operacionesMixtas.map((operacion) => operacion.id), certificadoIdsMixtos])
        : { rows: [] };
    const certExternos = new Map(externosResult.rows.map((row) => [
        Number(row.certificado_id), Number(row.operacion_externas)
    ]));
    const certificadosMixtos = certificados.rows
        .filter((certificado) => certificadoIdsMixtos.includes(Number(certificado.id)))
        .map((certificado) => ({
            ...certificado,
            id: Number(certificado.id),
            producto_facturacion_certificado_id: toNumber(certificado.producto_facturacion_certificado_id),
            producto_facturacion_chip_id: toNumber(certificado.producto_facturacion_chip_id),
            operacion_externas: certExternos.get(Number(certificado.id)) || 0
        }));
    const certificadosAEliminar = certificadosMixtos
        .filter((certificado) => certificado.operacion_externas === 0)
        .map((certificado) => certificado.id);

    const financiero = await obtenerFinancieroImpacto(
        client,
        operacionesMixtas.map((operacion) => operacion.id),
        certificadoIdsMixtos
    );
    const financieroRelacionado = await obtenerFinancieroImpacto(
        client,
        operaciones.map((operacion) => operacion.id),
        certificadoIdsOperaciones
    );
    const mappings = await obtenerMappingsImpacto(client, productoId);
    const servicios = await obtenerServiciosImpacto(client, tarifas);
    const chips = await obtenerChipsImpacto(
        client,
        operacionesMixtas.map((operacion) => operacion.id),
        certificadoIdsMixtos
    );

    const otrosProductosMap = new Map();
    for (const operacion of operacionesMixtas) {
        for (const otro of operacion.productos) {
            if (otro.id === Number(productoId)) continue;
            if (!otrosProductosMap.has(otro.id)) otrosProductosMap.set(otro.id, otro);
        }
    }

    return {
        producto: {
            id: Number(producto.id),
            codigo_sku: producto.codigo_sku,
            descripcion: producto.descripcion
        },
        requiereConfirmacionConjunto: operacionesMixtas.length > 0,
        operaciones,
        operacionesMixtas,
        otrosProductos: [...otrosProductosMap.values()],
        certificados: certificados.rows.map((certificado) => ({
            ...certificado,
            id: Number(certificado.id),
            producto_facturacion_certificado_id: toNumber(certificado.producto_facturacion_certificado_id),
            producto_facturacion_chip_id: toNumber(certificado.producto_facturacion_chip_id)
        })),
        certificadosMixtos,
        certificadosAEliminar,
        certificadosPreservados: certificadoIdsMixtos.filter((id) => !certificadosAEliminar.includes(id)),
        ...financiero,
        financieroRelacionado,
        tarifas,
        mappings,
        servicios,
        chips
    };
};

const preview = async (productoId) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const producto = await client.query(`
            SELECT id, codigo_sku, descripcion, activo, requiere_chip, producto_chip_id
            FROM fg_producto_facturacion WHERE id = $1 FOR UPDATE
        `, [productoId]);
        if (producto.rowCount === 0) throw new Error('PRODUCTO_NO_ENCONTRADO');
        const impacto = await calcularImpactoEnTransaccion(client, productoId, producto.rows[0]);
        await client.query('ROLLBACK');
        return impacto;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* conserva error original */ }
        throw error;
    } finally {
        client.release();
    }
};

const ESTADOS_FACTURACION_PROTEGIDA = ['PENDIENTE_SUNAT', 'ACEPTADO', 'ANULADO'];

const esFacturacionProtegida = (factura) => (
    ESTADOS_FACTURACION_PROTEGIDA.includes(String(factura.estado || '').trim().toUpperCase())
    || factura.aceptada_sunat === true
    || Boolean(factura.nro_comprobante)
);

const eliminarOperacionesMixtas = async (client, impacto, opciones = {}) => {
    const operacionIds = idList(impacto.operacionesMixtas);
    const detalleIds = unique(impacto.operacionesMixtas.flatMap((operacion) => operacion.detalles.map((detalle) => Number(detalle.id))));
    const certificadoIds = idList(impacto.certificadosMixtos);
    const certificadosAEliminar = arrayIds(impacto.certificadosAEliminar);
    const certificadosFinancieros = certificadosAEliminar;
    const facturaRows = (impacto.facturaciones || []).filter((factura) => (
        operacionIds.includes(Number(factura.operacion_id))
        || certificadosFinancieros.includes(Number(factura.certificado_id))
    ));
    const ordenRows = (impacto.ordenesPago || []).filter((orden) => (
        operacionIds.includes(Number(orden.operacion_id))
        || certificadosFinancieros.includes(Number(orden.certificado_id))
    ));
    const facturacionIds = idList(facturaRows);
    const ordenPagoIds = idList(ordenRows);
    const pagoIds = idList((impacto.pagos || []).filter((pago) => ordenPagoIds.includes(Number(pago.orden_pago_id))));
    const otrosProductos = impacto.otrosProductos.map((producto) => producto.id);
    // La habilitación de limpieza local sólo la concede el backend y sólo en
    // ambiente no productivo (integrations.config). Nunca llega del frontend.
    const limpiezaLocalHabilitada = opciones.permitirComprobantesDemo === true
        && documentoTributarioPolicy.permiteLimpiezaLocalDeComprobantes();
    const facturasProtegidas = facturaRows.filter(esFacturacionProtegida);
    const facturasBloqueantes = facturasProtegidas.filter((factura) => (
        !limpiezaLocalHabilitada
        || !documentoTributarioPolicy.esDocumentoFacturacionDemoLocal(factura)
    ));
    if (facturasBloqueantes.length > 0) {
        const error = new Error('FACTURACION_PROTEGIDA');
        error.codigo = 'FACTURACION_PROTEGIDA';
        error.detalles = {
            facturaciones: facturasBloqueantes,
            ambiente: documentoTributarioPolicy.entornoFacturacionEfectivo(),
            limpiezaLocalHabilitada
        };
        throw error;
    }

    if (operacionIds.length === 0) {
        return {
            operacionesEliminadas: 0,
            detallesEliminados: 0,
            facturacionesEliminadas: 0,
            ordenesPagoEliminadas: 0,
            pagosEliminados: 0,
            certificadosEliminados: 0,
            descuentosAjustados: 0,
            chipsDesvinculados: 0,
            otrosProductosPreservados: otrosProductos,
            limpiezaLocalHabilitada,
            comprobantesLocalesEliminados: limpiezaLocalHabilitada ? facturasProtegidas.length : 0
        };
    }

    if (operacionIds.length > 0) {
        await client.query('SELECT id FROM fg_operacion_comercial WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [operacionIds]);
    }
    if (certificadoIds.length > 0) {
        await client.query('SELECT id FROM fg_certificado WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [certificadoIds]);
    }
    if (operacionIds.length > 0) {
        await client.query('SELECT id FROM fg_chip WHERE operacion_reserva_id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [operacionIds]);
        await client.query(`
            SELECT id FROM fg_chip_movimiento
            WHERE operacion_comercial_id = ANY($1::bigint[])
               OR certificado_id = ANY($2::bigint[])
            ORDER BY id FOR UPDATE
        `, [operacionIds, certificadoIds]);
    }
    if (facturacionIds.length > 0) {
        await client.query('SELECT id FROM fg_facturacion WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [facturacionIds]);
    }
    if (ordenPagoIds.length > 0) {
        await client.query('SELECT id FROM fg_orden_pago WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ordenPagoIds]);
    }

    const creditosResult = await querySiHayIds(client, `
        SELECT id FROM fg_credito WHERE facturacion_id = ANY($1::bigint[])
    `, facturacionIds);
    const debitosResult = await querySiHayIds(client, `
        SELECT id FROM fg_debito WHERE facturacion_id = ANY($1::bigint[])
    `, facturacionIds);
    const creditoIds = idList(creditosResult.rows);
    const debitoIds = idList(debitosResult.rows);
    const anulacionesResult = facturacionIds.length > 0 || creditoIds.length > 0 || debitoIds.length > 0
        ? await client.query(`
            SELECT id FROM fg_documento_anulacion
            WHERE facturacion_id = ANY($1::bigint[])
               OR credito_id = ANY($2::bigint[])
               OR debito_id = ANY($2::bigint[])
        `, [facturacionIds, unique([...creditoIds, ...debitoIds])])
        : { rows: [] };
    const anulacionIds = idList(anulacionesResult.rows);

    let documentosElectronicos = 0;
    if (facturacionIds.length > 0 || creditoIds.length > 0 || debitoIds.length > 0 || anulacionIds.length > 0) {
        const result = await client.query(`
            DELETE FROM fg_documento_electronico_operacion
            WHERE facturacion_id = ANY($1::bigint[])
               OR credito_id = ANY($2::bigint[])
               OR debito_id = ANY($2::bigint[])
               OR anulacion_id = ANY($3::bigint[])
        `, [facturacionIds, unique([...creditoIds, ...debitoIds]), anulacionIds]);
        documentosElectronicos = result.rowCount;
    }

    if (anulacionIds.length > 0) {
        await client.query('DELETE FROM fg_documento_anulacion WHERE id = ANY($1::bigint[])', [anulacionIds]);
    } else if (facturacionIds.length > 0 || creditoIds.length > 0 || debitoIds.length > 0) {
        await client.query(`
            DELETE FROM fg_documento_anulacion
            WHERE facturacion_id = ANY($1::bigint[])
               OR credito_id = ANY($2::bigint[])
               OR debito_id = ANY($2::bigint[])
        `, [facturacionIds, unique([...creditoIds, ...debitoIds])]);
    }

    let descuentosAjustados = 0;
    if (certificadosAEliminar.length > 0 || ordenPagoIds.length > 0 || facturacionIds.length > 0) {
        const descuentosResult = await client.query(`
            SELECT descuento_cliente_id, estado
            FROM fg_descuentocomprobante
            WHERE certificado_id = ANY($1::bigint[])
               OR orden_pago_id = ANY($2::bigint[])
               OR facturacion_id = ANY($3::bigint[])
        `, [certificadosAEliminar, ordenPagoIds, facturacionIds]);
        await client.query(`
            DELETE FROM fg_descuentocomprobante
            WHERE certificado_id = ANY($1::bigint[])
               OR orden_pago_id = ANY($2::bigint[])
               OR facturacion_id = ANY($3::bigint[])
        `, [certificadosAEliminar, ordenPagoIds, facturacionIds]);
        const usosPorCliente = new Map();
        for (const descuento of descuentosResult.rows) {
            if (descuento.estado !== 'APLICADO' || descuento.descuento_cliente_id === null) continue;
            const clienteId = Number(descuento.descuento_cliente_id);
            usosPorCliente.set(clienteId, (usosPorCliente.get(clienteId) || 0) + 1);
        }
        for (const [clienteId, usos] of usosPorCliente) {
            await client.query(`
                UPDATE fg_descuentocliente
                SET usos_realizados = GREATEST(0, usos_realizados - $2),
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [clienteId, usos]);
            descuentosAjustados += usos;
        }
    }

    if (facturacionIds.length > 0) {
        await client.query('DELETE FROM fg_facturacion_intento WHERE facturacion_id = ANY($1::bigint[])', [facturacionIds]);
        await client.query('DELETE FROM fg_facturacion_cuota WHERE facturacion_id = ANY($1::bigint[])', [facturacionIds]);
    }
    if (creditoIds.length > 0) await client.query('DELETE FROM fg_credito WHERE id = ANY($1::bigint[])', [creditoIds]);
    if (debitoIds.length > 0) await client.query('DELETE FROM fg_debito WHERE id = ANY($1::bigint[])', [debitoIds]);
    if (facturacionIds.length > 0) await client.query('DELETE FROM fg_facturacion WHERE id = ANY($1::bigint[])', [facturacionIds]);
    if (pagoIds.length > 0) await client.query('DELETE FROM fg_pago WHERE id = ANY($1::bigint[])', [pagoIds]);
    if (ordenPagoIds.length > 0) await client.query('DELETE FROM fg_orden_pago WHERE id = ANY($1::bigint[])', [ordenPagoIds]);

    await client.query(`
        UPDATE fg_chip
        SET operacion_reserva_id = NULL,
            estado = CASE WHEN estado = 'RESERVADO' THEN 'DISPONIBLE' ELSE estado END,
            reservado_en = CASE WHEN estado = 'RESERVADO' THEN NULL ELSE reservado_en END,
            actualizado_en = CURRENT_TIMESTAMP
        WHERE operacion_reserva_id = ANY($1::bigint[])
    `, [operacionIds]);
    const movimientosResult = await client.query(`
        UPDATE fg_chip_movimiento
        SET operacion_comercial_id = CASE
                WHEN operacion_comercial_id = ANY($1::bigint[]) THEN NULL
                ELSE operacion_comercial_id
            END,
            certificado_id = CASE
                WHEN certificado_id = ANY($2::bigint[]) THEN NULL
                ELSE certificado_id
            END
        WHERE operacion_comercial_id = ANY($1::bigint[])
           OR certificado_id = ANY($2::bigint[])
    `, [operacionIds, certificadosAEliminar]);

    if (certificadosAEliminar.length > 0) {
        for (const tabla of [
            'fg_certificado_glp_componente',
            'fg_certificado_glp_verificacion',
            'fg_certificado_gnv_componente',
            'fg_certificado_gnv_verificacion',
            'fg_certificado_conformidad',
            'fg_certificado_glp',
            'fg_certificado_gnv',
            'fg_certificado_titular',
            'fg_certificado_vehiculo',
            'fg_certificado_chip'
        ]) {
            await client.query(`DELETE FROM ${tabla} WHERE certificado_id = ANY($1::bigint[])`, [certificadosAEliminar]);
        }
        await client.query(`
            UPDATE fg_vehiculo
            SET certificado_origen_id = NULL
            WHERE certificado_origen_id = ANY($1::bigint[])
        `, [certificadosAEliminar]);
    }

    if (detalleIds.length > 0) {
        await client.query('DELETE FROM fg_operacion_detalle_chip WHERE operacion_detalle_id = ANY($1::bigint[])', [detalleIds]);
        await client.query('DELETE FROM fg_operacion_detalle WHERE id = ANY($1::bigint[])', [detalleIds]);
    }
    const operacionesEliminadas = await client.query(`
        DELETE FROM fg_operacion_comercial WHERE id = ANY($1::bigint[])
    `, [operacionIds]);
    if (certificadosAEliminar.length > 0) {
        await client.query('DELETE FROM fg_certificado WHERE id = ANY($1::bigint[])', [certificadosAEliminar]);
    }

    return {
        operacionesEliminadas: operacionesEliminadas.rowCount,
        detallesEliminados: detalleIds.length,
        facturacionesEliminadas: facturacionIds.length,
        ordenesPagoEliminadas: ordenPagoIds.length,
        pagosEliminados: pagoIds.length,
        certificadosEliminados: certificadosAEliminar.length,
        documentosElectronicosEliminados: documentosElectronicos,
        descuentosAjustados,
        chipsDesvinculados: movimientosResult.rowCount,
        otrosProductosPreservados: otrosProductos,
        limpiezaLocalHabilitada,
        comprobantesLocalesEliminados: limpiezaLocalHabilitada ? facturasProtegidas.length : 0
    };
};

exports.calcularImpactoEnTransaccion = calcularImpactoEnTransaccion;
exports.eliminarOperacionesMixtas = eliminarOperacionesMixtas;
exports.preview = preview;
exports._private = { obtenerTarifasAfectadas, obtenerOperacionesImpacto };
