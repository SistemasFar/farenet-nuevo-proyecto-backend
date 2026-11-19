const db = require('../../../config/database');
const { randomUUID } = require('crypto');
const faregasAuthService = require('./faregas-auth.service');
const tarifasService = require('./faregas-tarifas.service');
const configService = require('./faregas-config.service');
const auditoriaService = require('./faregas-auditoria.service');
const descuentosImpactoService = require('./faregas-descuentos-impacto.service');
const {
    claveServicioCanonica,
    esDescuentoEspecialCortesia,
    esDescuentoLegadoFarenet,
    resolverReglaPorConcepto,
    evaluarReglaPrecio,
    tieneMaximoDosDecimales,
    normalizarValorRegla
} = require('./faregas-descuentos-reglas');
const {
    CODIGO_AUTORIZACION_CORTESIA,
    CODIGO_AUTORIZACION_GRATUIDAD_TALLER,
    DESCUENTO_ID_CORTESIA_HISTORICO,
    esCodigoCortesia,
    esCodigoGratuidadTaller,
    esFlujoTaller,
    consultarConvenioProtegido,
    consultarCodigoProtegido
} = require('./faregas-gratuidad-taller.policy');

// Los certificados técnicos y las inspecciones de taller son servicios
// comerciales válidos para campañas. Se comparte la misma lista entre el
// catálogo administrativo y la validación al guardar para que un servicio
// visible nunca sea rechazado después.
const FLUJOS_DESCONTABLES = Object.freeze(['CERTIFICACION', 'TALLER_INSPECCION']);

const errorNegocio = (codigo, statusCode = 400, detalles) => {
    const error = new Error(codigo);
    error.code = codigo;
    error.statusCode = statusCode;
    if (detalles) error.detalles = detalles;
    if (detalles?.message) error.publicMessage = detalles.message;
    return error;
};

const resolverPrecioServicio = (row) => tarifasService.resolverPrecioComercial({
    productoFacturacionId: row.producto_facturacion_id,
    precioReferencia: row.producto_precio_referencia,
    precioUnitario: row.producto_precio_unitario
});

const mapearServicioAdministracion = (row) => ({
    ...row,
    precio: row.producto_activo === false || row.producto_para_venta === false
        ? null
        : resolverPrecioServicio(row),
    tarifaDisponible: row.tarifa_activa !== false,
    productoDisponible: row.producto_activo === true && row.producto_para_venta === true
});

const lanzarErrorPrecioRegla = ({ regla, precioVenta, contexto = {}, evaluacion, statusCode = 400 }) => {
    const valorSolicitado = regla.tipoCalculo === 'FLAT'
        ? regla.valorContado ?? regla.valorCredito
        : regla.valor;
    const detalle = {
        plantaKey: contexto.plantaKey || contexto.planta_key || null,
        sede: contexto.sede || contexto.plantaKey || contexto.planta_key || 'Sede seleccionada',
        servicioId: contexto.servicioId || contexto.servicio_id || null,
        tarifaCodigo: contexto.tarifaCodigo || contexto.tarifa_codigo || null,
        precioVenta: precioVenta === null || precioVenta === undefined || precioVenta === ''
            ? null
            : (Number.isFinite(Number(precioVenta)) ? Number(precioVenta) : null),
        tipoCalculo: regla.tipoCalculo,
        valorSolicitado: Number.isFinite(Number(valorSolicitado)) ? Number(valorSolicitado) : null,
        motivo: evaluacion.motivo
    };
    const valorTexto = detalle.valorSolicitado == null ? 'sin valor' : (
        regla.tipoCalculo === 'PORCENTAJE' ? `${detalle.valorSolicitado}%` : `S/ ${detalle.valorSolicitado.toFixed(2)}`
    );
    const precioTexto = detalle.precioVenta == null ? 'no configurado' : `S/ ${detalle.precioVenta.toFixed(2)}`;
    detalle.message = `${detalle.sede}: precio de venta ${precioTexto}; descuento solicitado ${valorTexto}. ${evaluacion.motivo}`;
    throw errorNegocio('IMPORTE_DESCUENTO_INVALIDO', statusCode, detalle);
};

const validarPrecioRegla = (regla, precioVenta, contexto = {}, statusCode = 409) => {
    const valor = regla.tipoCalculo === 'FLAT' ? regla.valorContado ?? regla.valorCredito : regla.valor;
    const precio = precioVenta === null || precioVenta === undefined || precioVenta === ''
        ? Number.NaN
        : Number(precioVenta);
    const evaluacion = evaluarReglaPrecio(regla.tipoCalculo, valor, precio);
    if (!evaluacion.valido) lanzarErrorPrecioRegla({ regla, precioVenta, contexto, evaluacion, statusCode });
    return evaluacion;
};

const buscarReglaAplicable = async (client, descuentoId, plantaKey, servicio) => {
    const result = await client.query(`
        SELECT dd.id, dd.servicio_id, dd.planta_key, dd.tipo_calculo, dd.valor,
               dd.valor_contado, dd.valor_credito, dd.activo,
               p.nombre AS sede, t.codigo AS tarifa_codigo,
               s.tipo_certificado_clave, s.modalidad, s.tipo_flujo, s.familia,
               formato_raiz.codigo AS formato_codigo_canonico
        FROM fg_descuentodetalle dd
        JOIN fg_servicio s ON s.id = dd.servicio_id
        JOIN fg_planta p ON p.key = dd.planta_key
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        JOIN fg_tarifa t ON t.planta_key = dd.planta_key AND t.servicio_id = dd.servicio_id AND t.activo = TRUE
        JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
             AND pf.activo = TRUE AND pf.es_para_venta = TRUE
        LEFT JOIN fg_certificado_formato formato ON formato.id = s.formato_id
        LEFT JOIN fg_certificado_formato formato_raiz
          ON formato_raiz.id = COALESCE(formato.formato_padre_id, formato.id)
        WHERE dd.descuento_id = $1
          AND dd.descuento_cliente_id IS NULL
          AND dd.planta_key = $2
          AND dd.activo = TRUE
          AND p.activo = TRUE AND s.activo = TRUE AND c.activo = TRUE
    `, [descuentoId, plantaKey]);

    const serviceId = Number(servicio.servicio_id ?? servicio.id);
    const { regla, ambiguo, candidatas = [] } = resolverReglaPorConcepto(result.rows, servicio);
    if (ambiguo) {
        throw errorNegocio('DESCUENTO_REGLA_CANONICA_AMBIGUA', 409, {
            plantaKey,
            sede: candidatas[0].sede || plantaKey,
            servicioId,
            message: `La sede ${candidatas[0].sede || plantaKey} tiene más de una regla activa para el mismo concepto de certificado. Revise la configuración del descuento.`
        });
    }
    return regla || null;
};

const calcularImporteFinal = (precio, tipoCalculo, valor) => {
    if (tipoCalculo === 'FLAT') return Number(valor);
    if (tipoCalculo === 'MONTO') return Math.max(0, Number(precio) - Number(valor));
    return Math.max(0, Number(precio) * (1 - Number(valor) / 100));
};

// ----------------------------------------------------------------------
// VALIDACIONES Y CONSULTA
// ----------------------------------------------------------------------

const obtenerCertificado = async (client, certificadoId, userContext) => {
    const result = await client.query(
        `SELECT c.id, c.estado, c.planta_key, p.nombre AS planta_nombre,
                c.tipo_certificado_clave, c.tarifa_codigo, c.precio_certificado,
                s.tipo_flujo AS servicio_tipo_flujo
         FROM fg_certificado c
         LEFT JOIN fg_planta p ON p.key = c.planta_key
         LEFT JOIN fg_tarifa t ON t.planta_key = c.planta_key AND t.codigo = c.tarifa_codigo
         LEFT JOIN fg_servicio s ON s.id = t.servicio_id
         WHERE c.id = $1`,
        [certificadoId]
    );
    if (result.rowCount === 0) throw errorNegocio('CERTIFICADO_NOT_FOUND', 404);
    const certificado = result.rows[0];
    
    const acceso = await faregasAuthService.validarAccesoPlanta(
        userContext.username,
        userContext.perfil_id,
        certificado.planta_key
    );
    if (!acceso) throw errorNegocio('PLANTA_NO_AUTORIZADA', 403);
    
    if (certificado.estado !== 'BORRADOR') {
        throw errorNegocio('CERTIFICADO_NO_EDITABLE', 409);
    }
    
    const vehiculoResult = await client.query(
        `SELECT placa FROM fg_certificado_vehiculo WHERE certificado_id = $1`,
        [certificadoId]
    );
    certificado.placa = vehiculoResult.rowCount > 0 ? vehiculoResult.rows[0].placa : null;

    return certificado;
};

const redondearMoneda = (importe) => Math.round((Number(importe || 0) + Number.EPSILON) * 100) / 100;

const obtenerContextoEdicionDescuento = async (client, certificadoId, userContext) => {
    const certificado = await obtenerCertificado(client, certificadoId, userContext);
    // Serializa cambio de descuento frente al guardado de pagos, que también
    // bloquea la fila de certificado antes de modificar la orden.
    await client.query('SELECT id FROM fg_certificado WHERE id = $1 FOR UPDATE', [certificadoId]);
    const ordenResult = await client.query(
        'SELECT * FROM fg_orden_pago WHERE certificado_id = $1 FOR UPDATE',
        [certificadoId]
    );
    const orden = ordenResult.rows[0] || null;
    if (!orden) return { certificado, orden: null, pagosEfectivos: 0 };
    validarOrdenPagoEditable(orden);
    if (orden.venta_id) throw errorNegocio('DESCUENTO_OPERACION_NO_EDITABLE', 409);
    if (String(orden.formapago_key || '').toLowerCase() === 'credito') {
        throw errorNegocio('CREDITO_NO_ADMITE_DESCUENTOS', 409);
    }

    const operacion = orden.operacion_id
        ? await client.query('SELECT estado FROM fg_operacion_comercial WHERE id = $1 FOR UPDATE', [orden.operacion_id])
        : { rowCount: 0, rows: [] };
    if (operacion.rowCount > 0 && !['BORRADOR', 'PENDIENTE_PAGO', 'PAGADO'].includes(operacion.rows[0].estado)) {
        throw errorNegocio('DESCUENTO_OPERACION_NO_EDITABLE', 409);
    }

    const facturacion = await client.query(
        `SELECT id, estado, nro_comprobante, codigo_hash, enlace_pdf, enlace_xml
         FROM fg_facturacion WHERE certificado_id = $1 FOR UPDATE`,
        [certificadoId]
    );
    for (const documento of facturacion.rows) {
        if (documento.estado !== 'BORRADOR' || documento.nro_comprobante || documento.codigo_hash
            || documento.enlace_pdf || documento.enlace_xml) {
            throw errorNegocio('DESCUENTO_OPERACION_NO_EDITABLE', 409);
        }
        const intento = await client.query(
            'SELECT 1 FROM fg_facturacion_intento WHERE facturacion_id = $1 LIMIT 1',
            [documento.id]
        );
        if (intento.rowCount > 0) throw errorNegocio('DESCUENTO_OPERACION_NO_EDITABLE', 409);
    }

    const pagos = await client.query(
        `SELECT id, importe, estado FROM fg_pago
         WHERE orden_pago_id = $1 ORDER BY id FOR UPDATE`,
        [orden.id]
    );
    const pagosEfectivos = redondearMoneda(pagos.rows
        .filter((pago) => pago.estado === 'CAN')
        .reduce((total, pago) => total + Number(pago.importe || 0), 0));
    if (Math.abs(pagosEfectivos - Number(orden.importe_pagado || 0)) > 0.01) {
        throw errorNegocio('PAGOS_INCONSISTENTES', 409);
    }
    return { certificado, orden, pagosEfectivos };
};

