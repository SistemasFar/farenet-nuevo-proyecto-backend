const db = require('../../../config/database');
const productosImpactoService = require('./faregas-productos-impacto.service');
const documentoTributarioPolicy = require('./faregas-documento-tributario-policy');

const unique = (values) => [...new Set(values.filter((value) => value !== null && value !== undefined))];
const idList = (rows, key = 'id') => unique(rows.map((row) => Number(row[key])));
const arrayIds = (values) => unique(values.map(Number).filter((value) => Number.isFinite(value)));

// Un certificado sólo se elimina si nunca fue emitido: los EMITIDO/VIGENTE se
// conservan siempre para no quemar numeración ni perder trazabilidad fiscal.
const ESTADOS_CERTIFICADO_DESCARTABLE = ['BORRADOR', 'ANULADO'];

const querySiHayIds = async (client, sql, ids, params = []) => {
    if (!ids || ids.length === 0) return { rows: [], rowCount: 0 };
    return client.query(sql, [...params, ids]);
};

const obtenerFinanciero = async (client, operacionIds, certificadoIds) => {
    const hayAlguno = operacionIds.length > 0 || certificadoIds.length > 0;
    const facturaciones = hayAlguno ? await client.query(`
        SELECT id, operacion_id, certificado_id, estado, tipo_comprobante, serie, numero,
               nro_comprobante, proveedor, entorno_facturador, aceptada_sunat,
               planta_key, intentos, fecha_aceptacion
        FROM fg_facturacion
        WHERE operacion_id = ANY($1::bigint[])
           OR certificado_id = ANY($2::bigint[])
        ORDER BY id
    `, [operacionIds, certificadoIds]) : { rows: [] };
    const ordenesPago = hayAlguno ? await client.query(`
        SELECT id, operacion_id, certificado_id, estado, importe_total, importe_pagado, saldo_pendiente
        FROM fg_orden_pago
        WHERE operacion_id = ANY($1::bigint[])
           OR certificado_id = ANY($2::bigint[])
        ORDER BY id
    `, [operacionIds, certificadoIds]) : { rows: [] };
    const pagos = await querySiHayIds(client, `
        SELECT id, orden_pago_id, importe
        FROM fg_pago
        WHERE orden_pago_id = ANY($1::bigint[])
        ORDER BY id
    `, idList(ordenesPago.rows));
    const intentos = await querySiHayIds(client, `
        SELECT id, facturacion_id, numero_intento, estado, http_status, fecha_finalizacion
        FROM fg_facturacion_intento
        WHERE facturacion_id = ANY($1::bigint[])
        ORDER BY id
    `, idList(facturaciones.rows));

    return {
        facturaciones: facturaciones.rows.map((row) => ({
            ...row,
            id: Number(row.id),
            numero: row.numero === null ? null : Number(row.numero),
            intentos: Number(row.intentos || 0),
            operacion_id: row.operacion_id === null ? null : Number(row.operacion_id),
            certificado_id: row.certificado_id === null ? null : Number(row.certificado_id)
        })),
        ordenesPago: ordenesPago.rows.map((row) => ({
            ...row,
            id: Number(row.id),
            operacion_id: row.operacion_id === null ? null : Number(row.operacion_id),
            certificado_id: row.certificado_id === null ? null : Number(row.certificado_id),
            importe_total: Number(row.importe_total),
            importe_pagado: Number(row.importe_pagado),
            saldo_pendiente: Number(row.saldo_pendiente)
        })),
        pagos: pagos.rows.map((row) => ({
            ...row,
            id: Number(row.id),
            orden_pago_id: row.orden_pago_id === null ? null : Number(row.orden_pago_id),
            importe: Number(row.importe)
        })),
        intentosFacturacion: intentos.rows.map((row) => ({
            ...row,
            id: Number(row.id),
            facturacion_id: Number(row.facturacion_id),
            numero_intento: Number(row.numero_intento)
        }))
    };
};

/**
 * Veredicto de backend sobre los comprobantes del conjunto. En DEMO se pueden
 * eliminar localmente; en PRODUCCION se mantienen bloqueados.
 */