const validarOrdenPagoEditable = (orden) => {
    const estado = String(orden?.estado || '').trim().toUpperCase();
    if (!['PENDIENTE', 'PAGADO'].includes(estado)) {
        throw errorNegocio('DESCUENTO_OPERACION_NO_EDITABLE', 409);
    }
};

const obtenerPrecioOriginalServicio = async (client, certificado, importeOriginalReserva = null) => {
    if (importeOriginalReserva !== null && importeOriginalReserva !== undefined) {
        return redondearMoneda(importeOriginalReserva);
    }
    if (certificado.precio_certificado !== null && certificado.precio_certificado !== undefined) {
        return redondearMoneda(certificado.precio_certificado);
    }
    if (!certificado.tarifa_codigo) throw errorNegocio('CERTIFICADO_SIN_TARIFA', 409);
    const tarifa = await tarifasService.obtenerTarifaOperativaPorCodigo(
        certificado.planta_key,
        certificado.tarifa_codigo,
        client
    );
    return redondearMoneda(tarifasService.validarTarifaCertificacion(tarifa).precio);
};

const actualizarOrdenBorradorPorDescuento = async (
    client,
    contexto,
    nuevoImporteServicio,
    importeServicioActual,
    userContext
) => {
    const { orden, pagosEfectivos } = contexto;
    if (!orden) return null;

    let totalOrden = redondearMoneda(Number(orden.importe_total) - importeServicioActual + nuevoImporteServicio);
    let baseOrden = redondearMoneda(totalOrden / 1.18);
    let igvOrden = redondearMoneda(totalOrden - baseOrden);
    let operacionActualizada = null;

    if (orden.operacion_id) {
        const lineasServicio = await client.query(
            `SELECT id FROM fg_operacion_detalle
             WHERE operacion_id = $1 AND certificado_id = $2 AND tipo_item = 'SERVICIO'
             ORDER BY id FOR UPDATE`,
            [orden.operacion_id, contexto.certificado.id]
        );
        if (lineasServicio.rowCount > 1) throw errorNegocio('DESCUENTO_DETALLE_AMBIGUO', 409);
        if (lineasServicio.rowCount === 1) {
            const baseServicio = redondearMoneda(nuevoImporteServicio / 1.18);
            const igvServicio = redondearMoneda(nuevoImporteServicio - baseServicio);
            await client.query(
                `UPDATE fg_operacion_detalle
                 SET valor_unitario = $2, precio_unitario = $3,
                     base_imponible = $2, igv = $4, importe_total = $3
                 WHERE id = $1`,
                [lineasServicio.rows[0].id, baseServicio, nuevoImporteServicio, igvServicio]
            );
            const totales = await client.query(
                `SELECT COALESCE(SUM(base_imponible), 0) AS base,
                        COALESCE(SUM(igv), 0) AS igv,
                        COALESCE(SUM(importe_total), 0) AS total
                 FROM fg_operacion_detalle WHERE operacion_id = $1`,
                [orden.operacion_id]
            );
            baseOrden = redondearMoneda(totales.rows[0].base);
            igvOrden = redondearMoneda(totales.rows[0].igv);
            totalOrden = redondearMoneda(totales.rows[0].total);
        }
        operacionActualizada = await client.query(
            `UPDATE fg_operacion_comercial
             SET base_imponible = $2, igv = $3, importe_total = $4,
                 estado = $5, usuario_modificacion = $6, fecha_modificacion = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING id`,
            [orden.operacion_id, baseOrden, igvOrden, totalOrden,
                totalOrden > 0 && pagosEfectivos >= totalOrden - 0.009 ? 'PAGADO' : 'PENDIENTE_PAGO',
                userContext.username]
        );
    }

    if (pagosEfectivos - totalOrden > 0.009) {
        throw errorNegocio('DESCUENTO_TOTAL_MENOR_A_PAGOS', 409, {
            importePagado: pagosEfectivos,
            importeNuevo: totalOrden
        });
    }
    const saldo = redondearMoneda(Math.max(0, totalOrden - pagosEfectivos));
    const estado = totalOrden > 0 && saldo <= 0.009 ? 'PAGADO' : 'PENDIENTE';
    const actualizada = await client.query(
        `UPDATE fg_orden_pago
         SET importe_total = $2, baseimponible = $3, igv = $4,
             importe_pagado = $5, saldo_pendiente = $6, estado = $7,
             usuariomodi_username = $8, fechmodi = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [orden.id, totalOrden, baseOrden, igvOrden, pagosEfectivos, saldo, estado, userContext.username]
    );
    // No se crean ni reemplazan pagos: las filas efectivas permanecen intactas.
    void operacionActualizada;
    return actualizada.rows[0];
};

const obtenerReservaActivaBloqueada = async (client, certificadoId) => {
    const result = await client.query(
        `SELECT * FROM fg_descuentocomprobante
         WHERE certificado_id = $1 AND estado IN ('RESERVADO', 'APLICADO')
         ORDER BY id DESC FOR UPDATE`,
        [certificadoId]
    );
    if (result.rowCount > 1) throw errorNegocio('DESCUENTO_RESERVAS_INCONSISTENTES', 409);
    return result.rows[0] || null;
};

const guardarReservaDescuento = async (client, calculo, reservaActual, orden, userContext) => {
    const mismaReserva = reservaActual
        && reservaActual.estado === 'RESERVADO'
        && Number(reservaActual.descuento_id) === Number(calculo.descuentoId)
        && Number(reservaActual.descuento_cliente_id || 0) === Number(calculo.descuentoClienteId || 0);

    if (mismaReserva) {
        await client.query(
            `UPDATE fg_descuentocomprobante
             SET importe_original = $2, importe_descuento = $3, importe_final = $4,
                 orden_pago_id = COALESCE($5, orden_pago_id),
                 reservado_hasta = GREATEST(reservado_hasta, CURRENT_TIMESTAMP + INTERVAL '24 hours'),
                 usuario_modificacion = $6, fecha_modificacion = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [reservaActual.id, calculo.tarifaOriginal, calculo.importeDescuento,
                calculo.importeFinal, orden?.id || null, userContext.username]
        );
        return;
    }

    if (reservaActual) {
        await client.query(
            `UPDATE fg_descuentocomprobante
             SET estado = 'LIBERADO', usuario_modificacion = $2, fecha_modificacion = CURRENT_TIMESTAMP
             WHERE id = $1 AND estado = 'RESERVADO'`,
            [reservaActual.id, userContext.username]
        );
    }
    await client.query(
        `INSERT INTO fg_descuentocomprobante (
            descuento_id, descuento_cliente_id, certificado_id, orden_pago_id,
            importe_original, importe_descuento, importe_final, estado,
            reservado_hasta, usuario_creacion
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'RESERVADO', CURRENT_TIMESTAMP + INTERVAL '24 hours', $8)`,
        [calculo.descuentoId, calculo.descuentoClienteId || null, calculo.certificado.id,
            orden?.id || null, calculo.tarifaOriginal, calculo.importeDescuento,
            calculo.importeFinal, userContext.username]
    );
};

const consultarDescuentoCore = async (client, codigo, certificadoId, userContext, isReserva = false, permitirReemplazo = false) => {
    const certificado = await obtenerCertificado(client, certificadoId, userContext);
    
    // 1. Obtener tarifa original
    if (!certificado.tarifa_codigo) {
        throw errorNegocio('CERTIFICADO_SIN_TARIFA', 409);
    }
    
    const tarifaOp = await tarifasService.obtenerTarifaOperativaPorCodigo(
        certificado.planta_key,
        certificado.tarifa_codigo,
        client
    );
    const tarifaValida = tarifasService.validarTarifaCertificacion(tarifaOp);
    const tarifaOriginal = Number(tarifaValida.precio);

    const servicioId = tarifaValida.servicio_id;

    // 2. Buscar código y bloquear si es reserva
    const sql = `
        SELECT 
            dc.id AS descuentocliente_id, dc.codigo, dc.placa,
            dc.fecha_inicio AS dc_inicio, dc.fecha_fin AS dc_fin, dc.max_usos, dc.usos_realizados, dc.activo AS dc_activo,
            d.id AS descuento_id, d.nombre, d.tipo, d.empresa_aliada_nombre,
            d.fecha_inicio AS d_inicio, d.fecha_fin AS d_fin, d.activo AS d_activo
        FROM fg_descuentocliente dc
        JOIN fg_descuento d ON d.id = dc.descuento_id
        WHERE UPPER(dc.codigo) = UPPER($1)
        ${isReserva ? 'FOR UPDATE OF dc' : ''}
    `;
    const resCli = await client.query(sql, [codigo]);
    
    if (resCli.rowCount === 0) throw errorNegocio('CODIGO_NOT_FOUND', 404);
    const ds = resCli.rows[0];

    const cortesiaProtegida = esDescuentoEspecialCortesia({
        descuento_id: ds.descuento_id,
        codigo: ds.codigo,
        nombre: ds.nombre
    });
    if (esDescuentoLegadoFarenet(ds) && !cortesiaProtegida) {
        throw errorNegocio('DESCUENTO_ORIGEN_NO_AUTORIZADO', 422);
    }

    // 3. Validaciones
    if (!ds.dc_activo) throw errorNegocio('CODIGO_INACTIVO', 409);
    if (!ds.d_activo) throw errorNegocio('DESCUENTO_INACTIVO', 409);
    
    const ahora = new Date();
    if (ahora < new Date(ds.d_inicio) || ahora > new Date(ds.d_fin)) {
        throw errorNegocio('DESCUENTO_VENCIDO', 422);
    }
    if (ds.dc_inicio && ds.dc_fin) {
        if (ahora < new Date(ds.dc_inicio) || ahora > new Date(ds.dc_fin)) {
            throw errorNegocio('CODIGO_VENCIDO', 422);
        }
    }

    const placaNormalizada = (value) => String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (ds.placa) {
        if (placaNormalizada(ds.placa) !== placaNormalizada(certificado.placa)) {
            throw errorNegocio('DESCUENTO_NO_APLICA_PLACA', 422);
        }
    }

    const reservasResult = await client.query(`
        SELECT
            COUNT(*) FILTER (WHERE cmp.estado = 'RESERVADO' AND cmp.reservado_hasta >= CURRENT_TIMESTAMP) AS reservados,
            BOOL_OR(cmp.certificado_id = $2 AND cmp.estado IN ('RESERVADO', 'APLICADO')) AS pertenece_certificado
        FROM fg_descuentocomprobante cmp
        WHERE cmp.descuento_cliente_id = $1
          AND cmp.estado IN ('RESERVADO', 'APLICADO')
    `, [ds.descuentocliente_id, certificadoId]);
    const reservados = Number(reservasResult.rows[0].reservados || 0);
    const perteneceCertificado = Boolean(reservasResult.rows[0].pertenece_certificado);
    const usosDisponibles = Number(ds.max_usos) - Number(ds.usos_realizados) - reservados;
    if (usosDisponibles <= 0 && !perteneceCertificado) {
        throw errorNegocio('CODIGO_AGOTADO', 409);
    }

    // 4. Validar servicio permitido
    const det = await buscarReglaAplicable(client, ds.descuento_id, certificado.planta_key, tarifaValida);
    if (!det) {
        const sedeConfigurada = await client.query(`SELECT 1 FROM fg_descuentodetalle
            WHERE descuento_id=$1 AND descuento_cliente_id IS NULL
              AND planta_key=$2 AND activo=TRUE LIMIT 1`,
        [ds.descuento_id, certificado.planta_key]);
        throw errorNegocio(sedeConfigurada.rowCount ? 'DESCUENTO_NO_APLICA_SERVICIO' : 'DESCUENTO_NO_APLICA_SEDE', 422);
    }
    
    // 5. Calcular importe
    const tipoCalculoFinal = det.tipo_calculo;
    // El flujo FAREGAS actual genera órdenes al contado. La columna crédito
    // queda lista para cuando se habilite esa modalidad comercial.
    const formaPago = 'CONTADO';
    const valorFinal = Number(tipoCalculoFinal === 'FLAT'
        ? (formaPago === 'CREDITO' ? det.valor_credito : det.valor_contado)
        : det.valor);

    if (!['FLAT', 'MONTO', 'PORCENTAJE'].includes(tipoCalculoFinal) || !Number.isFinite(valorFinal) || valorFinal <= 0) {
        throw errorNegocio('REGLA_DESCUENTO_NO_CONFIGURADA', 409);
    }
    
    const esAutorizacionGratuita = cortesiaProtegida || esCodigoCortesia(ds.codigo);
    let importeDescuento;
    let importeFinal;
    if (esAutorizacionGratuita) {
        importeDescuento = tipoCalculoFinal === 'FLAT'
            ? tarifaOriginal - valorFinal
            : tipoCalculoFinal === 'MONTO'
                ? valorFinal
                : Math.round((tarifaOriginal * valorFinal / 100) * 100) / 100;
        importeFinal = Math.round((tarifaOriginal - importeDescuento) * 100) / 100;
    } else {
        const validacionPrecio = validarPrecioRegla({
            tipoCalculo: tipoCalculoFinal,
            valor: valorFinal,
            valorContado: tipoCalculoFinal === 'FLAT' ? valorFinal : null,
            valorCredito: null
        }, tarifaOriginal, {
            plantaKey: certificado.planta_key,
            sede: certificado.planta_nombre,
            servicioId,
            tarifaCodigo: certificado.tarifa_codigo
        });
        importeDescuento = validacionPrecio.importeDescuento;
        importeFinal = validacionPrecio.importeFinal;
    }

    if (esAutorizacionGratuita && Math.abs(importeFinal) > 0.01) {
        throw errorNegocio('GRATUIDAD_TALLER_CONFIGURACION_INVALIDA', 409);
    }
    if (!esAutorizacionGratuita && Math.abs(importeFinal) <= 0.01) {
        throw errorNegocio('OPERACION_CERO_REQUIERE_AUTORIZACION_GRATUITA', 409);
    }

    // 6. Validar que no haya otra reserva de OTRO codigo en el mismo certificado
    const sqlRes = `
        SELECT dc.codigo FROM fg_descuentocomprobante cmp
        JOIN fg_descuentocliente dc ON dc.id = cmp.descuento_cliente_id
        WHERE cmp.certificado_id = $1 AND cmp.estado IN ('RESERVADO', 'APLICADO')
        AND dc.codigo != $2
    `;
    const resReservaActiva = permitirReemplazo
        ? { rowCount: 0, rows: [] }
        : await client.query(sqlRes, [certificadoId, ds.codigo]);
    if (resReservaActiva.rowCount > 0) {
        throw errorNegocio('DESCUENTO_YA_RESERVADO', 409);
    }

    return {
        descuentoId: ds.descuento_id,
        descuentoClienteId: ds.descuentocliente_id,
        codigo: ds.codigo,
        nombre: esAutorizacionGratuita ? 'CORTESÍA FAREGAS' : ds.nombre,
        tipo: ds.tipo,
        empresaAliada: esAutorizacionGratuita ? null : ds.empresa_aliada_nombre,
        tipoCalculo: tipoCalculoFinal,
        valor: valorFinal,
        formaPago,
        tarifaOriginal,
        importeDescuento,
        importeFinal,
        fechaFin: ds.dc_fin || ds.d_fin,
        usosDisponibles: Math.max(0, usosDisponibles),
        beneficio: esAutorizacionGratuita
            ? `Cortesía FAREGAS — operación gratuita (total a cobrar S/ ${importeFinal.toFixed(2)})`
            : undefined,
        autorizaGratuidad: esAutorizacionGratuita,
        certificado
    };
};

const consultarDescuentoDirectoCore = async (client, descuentoId, certificadoId, userContext, isReserva = false) => {
    const certificado = await obtenerCertificado(client, certificadoId, userContext);
    
    if (!certificado.tarifa_codigo) {
        throw errorNegocio('CERTIFICADO_SIN_TARIFA', 409);
    }
    
    const tarifaOp = await tarifasService.obtenerTarifaOperativaPorCodigo(
        certificado.planta_key,
        certificado.tarifa_codigo,
        client
    );
    const tarifaValida = tarifasService.validarTarifaCertificacion(tarifaOp);
    const tarifaOriginal = Number(tarifaValida.precio);
    const servicioId = tarifaValida.servicio_id;

    // Buscar descuento y bloquear si es reserva
    const sql = `
        SELECT d.id AS descuento_id, d.codigo, d.nombre, d.tipo, d.empresa_aliada_nombre,
               d.fecha_inicio AS d_inicio, d.fecha_fin AS d_fin, d.activo AS d_activo
        FROM fg_descuento d
        WHERE d.id = $1
        ${isReserva ? 'FOR UPDATE OF d' : ''}
    `;
    const resDesc = await client.query(sql, [descuentoId]);
    if (resDesc.rowCount === 0) throw errorNegocio('DESCUENTO_NO_ENCONTRADO', 404);
    const ds = resDesc.rows[0];

    if (!ds.d_activo) throw errorNegocio('DESCUENTO_INACTIVO', 409);
    
    const ahora = new Date();
    if (ahora < new Date(ds.d_inicio) || ahora > new Date(ds.d_fin)) {
        throw errorNegocio('DESCUENTO_VENCIDO', 422);
    }

    const convenioProtegido = await consultarConvenioProtegido(client, ds.descuento_id, false);
    const esAutorizacionGratuita = Boolean(convenioProtegido) || esCodigoCortesia(ds.codigo);
    if (esDescuentoLegadoFarenet(ds) && !esAutorizacionGratuita) {
        throw errorNegocio('DESCUENTO_ORIGEN_NO_AUTORIZADO', 422);
    }

    // La cortesía es una modalidad comercial transversal: conserva la tarifa
    // como valor referencial y no depende de reglas por servicio/sede.
    if (esAutorizacionGratuita) {
        return {
            descuentoId: ds.descuento_id,
            // En convenios históricos (DESCUENTO_TALLER) se conserva la fila
            // que contiene el código de autorización. Así la persistencia no
            // depende de inferir la cortesía únicamente por el importe cero.
            descuentoClienteId: convenioProtegido?.codigo_id || null,
            codigo: esCodigoCortesia(ds.codigo) ? ds.codigo : CODIGO_AUTORIZACION_CORTESIA,
            nombre: 'CORTESÍA FAREGAS',
            tipo: ds.tipo,
            empresaAliada: null,
            tipoCalculo: 'PORCENTAJE',
            valor: 100,
            formaPago: 'CONTADO',
            tarifaOriginal,
            importeDescuento: tarifaOriginal,
            importeFinal: 0,
            fechaFin: ds.d_fin,
            beneficio: `Cortesía S/ ${tarifaOriginal.toFixed(2)} (total a cobrar S/ 0.00)`,
            autorizaGratuidad: true,
            certificado
        };
    }

    // Regla de sede y servicio en fg_descuentodetalle
    const det = await buscarReglaAplicable(client, ds.descuento_id, certificado.planta_key, tarifaValida);
    if (!det) {
        const sedeConfigurada = await client.query(`
            SELECT 1 FROM fg_descuentodetalle
            WHERE descuento_id = $1 AND descuento_cliente_id IS NULL
              AND planta_key = $2 AND activo = TRUE LIMIT 1
        `, [ds.descuento_id, certificado.planta_key]);
        throw errorNegocio(sedeConfigurada.rowCount ? 'DESCUENTO_NO_APLICA_SERVICIO' : 'DESCUENTO_NO_APLICA_SEDE', 422);
    }

    // Calcular importe
    const tipoCalculoFinal = det.tipo_calculo;
    const formaPago = 'CONTADO';
    const valorFinal = Number(tipoCalculoFinal === 'FLAT'
        ? (formaPago === 'CREDITO' ? det.valor_credito : det.valor_contado)
        : det.valor);

    if (!['FLAT', 'MONTO', 'PORCENTAJE'].includes(tipoCalculoFinal) || !Number.isFinite(valorFinal) || valorFinal <= 0) {
        throw errorNegocio('REGLA_DESCUENTO_NO_CONFIGURADA', 409);
    }
    
    const validacionPrecio = validarPrecioRegla({
        tipoCalculo: tipoCalculoFinal,
        valor: valorFinal,
        valorContado: tipoCalculoFinal === 'FLAT' ? valorFinal : null,
        valorCredito: null
    }, tarifaOriginal, {
        plantaKey: certificado.planta_key,
        sede: certificado.planta_nombre,
        servicioId,
        tarifaCodigo: certificado.tarifa_codigo
    });
    const importeDescuento = validacionPrecio.importeDescuento;
    const importeFinal = validacionPrecio.importeFinal;

    if (Math.abs(importeFinal) <= 0.01) {
        throw errorNegocio('OPERACION_CERO_REQUIERE_AUTORIZACION_GRATUITA', 409);
    }

    // Validar que no haya otra reserva de OTRO descuento en el mismo certificado
    const sqlRes = `
        SELECT cmp.descuento_id, cmp.descuento_cliente_id
        FROM fg_descuentocomprobante cmp
        WHERE cmp.certificado_id = $1 AND cmp.estado IN ('RESERVADO', 'APLICADO')
        AND (cmp.descuento_id IS NOT NULL AND cmp.descuento_id != $2)
    `;
    const resReservaActiva = await client.query(sqlRes, [certificadoId, ds.descuento_id]);
    if (resReservaActiva.rowCount > 0) {
        throw errorNegocio('DESCUENTO_YA_RESERVADO', 409);
    }

    let beneficio = '';
    if (tipoCalculoFinal === 'PORCENTAJE') {
        beneficio = `${valorFinal}% (-S/ ${importeDescuento.toFixed(2)})`;
    } else if (tipoCalculoFinal === 'MONTO') {
        beneficio = `Fijo -S/ ${importeDescuento.toFixed(2)}`;
    } else {
        beneficio = `Tarifa plana S/ ${valorFinal.toFixed(2)} (-S/ ${importeDescuento.toFixed(2)})`;
    }

    return {
        descuentoId: ds.descuento_id,
        descuentoClienteId: null,
        codigo: ds.codigo || ds.nombre,
            nombre: esAutorizacionGratuita ? 'CORTESÍA FAREGAS' : ds.nombre,
        tipo: ds.tipo,
            empresaAliada: esAutorizacionGratuita ? null : ds.empresa_aliada_nombre,
        tipoCalculo: tipoCalculoFinal,
        valor: valorFinal,
        formaPago,
        tarifaOriginal,
        importeDescuento,
        importeFinal,
        fechaFin: ds.d_fin,
        beneficio,
        autorizaGratuidad: false,
        certificado
    };
};