const evaluarComprobantes = (facturaciones) => {
    const ambiente = documentoTributarioPolicy.entornoFacturacionEfectivo();
    const limpiezaHabilitada = documentoTributarioPolicy.permiteLimpiezaLocalDeComprobantes();
    const protegidas = facturaciones.filter((factura) => (
        ['PENDIENTE_SUNAT', 'ACEPTADO', 'ANULADO'].includes(String(factura.estado || '').trim().toUpperCase())
        || factura.aceptada_sunat === true
        || Boolean(factura.nro_comprobante)
    ));
    const bloqueantes = protegidas.filter((factura) => (
        !limpiezaHabilitada
        || !documentoTributarioPolicy.esDocumentoFacturacionDemoLocal(factura)
    ));
    return {
        ambiente,
        limpiezaHabilitada,
        facturacionesProtegidas: protegidas,
        facturacionesBloqueantes: bloqueantes
    };
};

const obtenerOperaciones = async (client, servicioIds, tarifaIds) => {
    if (servicioIds.length === 0 && tarifaIds.length === 0) return [];
    const operaciones = await client.query(`
        WITH target_ops AS (
            SELECT DISTINCT od.operacion_id
            FROM fg_operacion_detalle od
            WHERE od.servicio_id = ANY($1::integer[])
               OR od.tarifa_id = ANY($2::integer[])
        )
        SELECT o.id, o.estado, o.planta_key, o.fecha_creacion,
               COUNT(od.id)::int AS total_detalles
        FROM target_ops x
        JOIN fg_operacion_comercial o ON o.id = x.operacion_id
        JOIN fg_operacion_detalle od ON od.operacion_id = o.id
        GROUP BY o.id, o.estado, o.planta_key, o.fecha_creacion
        ORDER BY o.id
    `, [servicioIds, tarifaIds]);
    if (operaciones.rowCount === 0) return [];

    const operacionIds = operaciones.rows.map((row) => Number(row.id));
    const detalles = await client.query(`
        SELECT od.id, od.operacion_id, od.orden, od.tipo_item,
               od.servicio_id, od.tarifa_id, od.producto_facturacion_id,
               od.certificado_id, od.codigo_sku_snapshot,
               od.descripcion_snapshot, od.unidad_snapshot,
               od.afectacion_igv_snapshot, od.precio_unitario,
               od.importe_total
        FROM fg_operacion_detalle od
        WHERE od.operacion_id = ANY($1::bigint[])
        ORDER BY od.operacion_id, od.orden, od.id
    `, [operacionIds]);

    const porOperacion = new Map(operaciones.rows.map((row) => [Number(row.id), {
        id: Number(row.id),
        estado: row.estado,
        planta_key: row.planta_key,
        fecha_creacion: row.fecha_creacion,
        total_detalles: Number(row.total_detalles),
        detalles: []
    }]));
    for (const detalle of detalles.rows) {
        const operacion = porOperacion.get(Number(detalle.operacion_id));
        if (!operacion) continue;
        operacion.detalles.push({
            id: Number(detalle.id),
            operacion_id: Number(detalle.operacion_id),
            orden: Number(detalle.orden),
            tipo_item: detalle.tipo_item,
            servicio_id: detalle.servicio_id === null ? null : Number(detalle.servicio_id),
            tarifa_id: detalle.tarifa_id === null ? null : Number(detalle.tarifa_id),
            producto_facturacion_id: detalle.producto_facturacion_id === null ? null : Number(detalle.producto_facturacion_id),
            certificado_id: detalle.certificado_id === null ? null : Number(detalle.certificado_id),
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
        certificado_ids: unique(operacion.detalles.map((detalle) => detalle.certificado_id))
    }));
};

const calcularImpactoEnTransaccion = async (client, categoriaId, categoriaPrevia = null) => {
    const categoriaResult = categoriaPrevia
        ? { rows: [categoriaPrevia] }
        : await client.query(`
            SELECT id, codigo, nombre, descripcion, activo, orden
            FROM fg_categoria_servicio WHERE id = $1
        `, [categoriaId]);
    if (categoriaResult.rowCount === 0) throw new Error('CATEGORIA_NO_ENCONTRADA');
    const categoria = categoriaResult.rows[0];
    const idCategoria = Number(categoria.id);

    const serviciosResult = await client.query(`
        SELECT id, codigo, nombre, activo, tipo_flujo, requiere_vehiculo, formato_id
        FROM fg_servicio
        WHERE categoria_id = $1
        ORDER BY id
        FOR UPDATE
    `, [categoriaId]);
    const servicios = serviciosResult.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        formato_id: row.formato_id === null ? null : Number(row.formato_id)
    }));
    const servicioIds = idList(servicios);

    const tarifasResult = servicioIds.length > 0 ? await client.query(`
        SELECT t.id, t.servicio_id, t.planta_key, t.codigo, t.nombre, t.precio, t.activo,
               t.producto_facturacion_id, pf.codigo_sku AS producto_codigo_sku
        FROM fg_tarifa t
        LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
        WHERE t.servicio_id = ANY($1::integer[])
        ORDER BY t.id
        FOR UPDATE OF t
    `, [servicioIds]) : { rows: [] };
    const tarifas = tarifasResult.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        servicio_id: Number(row.servicio_id),
        producto_facturacion_id: row.producto_facturacion_id === null ? null : Number(row.producto_facturacion_id)
    }));
    const tarifaIds = idList(tarifas);

    // Reglas comerciales por sede + servicio (única tabla de reglas ligada al servicio).
    const reglasResult = servicioIds.length > 0 ? await client.query(`
        SELECT id, descuento_id, descuento_cliente_id, servicio_id, planta_key, tipo_calculo, valor, activo
        FROM fg_descuentodetalle
        WHERE servicio_id = ANY($1::integer[])
        ORDER BY id
    `, [servicioIds]) : { rows: [] };

    const operaciones = await obtenerOperaciones(client, servicioIds, tarifaIds);
    const operacionIds = idList(operaciones);
    const detalleOperaciones = operaciones.flatMap((operacion) => operacion.detalles);

    // --- Validación 1: servicios de otras categorías dentro de las operaciones ---
    const otrosServiciosResult = operacionIds.length > 0
        ? await client.query(`
            SELECT od.operacion_id, array_agg(DISTINCT od.servicio_id) AS servicios
            FROM fg_operacion_detalle od
            WHERE od.operacion_id = ANY($1::bigint[])
              AND od.servicio_id IS NOT NULL
              AND NOT (od.servicio_id = ANY($2::integer[]))
            GROUP BY od.operacion_id
            ORDER BY od.operacion_id
        `, [operacionIds, servicioIds])
        : { rows: [] };

    // --- Validación 2: productos fiscales que NO son exclusivos del conjunto ---
    const productosCandidatos = unique(
        detalleOperaciones.map((detalle) => detalle.producto_facturacion_id)
    );
    const productosOperacion = productosCandidatos.length > 0
        ? await client.query(`
            SELECT p.id, p.codigo_sku, p.descripcion, p.categoria_id,
                   EXISTS (
                       SELECT 1 FROM fg_tarifa t2
                       WHERE t2.producto_facturacion_id = p.id
                         AND NOT (t2.servicio_id = ANY($2::integer[]))
                   ) AS tiene_tarifa_de_otro_servicio
            FROM fg_producto_facturacion p
            WHERE p.id = ANY($1::bigint[])
            ORDER BY p.id
        `, [productosCandidatos, servicioIds])
        : { rows: [] };
    const productosCompartidos = productosOperacion.rows
        .filter((producto) => (
            Number(producto.categoria_id) !== idCategoria
            || producto.tiene_tarifa_de_otro_servicio === true
        ))
        .map((producto) => ({
            id: Number(producto.id),
            codigo_sku: producto.codigo_sku,
            descripcion: producto.descripcion,
            motivo: Number(producto.categoria_id) !== idCategoria
                ? 'PERTECE_A_OTRA_CATEGORIA'
                : 'TARIFA_DE_OTRO_SERVICIO'
        }));
    const productosCompartidosIds = new Set(productosCompartidos.map((producto) => producto.id));
    const productosCompartidosPorOperacion = new Map();
    for (const detalle of detalleOperaciones) {
        if (detalle.producto_facturacion_id === null) continue;
        if (!productosCompartidosIds.has(detalle.producto_facturacion_id)) continue;
        const actual = productosCompartidosPorOperacion.get(detalle.operacion_id) || [];
        actual.push(detalle.producto_facturacion_id);
        productosCompartidosPorOperacion.set(detalle.operacion_id, actual);
    }

    const operacionesBloqueadas = [
        ...otrosServiciosResult.rows.map((row) => ({
            operacion_id: Number(row.operacion_id),
            motivo: 'SERVICIO_DE_OTRA_CATEGORIA',
            referencias: arrayIds(row.servicios)
        })),
        ...[...productosCompartidosPorOperacion.entries()].map(([operacionId, productos]) => ({
            operacion_id: Number(operacionId),
            motivo: 'PRODUCTO_FISCAL_COMPARTIDO',
            referencias: unique(productos)
        }))
    ].sort((a, b) => a.operacion_id - b.operacion_id);

    // --- Certificados vinculados por operación y por tarifa_codigo + planta ---
    const certificadoIdsOperaciones = unique(detalleOperaciones.map((detalle) => detalle.certificado_id));
    const certificadosPorOperacion = certificadoIdsOperaciones.length > 0
        ? await client.query(`
            SELECT id, estado, numero_certificado, tarifa_codigo, planta_key
            FROM fg_certificado
            WHERE id = ANY($1::bigint[])
            ORDER BY id
        `, [certificadoIdsOperaciones])
        : { rows: [] };
    // Los certificados del wizard no tienen detalle de operación: se localizan por
    // el vínculo textual tarifa_codigo + planta_key antes de borrar la tarifa.
    const certificadosPorTarifa = tarifaIds.length > 0
        ? await client.query(`
            SELECT c.id, c.estado, c.numero_certificado, c.tarifa_codigo, c.planta_key, t.id AS tarifa_id
            FROM fg_certificado c
            JOIN fg_tarifa t ON t.codigo = c.tarifa_codigo AND t.planta_key = c.planta_key
            WHERE t.id = ANY($1::integer[])
            ORDER BY c.id
        `, [tarifaIds])
        : { rows: [] };

    const mapaCertificados = new Map();
    for (const certificado of certificadosPorOperacion.rows) {
        mapaCertificados.set(Number(certificado.id), {
            id: Number(certificado.id),
            estado: certificado.estado,
            numero_certificado: certificado.numero_certificado,
            tarifa_codigo: certificado.tarifa_codigo,
            planta_key: certificado.planta_key,
            origen: 'OPERACION',
            operaciones_externas: 0
        });
    }
    for (const certificado of certificadosPorTarifa.rows) {
        if (mapaCertificados.has(Number(certificado.id))) continue;
        mapaCertificados.set(Number(certificado.id), {
            id: Number(certificado.id),
            estado: certificado.estado,
            numero_certificado: certificado.numero_certificado,
            tarifa_codigo: certificado.tarifa_codigo,
            planta_key: certificado.planta_key,
            origen: 'TARIFA',
            operaciones_externas: 0
        });
    }

    const certificadoIds = [...mapaCertificados.keys()];
    const externosResult = certificadoIds.length > 0
        ? await client.query(`
            SELECT od.certificado_id,
                   COUNT(*) FILTER (WHERE NOT (od.operacion_id = ANY($1::bigint[])))::int AS operaciones_externas
            FROM fg_operacion_detalle od
            WHERE od.certificado_id = ANY($2::bigint[])
            GROUP BY od.certificado_id
        `, [operacionIds, certificadoIds])
        : { rows: [] };
    const externos = new Map(externosResult.rows.map((row) => [
        Number(row.certificado_id), Number(row.operaciones_externas)
    ]));
    const certificados = [...mapaCertificados.values()].map((certificado) => ({
        ...certificado,
        operaciones_externas: externos.get(certificado.id) || 0
    }));
    const certificadosAEliminar = certificados
        .filter((certificado) => (
            ESTADOS_CERTIFICADO_DESCARTABLE.includes(certificado.estado)
            && certificado.operaciones_externas === 0
        ))
        .map((certificado) => certificado.id);
    const certificadosPreservados = certificados
        .filter((certificado) => !certificadosAEliminar.includes(certificado.id))
        .map((certificado) => ({
            ...certificado,
            motivo: ESTADOS_CERTIFICADO_DESCARTABLE.includes(certificado.estado)
                ? 'USADO_EN_OTRA_OPERACION'
                : 'ESTADO_NO_DESCARTABLE'
        }));

    const financiero = await obtenerFinanciero(client, operacionIds, certificadosAEliminar);
    const comprobantes = evaluarComprobantes(financiero.facturaciones);
    const chipsReservas = operacionIds.length > 0 ? await client.query(`
        SELECT id, numero_chip, producto_inventariable_id, operacion_reserva_id
        FROM fg_chip WHERE operacion_reserva_id = ANY($1::bigint[]) ORDER BY id
    `, [operacionIds]) : { rows: [] };
    const chipsMovimientos = operacionIds.length > 0 || certificadosAEliminar.length > 0 ? await client.query(`
        SELECT id, chip_id, certificado_id, operacion_comercial_id, tipo_movimiento
        FROM fg_chip_movimiento
        WHERE operacion_comercial_id = ANY($1::bigint[])
           OR certificado_id = ANY($2::bigint[])
        ORDER BY id
    `, [operacionIds, certificadosAEliminar]) : { rows: [] };

    const formatos = servicios.some((servicio) => servicio.formato_id !== null)
        ? await client.query(`
            SELECT f.id, f.codigo, f.nombre, f.es_protegido, f.activo,
                   (SELECT COUNT(*) FROM fg_servicio s2 WHERE s2.formato_id = f.id)::int AS servicios_que_lo_usan,
                   (SELECT COUNT(*) FROM fg_certificado_formato_version v WHERE v.formato_id = f.id)::int AS versiones,
                   (SELECT COUNT(*) FROM fg_certificado c WHERE c.formato_version_id IN
                        (SELECT v2.id FROM fg_certificado_formato_version v2 WHERE v2.formato_id = f.id))::int AS certificados
            FROM fg_certificado_formato f
            WHERE f.id = ANY($1::integer[])
            ORDER BY f.id
        `, [unique(servicios.map((servicio) => servicio.formato_id))])
        : { rows: [] };

    const productos = await client.query(`
        SELECT id, codigo_sku, descripcion
        FROM fg_producto_facturacion
        WHERE categoria_id = $1
        ORDER BY id
    `, [categoriaId]);

    const detalleProductoSnapshot = detalleOperaciones.filter(
        (detalle) => detalle.tipo_item === 'PRODUCTO' && detalle.producto_facturacion_id === null
    );

    return {
        categoria: {
            id: idCategoria,
            codigo: categoria.codigo,
            nombre: categoria.nombre
        },
        requiereConfirmacion: servicios.length > 0,
        eliminable: operacionesBloqueadas.length === 0
            && comprobantes.facturacionesBloqueantes.length === 0,
        ambiente: comprobantes.ambiente,
        limpiezaHabilitada: comprobantes.limpiezaHabilitada,
        facturacionesProtegidas: comprobantes.facturacionesProtegidas,
        facturacionesBloqueantes: comprobantes.facturacionesBloqueantes,
        servicios,
        tarifas,
        reglasConfiguracion: reglasResult.rows.map((row) => ({
            ...row,
            id: Number(row.id),
            servicio_id: Number(row.servicio_id)
        })),
        operaciones,
        operacionesBloqueadas,
        detalleProductoSnapshot: detalleProductoSnapshot.length,
        productosCompartidos,
        certificados,
        certificadosAEliminar,
        certificadosPreservados,
        ...financiero,
        formatos: formatos.rows,
        formatosConservados: formatos.rows.length,
        mappingsPorSede: {
            tarifas: tarifas.map((tarifa) => ({
                id: tarifa.id,
                planta_key: tarifa.planta_key,
                servicio_id: tarifa.servicio_id
            })),
            reglas: reglasResult.rows.map((regla) => ({
                id: Number(regla.id),
                planta_key: regla.planta_key,
                servicio_id: Number(regla.servicio_id)
            }))
        },
        productos: productos.rows,
        productosPreservados: unique([
            ...productos.rows.map((producto) => Number(producto.id)),
            ...tarifas.map((tarifa) => tarifa.producto_facturacion_id)
        ]),
        chips: { reservas: chipsReservas.rows, movimientos: chipsMovimientos.rows }
    };
};