// ----------------------------------------------------------------------
// EXPORTS OPERATIVOS
// ----------------------------------------------------------------------

exports.listarDescuentosDisponibles = async (certificadoId, userContext) => {
    const client = await db.connect();
    try {
        const certificado = await obtenerCertificado(client, certificadoId, userContext);
        if (!certificado.tarifa_codigo) {
            return [];
        }
        const tarifaOp = await tarifasService.obtenerTarifaOperativaPorCodigo(
            certificado.planta_key,
            certificado.tarifa_codigo,
            client
        );
        if (!tarifaOp) return [];
        const tarifaValida = tarifasService.validarTarifaCertificacion(tarifaOp);
        const tarifaOriginal = Number(tarifaValida.precio);
        const servicioId = tarifaValida.servicio_id;
        const claveActual = claveServicioCanonica(tarifaValida);

        const sql = `
            SELECT d.id, d.codigo, d.nombre, d.tipo, d.empresa_aliada_nombre,
                   d.fecha_inicio, d.fecha_fin,
                   dd.tipo_calculo, dd.valor, dd.valor_contado, dd.valor_credito,
                   dd.servicio_id, dd.planta_key,
                   s.tipo_certificado_clave, s.modalidad, s.tipo_flujo, s.familia,
                   formato_raiz.codigo AS formato_codigo_canonico
            FROM fg_descuento d
            JOIN fg_descuentodetalle dd ON dd.descuento_id = d.id AND dd.descuento_cliente_id IS NULL
            JOIN fg_servicio s ON s.id = dd.servicio_id
            JOIN fg_categoria_servicio c ON c.id = s.categoria_id
            JOIN fg_tarifa t ON t.planta_key = dd.planta_key AND t.servicio_id = dd.servicio_id AND t.activo = TRUE
            JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
                 AND pf.activo = TRUE AND pf.es_para_venta = TRUE
            JOIN fg_planta p ON p.key = dd.planta_key AND p.activo = TRUE
            LEFT JOIN fg_certificado_formato formato ON formato.id = s.formato_id
            LEFT JOIN fg_certificado_formato formato_raiz
              ON formato_raiz.id = COALESCE(formato.formato_padre_id, formato.id)
            WHERE d.activo = TRUE
              AND CURRENT_TIMESTAMP >= d.fecha_inicio AND CURRENT_TIMESTAMP <= d.fecha_fin
              AND dd.activo = TRUE
              AND dd.planta_key = $1
              AND d.id <> ${DESCUENTO_ID_CORTESIA_HISTORICO}
              AND s.activo = TRUE AND c.activo = TRUE
              AND UPPER(BTRIM(COALESCE(d.codigo, ''))) NOT IN ($2, $3, $4)
              AND UPPER(BTRIM(COALESCE(d.nombre, ''))) NOT IN ('DESCUENTO CERTIFICADO TALLER', 'CORTESIA FAREGAS', 'CORTESÍA FAREGAS')
              AND UPPER(COALESCE(d.nombre, '')) NOT LIKE '%CORTESIA%'
              AND UPPER(COALESCE(d.nombre, '')) NOT LIKE '%CORTESÍA%'
              AND REGEXP_REPLACE(UPPER(BTRIM(COALESCE(d.empresa_aliada_nombre, ''))), '[^A-Z0-9]', '', 'g') NOT IN ('FARENET', 'FARENETSAC')
              AND NOT EXISTS (
                  SELECT 1 FROM fg_descuentocliente dc
                  WHERE dc.descuento_id = d.id
                    AND UPPER(BTRIM(dc.codigo)) IN ($2, $3, $4)
              )
            ORDER BY d.nombre, dd.servicio_id
        `;
        const res = await client.query(sql, [
            certificado.planta_key,
            CODIGO_AUTORIZACION_CORTESIA,
            CODIGO_AUTORIZACION_GRATUIDAD_TALLER,
            'D_CONVENIO_A88137BB742F4157'
        ]);

        const disponibles = [];
        const filasAplicables = res.rows.filter((row) => (
            !esDescuentoEspecialCortesia(row)
            && !esDescuentoLegadoFarenet(row)
            && (Number(row.servicio_id) === Number(servicioId)
            || (claveActual && !claveActual.startsWith('SERVICIO_ID::')
                && claveServicioCanonica(row) === claveActual))
        ));
        const porDescuento = new Map();
        for (const row of filasAplicables) {
            const id = Number(row.id);
            const actual = porDescuento.get(id) || [];
            actual.push(row);
            porDescuento.set(id, actual);
        }
        for (const [id, candidatas] of porDescuento) {
            const exacta = candidatas.filter((row) => Number(row.servicio_id) === Number(servicioId));
            const opciones = exacta.length ? exacta : candidatas;
            // Una equivalencia canónica duplicada dentro de la sede es ambigua:
            // no se presenta al usuario hasta que la regla se consolide.
            if (opciones.length !== 1) continue;
            const row = opciones[0];
            const tipoCalculo = row.tipo_calculo;
            const valorFinal = Number(tipoCalculo === 'FLAT' ? row.valor_contado : row.valor);
            if (!['FLAT', 'MONTO', 'PORCENTAJE'].includes(tipoCalculo) || !Number.isFinite(valorFinal) || valorFinal <= 0) {
                continue;
            }
            let calculo;
            try {
                calculo = validarPrecioRegla({
                    tipoCalculo,
                    valor: tipoCalculo === 'FLAT' ? null : valorFinal,
                    valorContado: tipoCalculo === 'FLAT' ? valorFinal : null,
                    valorCredito: null
                }, tarifaOriginal, {
                    plantaKey: certificado.planta_key,
                    sede: certificado.planta_nombre,
                    servicioId,
                    tarifaCodigo: certificado.tarifa_codigo
                });
            } catch (_) {
                continue;
            }
            const { importeDescuento, importeFinal } = calculo;

            let beneficio = '';
            if (tipoCalculo === 'PORCENTAJE') {
                beneficio = `${valorFinal}% (-S/ ${importeDescuento.toFixed(2)})`;
            } else if (tipoCalculo === 'MONTO') {
                beneficio = `Fijo -S/ ${importeDescuento.toFixed(2)}`;
            } else {
                beneficio = `Tarifa plana S/ ${valorFinal.toFixed(2)} (-S/ ${importeDescuento.toFixed(2)})`;
            }

            disponibles.push({
                id,
                codigo: row.codigo,
                nombre: row.nombre,
                tipo: row.tipo,
                empresaAliada: row.empresa_aliada_nombre,
                tipoCalculo,
                valor: valorFinal,
                tarifaOriginal,
                importeDescuento,
                importeFinal,
                beneficio,
                autorizaGratuidad: false
            });
        }

        return disponibles;
    } finally {
        client.release();
    }
};

exports.consultarDescuento = async (codigo, certificadoId, userContext) => {
    const client = await db.connect();
    try {
        const resultado = await consultarDescuentoCore(client, codigo, certificadoId, userContext, false);
        delete resultado.certificado;
        return resultado;
    } finally {
        client.release();
    }
};

exports.aplicarDescuentoDirectoBorrador = async (certificadoId, descuentoId, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const contexto = await obtenerContextoEdicionDescuento(client, certificadoId, userContext);
        const reservaActual = await obtenerReservaActivaBloqueada(client, certificadoId);
        if (reservaActual?.estado === 'APLICADO') throw errorNegocio('DESCUENTO_APLICADO_NO_MODIFICABLE', 409);
        const calculo = await consultarDescuentoDirectoCore(client, descuentoId, certificadoId, userContext, true);
        const importeServicioActual = reservaActual
            ? redondearMoneda(reservaActual.importe_final)
            : calculo.tarifaOriginal;
        const orden = await actualizarOrdenBorradorPorDescuento(
            client, contexto, calculo.importeFinal, importeServicioActual, userContext
        );
        await guardarReservaDescuento(client, calculo, reservaActual, orden, userContext);

        await client.query('COMMIT');
        calculo.plantaKey = calculo.certificado?.planta_key || null;
        delete calculo.certificado;
        return calculo;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.aplicarDescuentoBorrador = async (certificadoId, codigo, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const contexto = await obtenerContextoEdicionDescuento(client, certificadoId, userContext);
        const reservaActual = await obtenerReservaActivaBloqueada(client, certificadoId);
        if (reservaActual?.estado === 'APLICADO') throw errorNegocio('DESCUENTO_APLICADO_NO_MODIFICABLE', 409);
        const calculo = await consultarDescuentoCore(client, codigo, certificadoId, userContext, true, true);
        const importeServicioActual = reservaActual
            ? redondearMoneda(reservaActual.importe_final)
            : calculo.tarifaOriginal;
        const orden = await actualizarOrdenBorradorPorDescuento(
            client, contexto, calculo.importeFinal, importeServicioActual, userContext
        );
        await guardarReservaDescuento(client, calculo, reservaActual, orden, userContext);

        await client.query('COMMIT');
        calculo.plantaKey = calculo.certificado?.planta_key || null;
        delete calculo.certificado;
        return calculo;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.quitarDescuentoBorrador = async (certificadoId, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const contexto = await obtenerContextoEdicionDescuento(client, certificadoId, userContext);
        const reservaActual = await obtenerReservaActivaBloqueada(client, certificadoId);
        if (reservaActual?.estado === 'APLICADO') throw errorNegocio('DESCUENTO_APLICADO_NO_MODIFICABLE', 409);

        if (reservaActual) {
            const tarifaOriginal = await obtenerPrecioOriginalServicio(client, contexto.certificado, reservaActual.importe_original);
            await actualizarOrdenBorradorPorDescuento(
                client, contexto, tarifaOriginal, redondearMoneda(reservaActual.importe_final), userContext
            );
            await client.query(`
                UPDATE fg_descuentocomprobante
                SET estado = 'LIBERADO', usuario_modificacion = $2, fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $1 AND estado = 'RESERVADO'
            `, [reservaActual.id, userContext.username]);
        }

        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.obtenerDescuentoBorrador = async (certificadoId, userContext) => {
    const client = await db.connect();
    try {
        // Check access
        await obtenerCertificado(client, certificadoId, userContext);
        
        const sql = `
            SELECT cmp.descuento_id, cmp.descuento_cliente_id, dc.codigo 
            FROM fg_descuentocomprobante cmp
            LEFT JOIN fg_descuentocliente dc ON dc.id = cmp.descuento_cliente_id
            WHERE cmp.certificado_id = $1 AND cmp.estado IN ('RESERVADO', 'APLICADO')
            AND cmp.reservado_hasta >= CURRENT_TIMESTAMP
            ORDER BY cmp.id DESC LIMIT 1
        `;
        const res = await client.query(sql, [certificadoId]);
        if (res.rowCount === 0) return null;
        
        const row = res.rows[0];
        if (row.descuento_id) {
            return await consultarDescuentoDirectoCore(client, row.descuento_id, certificadoId, userContext, false);
        } else if (row.codigo) {
            return await consultarDescuentoCore(client, row.codigo, certificadoId, userContext, false);
        }
        return null;
    } catch (error) {
        if (error.code === 'DESCUENTO_NO_APLICA_SERVICIO' || error.code === 'DESCUENTO_NO_APLICA_PLACA' || error.code === 'CODIGO_VENCIDO') {
            return null; // Si ya no aplica, retornar nulo para que el frontend pida liberarlo
        }
        throw error;
    } finally {
        client.release();
    }
};

// ----------------------------------------------------------------------
// METODOS INTERNOS PARA PAGOS
// ----------------------------------------------------------------------

exports.obtenerResumenDescuentoCertificado = async (queryable, certificado) => {
    let tarifaOriginal = certificado.precio_certificado === null || certificado.precio_certificado === undefined
        ? 0
        : Number(certificado.precio_certificado);
    if (!tarifaOriginal && certificado.tarifa_codigo) {
        const tarifaOp = await tarifasService.obtenerTarifaOperativaPorCodigo(
            certificado.planta_key,
            certificado.tarifa_codigo,
            queryable
        );
        if (tarifaOp) tarifaOriginal = Number(tarifasService.validarTarifaCertificacion(tarifaOp).precio);
    }

    // La tarifa se valida antes de consultar descuentos para que un servicio
    // no certificable jamás avance hacia pago aunque no tenga descuento.
    const sql = `
        SELECT cmp.*,
               COALESCE(dc.codigo, CASE WHEN d.id = 17 OR UPPER(BTRIM(d.codigo)) = 'D_CONVENIO_A88137BB742F4157' OR EXISTS (SELECT 1 FROM fg_descuentocliente dcp WHERE dcp.descuento_id = d.id AND UPPER(BTRIM(dcp.codigo)) IN ('CORTESIA_FAREGAS', 'DESCUENTO_TALLER')) THEN 'CORTESIA_FAREGAS' ELSE d.codigo END) AS codigo,
               COALESCE(dc.codigo, CASE WHEN d.id = 17 OR UPPER(BTRIM(d.codigo)) = 'D_CONVENIO_A88137BB742F4157' OR EXISTS (SELECT 1 FROM fg_descuentocliente dcp WHERE dcp.descuento_id = d.id AND UPPER(BTRIM(dcp.codigo)) IN ('CORTESIA_FAREGAS', 'DESCUENTO_TALLER')) THEN 'CORTESIA_FAREGAS' ELSE d.codigo END) AS codigo_autorizacion,
               d.nombre AS descuento_nombre,
               d.empresa_aliada_nombre
        FROM fg_descuentocomprobante cmp
        LEFT JOIN fg_descuentocliente dc ON dc.id = cmp.descuento_cliente_id
        LEFT JOIN fg_descuento d ON d.id = COALESCE(cmp.descuento_id, dc.descuento_id)
        WHERE cmp.certificado_id = $1 AND cmp.estado IN ('RESERVADO', 'APLICADO')
        ORDER BY cmp.id DESC LIMIT 1
    `;
    const res = await queryable.query(sql, [certificado.id]);

    if (res.rowCount === 0) {
        return {
            tarifaOriginal,
            descuento: 0,
            totalFinal: tarifaOriginal,
            reserva: null
        };
    }

    const reserva = res.rows[0];
    if (esDescuentoLegadoFarenet(reserva) && !esDescuentoEspecialCortesia({
        descuento_id: reserva.descuento_id,
        codigo: reserva.codigo_autorizacion || reserva.codigo,
        nombre: reserva.descuento_nombre
    })) {
        throw errorNegocio('DESCUENTO_ORIGEN_NO_AUTORIZADO', 422);
    }
    if (Math.abs(Number(reserva.importe_original) - tarifaOriginal) > 0.009) {
        throw errorNegocio('DESCUENTO_REQUIERE_REVALIDACION', 409);
    }
    // Revalidar vigencia si está en reservado
    if (reserva.estado === 'RESERVADO') {
        const ahora = new Date();
        if (!reserva.orden_pago_id && ahora > new Date(reserva.reservado_hasta)) {
            // Ya expiró, la devolvemos como nula y debería liberarse (el job asíncrono o la vista lo liberará)
            return {
                tarifaOriginal,
                descuento: 0,
                totalFinal: tarifaOriginal,
                reserva: null
            };
        }
    }

    return {
        tarifaOriginal: Number(reserva.importe_original),
        descuento: Number(reserva.importe_descuento),
        totalFinal: Number(reserva.importe_final),
        reserva
    };
};

exports.consumirDescuentoSiExiste = async (queryable, certificadoId, ordenPagoId, userContext) => {
    // Llamado desde el servicio de pagos CUANDO EL PAGO QUEDA 'PAGADO'.
    const sql = `
        SELECT cmp.id, cmp.descuento_id, cmp.descuento_cliente_id, cmp.estado, cmp.reservado_hasta, cmp.orden_pago_id
        FROM fg_descuentocomprobante cmp
        WHERE cmp.certificado_id = $1 AND cmp.estado IN ('RESERVADO', 'APLICADO')
        FOR UPDATE
    `;
    const res = await queryable.query(sql, [certificadoId]);
    if (res.rowCount === 0) return;

    const reserva = res.rows[0];
    if (reserva.estado === 'RESERVADO') {
        if (!reserva.orden_pago_id && new Date(reserva.reservado_hasta) < new Date()) {
            await queryable.query(`UPDATE fg_descuentocomprobante SET estado='LIBERADO',
                usuario_modificacion=$1, fecha_modificacion=CURRENT_TIMESTAMP WHERE id=$2`,
            [userContext.username, reserva.id]);
            return;
        }

        // Si tiene descuento_cliente_id (código), consumir en fg_descuentocliente
        if (reserva.descuento_cliente_id) {
            await queryable.query('SELECT id FROM fg_descuentocliente WHERE id=$1 FOR UPDATE', [reserva.descuento_cliente_id]);
            await queryable.query(`
                UPDATE fg_descuentocliente 
                SET usos_realizados = usos_realizados + 1, fecha_modificacion = CURRENT_TIMESTAMP, usuario_modificacion = $1
                WHERE id = $2
            `, [userContext.username, reserva.descuento_cliente_id]);
        }

        await queryable.query(`
            UPDATE fg_descuentocomprobante 
            SET estado = 'APLICADO', orden_pago_id = $3, fecha_aplicacion = CURRENT_TIMESTAMP,
                usuario_modificacion = $1, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [userContext.username, reserva.id, ordenPagoId]);
    }
};

// ----------------------------------------------------------------------
// EXPORTS ADMINISTRATIVOS
// ----------------------------------------------------------------------
const normalizarInicioDia = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''))
    ? `${valor}T00:00:00`
    : valor;
const normalizarFinDia = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''))
    ? `${valor}T23:59:59.999`
    : valor;

const normalizarCampana = (data) => ({
    nombre: String(data.nombre || '').trim(),
    tipo: String(data.tipo || '').trim().toUpperCase(),
    empresaAliadaRuc: String(data.empresaAliadaRuc || '').trim() || null,
    empresaAliadaNombre: String(data.empresaAliadaNombre || '').trim() || null,
    ejecutivo: String(data.ejecutivo || '').trim() || null,
    fechaInicio: normalizarInicioDia(data.fechaInicio),
    fechaFin: normalizarFinDia(data.fechaFin)
});

const validarCampana = (data) => {
    if (!data.nombre) throw errorNegocio('NOMBRE_DESCUENTO_REQUERIDO', 400);
    if (!['CAMPANA', 'ALIANZA', 'CONVENIO', 'PROMOCION'].includes(data.tipo)) throw errorNegocio('TIPO_DESCUENTO_INVALIDO', 400);
    if (!data.fechaInicio || !data.fechaFin || new Date(data.fechaFin) < new Date(data.fechaInicio)) {
        throw errorNegocio('VIGENCIA_DESCUENTO_INVALIDA', 400);
    }
};

const generarCodigoInternoCampana = (tipo) => `D_${tipo}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

const obtenerOCrearEjecutivo = async (client, nombre, username) => {
    if (!nombre) return null;
    await client.query(`
        INSERT INTO fg_ejecutivo (nombre, usuario_creacion)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
    `, [nombre, username]);
    const result = await client.query(`
        SELECT id
        FROM fg_ejecutivo
        WHERE LOWER(BTRIM(nombre)) = LOWER(BTRIM($1))
        LIMIT 1
    `, [nombre]);
    if (!result.rowCount) throw errorNegocio('EJECUTIVO_NO_REGISTRADO', 500);
    return Number(result.rows[0].id);
};

exports.listarDescuentos = async (filtros = {}) => {
    const params = [];
    let where = `WHERE 1=1
        AND d.id <> ${DESCUENTO_ID_CORTESIA_HISTORICO}
        AND UPPER(BTRIM(COALESCE(d.codigo, ''))) NOT IN ('CORTESIA_FAREGAS', 'DESCUENTO_TALLER', 'D_CONVENIO_A88137BB742F4157')
        AND UPPER(BTRIM(COALESCE(d.nombre, ''))) NOT IN ('DESCUENTO CERTIFICADO TALLER', 'CORTESIA FAREGAS', 'CORTESÍA FAREGAS')
        AND UPPER(COALESCE(d.nombre, '')) NOT LIKE '%CORTESIA%'
        AND UPPER(COALESCE(d.nombre, '')) NOT LIKE '%CORTESÍA%'
        AND REGEXP_REPLACE(UPPER(BTRIM(COALESCE(d.empresa_aliada_nombre, ''))), '[^A-Z0-9]', '', 'g') NOT IN ('FARENET', 'FARENETSAC')
        AND NOT EXISTS (
            SELECT 1 FROM fg_descuentocliente dc_protected
            WHERE dc_protected.descuento_id=d.id
              AND UPPER(BTRIM(dc_protected.codigo)) IN ('CORTESIA_FAREGAS', 'DESCUENTO_TALLER', 'D_CONVENIO_A88137BB742F4157')
        )`;
    if (filtros.estado === 'ACTIVOS') where += ' AND d.activo = TRUE AND d.fecha_fin >= CURRENT_TIMESTAMP';
    if (filtros.estado === 'INACTIVOS') where += ' AND d.activo = FALSE';
    if (filtros.estado === 'VENCIDOS') where += ' AND d.fecha_fin < CURRENT_TIMESTAMP';
    if (filtros.buscar) {
        params.push(`%${String(filtros.buscar).trim()}%`);
        where += ` AND (d.codigo ILIKE $${params.length} OR d.nombre ILIKE $${params.length} OR COALESCE(d.empresa_aliada_nombre, '') ILIKE $${params.length})`;
    }
    const result = await db.query(`
        SELECT d.*,
               (SELECT COUNT(DISTINCT dd.servicio_id) FROM fg_descuentodetalle dd
                WHERE dd.descuento_id=d.id AND dd.descuento_cliente_id IS NULL AND dd.activo=TRUE) AS total_servicios,
               (SELECT COUNT(*) FROM fg_descuentocliente dc_total
                WHERE dc_total.descuento_id=d.id) AS total_codigos,
               COALESCE((SELECT SUM(dc_usos.usos_realizados)
                         FROM fg_descuentocliente dc_usos
                          WHERE dc_usos.descuento_id=d.id), 0) AS usos_realizados,
               EXISTS (
                   SELECT 1 FROM fg_descuentocliente dc_protegido
                   WHERE dc_protegido.descuento_id = d.id
                     AND UPPER(BTRIM(dc_protegido.codigo)) = $${params.length + 1}
               ) AS protegido
        FROM fg_descuento d
        ${where}
        ORDER BY d.activo DESC, d.fecha_fin DESC, d.nombre
    `, [...params, CODIGO_AUTORIZACION_GRATUIDAD_TALLER]);
    return result.rows;
};

exports.obtenerMaestrosAdministracion = async () => {
    const [plantas, servicios, serviciosPorPlanta, ejecutivos] = await Promise.all([
        db.query('SELECT key, nombre FROM fg_planta WHERE activo = TRUE ORDER BY nombre'),
        db.query(`SELECT s.id, s.codigo, s.nombre, s.familia, s.tipo_certificado_clave,
                         s.modalidad, s.tipo_flujo, c.codigo AS categoria_codigo, c.nombre AS categoria,
                         formato_raiz.codigo AS formato_codigo_canonico
                  FROM fg_servicio s JOIN fg_categoria_servicio c ON c.id = s.categoria_id
                  LEFT JOIN fg_certificado_formato formato ON formato.id=s.formato_id
                  LEFT JOIN fg_certificado_formato formato_raiz
                    ON formato_raiz.id=COALESCE(formato.formato_padre_id, formato.id)
                  WHERE s.activo = TRUE ORDER BY c.orden, s.orden, s.nombre`),
        db.query(`SELECT t.planta_key, p.nombre AS sede_nombre, s.id, s.codigo, s.nombre,
                         s.familia, c.codigo AS categoria_codigo, c.nombre AS categoria,
                         s.tipo_certificado_clave, s.modalidad, s.tipo_flujo,
                         formato_raiz.codigo AS formato_codigo_canonico,
                         t.codigo AS tarifa_codigo, t.producto_facturacion_id, t.activo AS tarifa_activa,
                         pf.codigo_sku AS producto_sku, pf.descripcion AS producto_descripcion,
                         pf.activo AS producto_activo, pf.es_para_venta AS producto_para_venta,
                         pf.precio_referencia AS producto_precio_referencia,
                         pf.precio_unitario AS producto_precio_unitario
                  FROM fg_tarifa t
                  JOIN fg_planta p ON p.key=t.planta_key
                  JOIN fg_servicio s ON s.id=t.servicio_id
                  JOIN fg_categoria_servicio c ON c.id=s.categoria_id
                  LEFT JOIN fg_producto_facturacion pf ON pf.id=t.producto_facturacion_id
                  LEFT JOIN fg_certificado_formato formato ON formato.id=s.formato_id
                  LEFT JOIN fg_certificado_formato formato_raiz
                    ON formato_raiz.id=COALESCE(formato.formato_padre_id, formato.id)
                  WHERE p.activo=TRUE AND t.activo=TRUE AND s.activo=TRUE AND c.activo=TRUE
                    AND s.tipo_flujo = ANY($1::varchar[])
                  ORDER BY p.nombre, c.orden, s.orden, s.nombre`, [FLUJOS_DESCONTABLES]),
        db.query(`SELECT id, username, nombre
                  FROM fg_ejecutivo
                  WHERE activo=TRUE
                  ORDER BY nombre`)
    ]);
    return {
        plantas: plantas.rows,
        servicios: servicios.rows,
        serviciosPorPlanta: serviciosPorPlanta.rows.map(mapearServicioAdministracion),
        ejecutivos: ejecutivos.rows
    };
};

exports.crearDescuento = async (data, userContext) => {
    const normalizada = normalizarCampana(data);
    validarCampana(normalizada);
    const codigoInterno = generarCodigoInternoCampana(normalizada.tipo);
    const esRelacionCorporativa = normalizada.tipo === 'ALIANZA' || normalizada.tipo === 'CONVENIO';
    const empresaAliadaRuc = esRelacionCorporativa ? normalizada.empresaAliadaRuc : null;
    const empresaAliadaNombre = esRelacionCorporativa ? normalizada.empresaAliadaNombre : null;
    const ejecutivo = normalizada.tipo === 'ALIANZA' ? normalizada.ejecutivo : null;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const ejecutivoId = await obtenerOCrearEjecutivo(client, ejecutivo, userContext.username);
        const result = await client.query(`
            INSERT INTO fg_descuento
                (codigo, nombre, tipo, empresa_aliada_ruc, empresa_aliada_nombre, ejecutivo, ejecutivo_id,
                 tipo_calculo, valor, fecha_inicio, fecha_fin, planta_key, usuario_creacion)
            VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9,NULL,$10) RETURNING id
        `, [codigoInterno, normalizada.nombre, normalizada.tipo, empresaAliadaRuc,
            empresaAliadaNombre, ejecutivo, ejecutivoId, normalizada.fechaInicio, normalizada.fechaFin, userContext.username]);
        const id = result.rows[0].id;
        await client.query('COMMIT');
        return { id: Number(id) };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw errorNegocio('DESCUENTO_DUPLICADO', 409);
        throw error;
    } finally { client.release(); }
};

exports.actualizarDescuento = async (id, data, userContext) => {
    const normalizada = normalizarCampana(data);
    validarCampana(normalizada);
    const esRelacionCorporativa = normalizada.tipo === 'ALIANZA' || normalizada.tipo === 'CONVENIO';
    const empresaAliadaRuc = esRelacionCorporativa ? normalizada.empresaAliadaRuc : null;
    const empresaAliadaNombre = esRelacionCorporativa ? normalizada.empresaAliadaNombre : null;
    const ejecutivo = normalizada.tipo === 'ALIANZA' ? normalizada.ejecutivo : null;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const ejecutivoId = await obtenerOCrearEjecutivo(client, ejecutivo, userContext.username);
        const result = await client.query(`UPDATE fg_descuento SET
            nombre=$2, tipo=$3, empresa_aliada_ruc=$4, empresa_aliada_nombre=$5,
            ejecutivo=$6, ejecutivo_id=$7, fecha_inicio=$8, fecha_fin=$9,
            usuario_modificacion=$10, fecha_modificacion=CURRENT_TIMESTAMP
            WHERE id=$1 RETURNING id`, [id, normalizada.nombre, normalizada.tipo,
            empresaAliadaRuc, empresaAliadaNombre, ejecutivo, ejecutivoId,
            normalizada.fechaInicio, normalizada.fechaFin, userContext.username]);
        if (!result.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw errorNegocio('DESCUENTO_DUPLICADO', 409);
        throw error;
    } finally { client.release(); }
};

exports.cambiarEstadoDescuento = async (id, activo, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const check = await client.query('SELECT * FROM fg_descuento WHERE id=$1', [id]);
        if (!check.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
        const anterior = check.rows[0];
        if (!Boolean(activo) && await consultarConvenioProtegido(client, id, true)) {
            throw errorNegocio('CONVENIO_GRATUIDAD_PROTEGIDO', 409);
        }

        await client.query(`UPDATE fg_descuento SET activo=$2, usuario_modificacion=$3,
            fecha_modificacion=CURRENT_TIMESTAMP WHERE id=$1`, [id, Boolean(activo), userContext.username]);

        // Registrar auditoria en tabla de acceso/eventos (fg_auditoria_acceso) para que salga en la pestaña DESCUENTOS
        await auditoriaService.registrarEvento({
            username: userContext.username,
            evento: activo ? 'ACTIVAR_DESCUENTO' : 'DESACTIVAR_DESCUENTO',
            exitoso: true,
            mensaje: `Se ha ${activo ? 'activado' : 'desactivado'} el descuento ${anterior.nombre}`,
            ip_direccion: userContext.ip_direccion,
            categoria: 'DESCUENTO',
            entidad: 'fg_descuento',
            entidad_id: id,
            datos: { antes: { activo: anterior.activo }, despues: { activo } }
        });

        await client.query('COMMIT');
        return { success: true };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerImpactoDescuento = (id) => descuentosImpactoService.preview(Number(id));

exports.eliminarDescuento = async (id, userContext, ipDireccion = null) => {
    const descuentoId = Number(id);
    if (!Number.isSafeInteger(descuentoId) || descuentoId <= 0) {
        throw errorNegocio('DESCUENTO_NO_ENCONTRADO', 404);
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const check = await client.query(
            'SELECT * FROM fg_descuento WHERE id=$1 FOR UPDATE', [descuentoId]
        );
        if (!check.rowCount) throw errorNegocio('DESCUENTO_NO_ENCONTRADO', 404);
        if (await consultarConvenioProtegido(client, descuentoId, true)) {
            throw errorNegocio('CONVENIO_GRATUIDAD_NO_ELIMINABLE', 409);
        }

        const impacto = await descuentosImpactoService.calcularImpactoEnTransaccion(
            client, descuentoId, check.rows[0]
        );
        const limpieza = await descuentosImpactoService.eliminarDescuentoConDependencias(client, impacto);

        await auditoriaService.registrarEvento({
            username: userContext.username,
            evento: 'ELIMINAR_DESCUENTO',
            exitoso: true,
            mensaje: `Se eliminó la campaña ${check.rows[0].nombre} y su configuración de prueba`,
            ip_direccion: ipDireccion || userContext.ip_direccion,
            categoria: 'DESCUENTO',
            entidad: 'fg_descuento',
            entidad_id: descuentoId,
            datos: { limpieza, ambiente: impacto.ambiente }
        });

        await client.query('COMMIT');
        return {
            id: descuentoId,
            codigo: check.rows[0].codigo,
            nombre: check.rows[0].nombre,
            ...limpieza
        };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerDetalleAdministracion = async (id) => {
    const [descuento, reglas] = await Promise.all([
        db.query('SELECT * FROM fg_descuento WHERE id=$1', [id]),
        db.query(`SELECT dd.planta_key AS "plantaKey", dd.servicio_id AS "servicioId",
                         dd.tipo_calculo AS "tipoCalculo", dd.valor,
                         dd.valor_contado AS "valorContado", dd.valor_credito AS "valorCredito"
                  FROM fg_descuentodetalle dd
                  JOIN fg_planta p ON p.key=dd.planta_key
                  WHERE dd.descuento_id=$1
                    AND dd.descuento_cliente_id IS NULL
                    AND dd.activo=TRUE
                  ORDER BY p.nombre, dd.servicio_id`, [id])
    ]);
    if (!descuento.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
    return { descuento: descuento.rows[0], reglas: reglas.rows };
};

const normalizarCodigoCliente = (data) => ({
    codigo: String(data.codigo || '').trim().toUpperCase(),
    placa: String(data.placa || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null,
    fechaInicio: normalizarInicioDia(data.fechaInicio || null),
    fechaFin: normalizarFinDia(data.fechaFin || null),
    maxUsos: Number(data.maxUsos || 1)
});

const normalizarReglasCampana = (data) => (
    Array.isArray(data.reglas) ? data.reglas : []
).map(item => {
    const normalizarValor = (valor) => {
        if (valor === '' || valor == null) return null;
        if (!tieneMaximoDosDecimales(valor)) throw errorNegocio('IMPORTE_DECIMALES_INVALIDOS', 400);
        return normalizarValorRegla(valor);
    };
    return {
        plantaKey: String(item.plantaKey || '').trim(),
        servicioId: Number(item.servicioId),
        tipoCalculo: String(item.tipoCalculo || '').trim().toUpperCase(),
        // Conservar los importes decimales como texto hasta PostgreSQL NUMERIC,
        // evitando conversiones de ida y vuelta por coma flotante.
        valor: normalizarValor(item.valor),
        valorContado: normalizarValor(item.valorContado),
        valorCredito: normalizarValor(item.valorCredito)
    };
});

const validarReglasCampana = (reglas) => {
    if (reglas.length === 0) throw errorNegocio('SERVICIOS_DESCUENTO_REQUERIDOS', 400);
    const combinaciones = new Set();
    for (const detalle of reglas) {
        if (!detalle.plantaKey || !Number.isInteger(detalle.servicioId)) {
            throw errorNegocio('REFERENCIA_DESCUENTO_INVALIDA', 400);
        }
        if (!['FLAT', 'MONTO', 'PORCENTAJE'].includes(detalle.tipoCalculo)) {
            throw errorNegocio('TIPO_CALCULO_INVALIDO', 400);
        }
        if (detalle.tipoCalculo === 'FLAT') {
            if (detalle.valor != null || (detalle.valorContado == null && detalle.valorCredito == null)) {
                throw errorNegocio('VALOR_DESCUENTO_INVALIDO', 400);
            }
            const valores = [detalle.valorContado, detalle.valorCredito].filter(valor => valor != null);
            if (valores.some(valor => !Number.isFinite(Number(valor)) || Number(valor) <= 0)) {
                throw errorNegocio('VALOR_DESCUENTO_INVALIDO', 400);
            }
        } else if (!Number.isFinite(Number(detalle.valor))
            || Number(detalle.valor) <= 0
            || detalle.valorContado != null
            || detalle.valorCredito != null) {
            throw errorNegocio('VALOR_DESCUENTO_INVALIDO', 400);
        }

        const combinacion = `${detalle.plantaKey}:${detalle.servicioId}`;
        if (combinaciones.has(combinacion)) throw errorNegocio('REGLA_DESCUENTO_DUPLICADA', 400);
        combinaciones.add(combinacion);
    }
};

const validarCodigoCliente = (regla) => {
    if (!/^[A-Z0-9_-]{2,80}$/.test(regla.codigo)) throw errorNegocio('CODIGO_CLIENTE_INVALIDO', 400);
    if (!Number.isInteger(regla.maxUsos) || regla.maxUsos <= 0) throw errorNegocio('MAX_USOS_INVALIDO', 400);
    if ((regla.fechaInicio && !regla.fechaFin) || (!regla.fechaInicio && regla.fechaFin)) {
        throw errorNegocio('VIGENCIA_CODIGO_INVALIDA', 400);
    }
};

const normalizarPrefijoLote = (valor) => String(valor || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

const generarItemsLote = (data) => {
    const prefijo = normalizarPrefijoLote(data.prefijo);
    const cantidad = Number(data.cantidad);
    const maxUsos = Number(data.maxUsos || 1);
    if (!prefijo || prefijo.length > 70) throw errorNegocio('PREFIJO_CODIGO_INVALIDO', 400);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000) {
        throw errorNegocio('CANTIDAD_CODIGOS_INVALIDA', 400);
    }
    if (!Number.isInteger(maxUsos) || maxUsos < 1) throw errorNegocio('MAX_USOS_INVALIDO', 400);
    return Array.from({ length: cantidad }, (_, indice) => ({
        codigo: `${prefijo}-${String(indice + 1).padStart(6, '0')}`,
        placa: null,
        maxUsos
    }));
};

const normalizarItemImportacion = (item, indice) => {
    const codigo = String(item?.codigo || '').trim().toUpperCase();
    const placaOriginal = String(item?.placa || '').trim().toUpperCase();
    const placa = placaOriginal.replace(/[^A-Z0-9]/g, '') || null;
    const maxUsos = Number(item?.maxUsos ?? item?.max_usos ?? 1);
    const errores = [];
    if (!codigo) errores.push('CODIGO_VACIO');
    else if (!/^[A-Z0-9_-]{2,80}$/.test(codigo)) errores.push('CODIGO_INVALIDO');
    if (!Number.isInteger(maxUsos) || maxUsos < 1) errores.push('MAX_USOS_INVALIDO');
    if (placaOriginal && (!placa || placa.length < 3 || placa.length > 12)) errores.push('PLACA_INVALIDA');
    return { fila: indice + 2, codigo, placa, maxUsos, errores };
};

const validarVigenciaCodigos = (data, campana) => {
    const fechaInicio = normalizarInicioDia(data.fechaInicio || null);
    const fechaFin = normalizarFinDia(data.fechaFin || null);
    if ((fechaInicio && !fechaFin) || (!fechaInicio && fechaFin)) {
        throw errorNegocio('VIGENCIA_CODIGO_INVALIDA', 400);
    }
    if (fechaInicio && (
        new Date(fechaInicio) < new Date(campana.fecha_inicio)
        || new Date(fechaFin) > new Date(campana.fecha_fin)
    )) throw errorNegocio('VIGENCIA_CODIGO_FUERA_DE_CAMPANA', 400);
    return { fechaInicio, fechaFin };
};

const prepararItemsCodigos = (items) => {
    const vistos = new Set();
    const validos = [];
    const errores = [];
    let duplicadosArchivo = 0;
    let rechazados = 0;
    items.forEach((item, indice) => {
        const normalizado = normalizarItemImportacion(item, indice);
        if (normalizado.codigo && vistos.has(normalizado.codigo)) {
            duplicadosArchivo += 1;
            errores.push({ fila: normalizado.fila, codigo: normalizado.codigo, motivo: 'DUPLICADO_ARCHIVO' });
            return;
        }
        if (normalizado.codigo) vistos.add(normalizado.codigo);
        if (normalizado.errores.length) {
            rechazados += 1;
            errores.push(...normalizado.errores.map(motivo => ({ fila: normalizado.fila, codigo: normalizado.codigo, motivo })));
            return;
        }
        validos.push(normalizado);
    });
    return { validos, errores, duplicadosArchivo, rechazados };
};

const insertarCodigosMasivos = async (client, descuentoId, items, vigencia, username) => {
    const tamanoLote = 500;
    for (let inicio = 0; inicio < items.length; inicio += tamanoLote) {
        const lote = items.slice(inicio, inicio + tamanoLote);
        await client.query(`INSERT INTO fg_descuentocliente
            (descuento_id, codigo, tipo_documento, nro_documento, placa, planta_key,
             tipo_calculo, valor_contado, valor_credito, fecha_inicio, fecha_fin,
             max_usos, usuario_creacion)
            SELECT $1, datos.codigo, NULL, NULL, datos.placa, NULL,
                   NULL, NULL, NULL, $2, $3, datos.max_usos, $4
            FROM UNNEST($5::text[], $6::text[], $7::integer[])
                 AS datos(codigo, placa, max_usos)`, [
            descuentoId,
            vigencia.fechaInicio,
            vigencia.fechaFin,
            username,
            lote.map(item => item.codigo),
            lote.map(item => item.placa),
            lote.map(item => item.maxUsos)
        ]);
    }
};

const procesarCodigosMasivos = async (client, descuentoId, items, data, userContext) => {
    if (!Array.isArray(items) || items.length < 1 || items.length > 10000) {
        throw errorNegocio('CANTIDAD_CODIGOS_INVALIDA', 400);
    }
    const campana = await client.query(
        'SELECT fecha_inicio, fecha_fin FROM fg_descuento WHERE id=$1 FOR UPDATE',
        [descuentoId]
    );
    if (!campana.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
    const reglas = await client.query(`SELECT 1 FROM fg_descuentodetalle
        WHERE descuento_id=$1 AND descuento_cliente_id IS NULL AND activo=TRUE LIMIT 1`, [descuentoId]);
    if (!reglas.rowCount) throw errorNegocio('REGLAS_DESCUENTO_REQUERIDAS', 409);
    const vigencia = validarVigenciaCodigos(data, campana.rows[0]);
    const preparados = prepararItemsCodigos(items);
    const codigos = preparados.validos.map(item => item.codigo);
    const existentes = codigos.length ? await client.query(`SELECT UPPER(BTRIM(codigo)) AS codigo
        FROM fg_descuentocliente
        WHERE UPPER(BTRIM(codigo)) = ANY($1::text[])`, [codigos]) : { rows: [] };
    const existentesSet = new Set(existentes.rows.map(row => row.codigo));
    const nuevos = preparados.validos.filter(item => !existentesSet.has(item.codigo));
    const errores = [
        ...preparados.errores,
        ...preparados.validos.filter(item => existentesSet.has(item.codigo))
            .map(item => ({ fila: item.fila, codigo: item.codigo, motivo: 'DUPLICADO_BD' }))
    ];
    if (!data.validarSolo) await insertarCodigosMasivos(client, descuentoId, nuevos, vigencia, userContext.username);
    return {
        solicitados: items.length,
        creados: data.validarSolo ? 0 : nuevos.length,
        validos: nuevos.length,
        duplicados: preparados.duplicadosArchivo + existentesSet.size,
        rechazados: preparados.rechazados,
        errores: errores.slice(0, 100)
    };
};

exports.listarCodigosAdministracion = async (descuentoId, filtros = {}) => {
    const id = Number(descuentoId);
    const limit = Math.min(100, Math.max(1, Number(filtros.limit) || 20));
    const offset = Math.max(0, Number(filtros.offset) || 0);
    const params = [id];
    let where = 'WHERE dc.descuento_id=$1';
    const estado = String(filtros.estado || 'TODOS').toUpperCase();
    if (estado === 'ACTIVO' || estado === 'INACTIVO') {
        params.push(estado === 'ACTIVO');
        where += ` AND dc.activo=$${params.length}`;
    }
    const search = String(filtros.search || '').trim().toUpperCase();
    if (search) {
        params.push(`%${search}%`);
        where += ` AND (UPPER(BTRIM(dc.codigo)) LIKE $${params.length}
                    OR UPPER(BTRIM(COALESCE(dc.placa, ''))) LIKE $${params.length})`;
    }
    const total = await db.query(`SELECT COUNT(*)::integer AS total
        FROM fg_descuentocliente dc ${where}`, params);
    params.push(limit, offset);
    const items = await db.query(`SELECT dc.id, dc.codigo, dc.placa, dc.fecha_inicio, dc.fecha_fin,
               dc.max_usos, dc.usos_realizados, dc.activo
        FROM fg_descuentocliente dc
        ${where}
        ORDER BY dc.fecha_creacion DESC, dc.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: items.rows, total: Number(total.rows[0].total), limit, offset };
};

exports.generarLoteCodigos = async (descuentoId, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const resultado = await procesarCodigosMasivos(client, descuentoId, generarItemsLote(data), data, userContext);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw errorNegocio('CODIGO_CLIENTE_DUPLICADO', 409);
        throw error;
    } finally { client.release(); }
};

exports.importarCodigos = async (descuentoId, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const resultado = await procesarCodigosMasivos(client, descuentoId, data.items, data, userContext);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw errorNegocio('CODIGO_CLIENTE_DUPLICADO', 409);
        throw error;
    } finally { client.release(); }
};

const guardarReglasCampana = async (client, descuentoId, reglas, username) => {
    await client.query(`UPDATE fg_descuentodetalle
        SET activo=FALSE, usuario_modificacion=$2, fecha_modificacion=CURRENT_TIMESTAMP
        WHERE descuento_id=$1 AND descuento_cliente_id IS NULL`, [descuentoId, username]);

    const conceptosPorSede = new Set();
    for (const regla of reglas) {
        const referencia = await client.query(`SELECT t.producto_facturacion_id,
                    p.nombre AS sede, t.codigo AS tarifa_codigo, t.activo AS tarifa_activa,
                    pf.activo AS producto_activo, pf.es_para_venta AS producto_para_venta,
                    pf.precio_referencia AS producto_precio_referencia,
                    pf.precio_unitario AS producto_precio_unitario,
                    s.id AS servicio_id, s.familia, s.tipo_certificado_clave, s.modalidad, s.tipo_flujo,
                    formato_raiz.codigo AS formato_codigo_canonico
            FROM fg_tarifa t
            JOIN fg_planta p ON p.key=t.planta_key
            JOIN fg_servicio s ON s.id=t.servicio_id
            JOIN fg_categoria_servicio c ON c.id=s.categoria_id
            LEFT JOIN fg_producto_facturacion pf ON pf.id=t.producto_facturacion_id
            LEFT JOIN fg_certificado_formato formato ON formato.id=s.formato_id
            LEFT JOIN fg_certificado_formato formato_raiz
              ON formato_raiz.id=COALESCE(formato.formato_padre_id, formato.id)
            WHERE t.planta_key=$1 AND t.servicio_id=$2 AND t.activo=TRUE
              AND p.activo=TRUE AND s.activo=TRUE AND c.activo=TRUE
              AND s.tipo_flujo = ANY($3::varchar[])`, [
            regla.plantaKey,
            regla.servicioId,
            FLUJOS_DESCONTABLES
        ]);
        if (!referencia.rowCount) throw errorNegocio('REFERENCIA_DESCUENTO_INVALIDA', 400);

        const fila = referencia.rows[0];
        const claveConcepto = claveServicioCanonica(fila);
        const claveSedeConcepto = `${regla.plantaKey}::${claveConcepto}`;
        if (conceptosPorSede.has(claveSedeConcepto)) {
            throw errorNegocio('REGLA_DESCUENTO_CANONICA_DUPLICADA', 400, {
                plantaKey: regla.plantaKey,
                sede: fila.sede,
                servicioId: regla.servicioId,
                message: `${fila.sede}: el mismo concepto de certificado está repetido en más de una regla activa.`
            });
        }
        conceptosPorSede.add(claveSedeConcepto);

        const productoDisponible = fila.producto_facturacion_id != null
            && fila.producto_activo === true
            && fila.producto_para_venta === true;
        const tarifa = productoDisponible ? resolverPrecioServicio(fila) : null;
        if (!Number.isFinite(Number(tarifa)) || Number(tarifa) <= 0) {
            const motivo = !fila.producto_facturacion_id
                ? 'No tiene producto fiscal asociado a la tarifa.'
                : !productoDisponible
                    ? 'El producto fiscal asociado no está activo para venta.'
                    : 'La tarifa no tiene un precio de venta vigente positivo.';
            lanzarErrorPrecioRegla({
                regla,
                precioVenta: null,
                contexto: { plantaKey: regla.plantaKey, sede: fila.sede, servicioId: regla.servicioId, tarifaCodigo: fila.tarifa_codigo },
                evaluacion: { motivo },
                statusCode: 400
            });
        }

        const valores = regla.tipoCalculo === 'FLAT'
            ? [regla.valorContado, regla.valorCredito].filter(valor => valor != null)
            : [regla.valor];
        for (const valor of valores) {
            validarPrecioRegla({
                tipoCalculo: regla.tipoCalculo,
                valor: regla.tipoCalculo === 'FLAT' ? null : valor,
                valorContado: regla.tipoCalculo === 'FLAT' ? valor : null,
                valorCredito: regla.tipoCalculo === 'FLAT' ? valor : null
            }, tarifa, {
                plantaKey: regla.plantaKey,
                sede: fila.sede,
                servicioId: regla.servicioId,
                tarifaCodigo: fila.tarifa_codigo
            }, 400);
        }

        await client.query(`INSERT INTO fg_descuentodetalle
            (descuento_id, descuento_cliente_id, planta_key, servicio_id,
             tipo_calculo, valor, valor_contado, valor_credito, activo, usuario_creacion)
            VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,TRUE,$8)
            ON CONFLICT (descuento_id, planta_key, servicio_id)
                WHERE descuento_cliente_id IS NULL
            DO UPDATE SET tipo_calculo=$4, valor=$5, valor_contado=$6, valor_credito=$7,
                activo=TRUE, usuario_modificacion=$8, fecha_modificacion=CURRENT_TIMESTAMP`,
        [descuentoId, regla.plantaKey, regla.servicioId, regla.tipoCalculo,
            regla.valor, regla.valorContado, regla.valorCredito, username]);
    }
};

exports.consultarConvenioProtegidoAdmin = async (descuentoId) => {
    return consultarConvenioProtegido(db, descuentoId, false);
};

exports.guardarReglasDescuento = async (descuentoId, data, userContext) => {
    // Verificar protección DESCUENTO_TALLER antes de permitir modificaciones
    const convenioProtegido = await exports.consultarConvenioProtegidoAdmin(descuentoId);
    if (convenioProtegido) {
        throw errorNegocio('CONVENIO_GRATUIDAD_PROTEGIDO', 409);
    }
    const reglas = normalizarReglasCampana(data);
    validarReglasCampana(reglas);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const campana = await client.query('SELECT id FROM fg_descuento WHERE id=$1 FOR UPDATE', [descuentoId]);
        if (!campana.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
        await guardarReglasCampana(client, descuentoId, reglas, userContext.username);
        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23503') throw errorNegocio('REFERENCIA_DESCUENTO_INVALIDA', 400);
        throw error;
    } finally {
        client.release();
    }
};

exports.crearCodigoCliente = async (descuentoId, data, userContext) => {
    const regla = normalizarCodigoCliente(data);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const campana = await client.query(
            'SELECT fecha_inicio, fecha_fin FROM fg_descuento WHERE id=$1 FOR UPDATE',
            [descuentoId]
        );
        if (!campana.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
        validarCodigoCliente(regla);
        if (regla.fechaInicio && (
            new Date(regla.fechaInicio) < new Date(campana.rows[0].fecha_inicio)
            || new Date(regla.fechaFin) > new Date(campana.rows[0].fecha_fin)
        )) throw errorNegocio('VIGENCIA_CODIGO_FUERA_DE_CAMPANA', 400);

        const reglasConfiguradas = await client.query(`SELECT 1 FROM fg_descuentodetalle
            WHERE descuento_id=$1 AND descuento_cliente_id IS NULL AND activo=TRUE LIMIT 1`, [descuentoId]);
        if (!reglasConfiguradas.rowCount) throw errorNegocio('REGLAS_DESCUENTO_REQUERIDAS', 409);

        const result = await client.query(`INSERT INTO fg_descuentocliente
            (descuento_id, codigo, tipo_documento, nro_documento, placa, planta_key,
             tipo_calculo, valor_contado, valor_credito, fecha_inicio, fecha_fin,
             max_usos, usuario_creacion)
            VALUES ($1,$2,NULL,NULL,$3,NULL,NULL,NULL,NULL,$4,$5,$6,$7)
            RETURNING id`,
        [descuentoId, regla.codigo, regla.placa, regla.fechaInicio,
            regla.fechaFin, regla.maxUsos, userContext.username]);
        await client.query('COMMIT');
        return { id: Number(result.rows[0].id) };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23503') throw errorNegocio('REFERENCIA_DESCUENTO_INVALIDA', 400);
        if (error.code === '23505') throw errorNegocio('CODIGO_CLIENTE_DUPLICADO', 409);
        throw error;
    } finally {
        client.release();
    }
};

exports.actualizarCodigoCliente = async (codigoId, data, userContext) => {
    const regla = normalizarCodigoCliente(data);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        if (await consultarCodigoProtegido(client, codigoId, true)) {
            throw errorNegocio('CODIGO_GRATUIDAD_PROTEGIDO', 409);
        }
        const actual = await client.query(`SELECT dc.descuento_id, dc.usos_realizados,
                                                  d.fecha_inicio, d.fecha_fin
            FROM fg_descuentocliente dc
            JOIN fg_descuento d ON d.id=dc.descuento_id
            WHERE dc.id=$1 FOR UPDATE OF dc`, [codigoId]);
        if (!actual.rowCount) throw errorNegocio('CODIGO_NOT_FOUND', 404);
        validarCodigoCliente(regla);
        if (regla.maxUsos < Number(actual.rows[0].usos_realizados)) {
            throw errorNegocio('MAX_USOS_MENOR_QUE_USADOS', 409);
        }
        if (regla.fechaInicio && (
            new Date(regla.fechaInicio) < new Date(actual.rows[0].fecha_inicio)
            || new Date(regla.fechaFin) > new Date(actual.rows[0].fecha_fin)
        )) throw errorNegocio('VIGENCIA_CODIGO_FUERA_DE_CAMPANA', 400);

        await client.query(`UPDATE fg_descuentocliente
            SET codigo=$2, placa=$3, planta_key=NULL, tipo_calculo=NULL,
                valor_contado=NULL, valor_credito=NULL, fecha_inicio=$4, fecha_fin=$5,
                max_usos=$6, usuario_modificacion=$7, fecha_modificacion=CURRENT_TIMESTAMP
            WHERE id=$1`, [codigoId, regla.codigo, regla.placa, regla.fechaInicio,
            regla.fechaFin, regla.maxUsos, userContext.username]);
        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23503') throw errorNegocio('REFERENCIA_DESCUENTO_INVALIDA', 400);
        if (error.code === '23505') throw errorNegocio('CODIGO_CLIENTE_DUPLICADO', 409);
        throw error;
    } finally {
        client.release();
    }
};

exports.cambiarEstadoCodigo = async (id, activo, userContext) => {
    if (!Boolean(activo) && await consultarCodigoProtegido(db, id, false)) {
        throw errorNegocio('CODIGO_GRATUIDAD_PROTEGIDO', 409);
    }
    const result = await db.query(`UPDATE fg_descuentocliente
        SET activo=$2, usuario_modificacion=$3, fecha_modificacion=CURRENT_TIMESTAMP
        WHERE id=$1 RETURNING id`, [id, Boolean(activo), userContext.username]);
    if (!result.rowCount) throw errorNegocio('CODIGO_NOT_FOUND', 404);
    return { success: true };
};

exports._private = {
    FLUJOS_DESCONTABLES,
    errorNegocio,
    resolverPrecioServicio,
    mapearServicioAdministracion,
    calcularImporteFinal,
    redondearMoneda,
    actualizarOrdenBorradorPorDescuento,
    validarOrdenPagoEditable,
    guardarReservaDescuento,
    generarItemsLote,
    prepararItemsCodigos,
    validarVigenciaCodigos,
    procesarCodigosMasivos
};