const preview = async (categoriaId) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const categoria = await client.query(`
            SELECT id, codigo, nombre, descripcion, activo, orden
            FROM fg_categoria_servicio WHERE id = $1 FOR UPDATE
        `, [categoriaId]);
        if (categoria.rowCount === 0) throw new Error('CATEGORIA_NO_ENCONTRADA');
        const impacto = await calcularImpactoEnTransaccion(client, categoriaId, categoria.rows[0]);
        await client.query('ROLLBACK');
        return impacto;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* conserva el error original */ }
        throw error;
    } finally {
        client.release();
    }
};

const eliminarServiciosYDependencias = async (client, impacto) => {
    const servicioIds = idList(impacto.servicios);
    const tarifaIds = idList(impacto.tarifas);
    if (servicioIds.length === 0) {
        return {
            serviciosEliminados: 0,
            tarifasEliminadas: 0,
            reglasEliminadas: 0,
            operacionesEliminadas: 0,
            certificadosEliminados: 0,
            facturacionesEliminadas: 0,
            comprobantesLocalesEliminados: 0,
            limpiezaLocalHabilitada: false,
            detalle: {
                operacionesEliminadas: 0,
                facturacionesEliminadas: 0,
                ordenesPagoEliminadas: 0,
                pagosEliminados: 0,
                chipsDesvinculados: 0,
                descuentosAjustados: 0
            }
        };
    }
    if (impacto.operacionesBloqueadas && impacto.operacionesBloqueadas.length > 0) {
        const error = new Error('OPERACION_MIXTA_CATEGORIA');
        error.detalles = { operaciones: impacto.operacionesBloqueadas };
        throw error;
    }

    // Limpieza del histórico exclusivo del conjunto, reutilizando la misma rutina
    // probada para el borrado de producto fiscal (hojas primero, una sola transacción).
    const limpiezaOperaciones = {
        operacionesMixtas: impacto.operaciones.map((operacion) => ({
            id: operacion.id,
            detalles: operacion.detalles
        })),
        certificadosMixtos: impacto.certificados,
        certificadosAEliminar: impacto.certificadosAEliminar,
        facturaciones: impacto.facturaciones,
        ordenesPago: impacto.ordenesPago,
        pagos: impacto.pagos,
        otrosProductos: impacto.productosPreservados.map((id) => ({ id }))
    };
    const detalle = await productosImpactoService.eliminarOperacionesMixtas(client, limpiezaOperaciones, {
        // Autorización decidida en backend e interpretada por el limpiador con
        // la configuración real de integraciones. En PRODUCCION no surte efecto.
        permitirComprobantesDemo: true
    });

    // Reglas comerciales por sede + servicio (ON DELETE CASCADE, se borran explícitamente).
    const reglasResult = await querySiHayIds(client, `
        DELETE FROM fg_descuentodetalle WHERE servicio_id = ANY($1::integer[])
    `, servicioIds);

    if (tarifaIds.length > 0) {
        await client.query('DELETE FROM fg_tarifa WHERE id = ANY($1::integer[])', [tarifaIds]);
    }
    const serviciosEliminados = await client.query(
        'DELETE FROM fg_servicio WHERE id = ANY($1::integer[])',
        [servicioIds]
    );
    if (serviciosEliminados.rowCount !== servicioIds.length) {
        const error = new Error('SERVICIO_NO_ELIMINADO');
        error.status = 409;
        throw error;
    }

    return {
        serviciosEliminados: serviciosEliminados.rowCount,
        tarifasEliminadas: tarifaIds.length,
        reglasEliminadas: reglasResult.rowCount,
        operacionesEliminadas: detalle.operacionesEliminadas,
        certificadosEliminados: detalle.certificadosEliminados,
        facturacionesEliminadas: detalle.facturacionesEliminadas,
        comprobantesLocalesEliminados: detalle.comprobantesLocalesEliminados,
        limpiezaLocalHabilitada: detalle.limpiezaLocalHabilitada,
        detalle
    };
};

exports.calcularImpactoEnTransaccion = calcularImpactoEnTransaccion;
exports.eliminarServiciosYDependencias = eliminarServiciosYDependencias;
exports.preview = preview;
exports.ESTADOS_CERTIFICADO_DESCARTABLE = ESTADOS_CERTIFICADO_DESCARTABLE;
exports._private = { obtenerOperaciones, obtenerFinanciero };
