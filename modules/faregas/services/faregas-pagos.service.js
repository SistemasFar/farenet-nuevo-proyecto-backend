const db = require('../../../config/database');
const faregasAuthService = require('./faregas-auth.service');
const tarifasService = require('./faregas-tarifas.service');
const descuentosService = require('./faregas-descuentos.service');
const { validarCuentaFaregas } = require('./faregas-cuenta-bancaria.service');
const { esGratuidadTallerAutorizada, esFlujoTaller } = require('./faregas-gratuidad-taller.policy');
const {
    redondear,
    obtenerTarifaConfigurada,
    normalizarPagos,
    construirSnapshotProducto,
    esProductoFiscalChipValido
} = require('./faregas-pagos.rules');

const obtenerCertificado = async (queryable, certificadoId, userContext, bloquear = false) => {
    const result = await queryable.query(
        `SELECT c.id, c.estado, c.planta_key, c.tipo_certificado_clave, c.tarifa_codigo, c.cliente_id,
                c.producto_facturacion_certificado_id, c.precio_certificado,
                c.producto_chip_id, c.producto_facturacion_chip_id, c.precio_chip, c.importe_total,
                s.tipo_flujo AS servicio_tipo_flujo
         FROM fg_certificado c
         LEFT JOIN fg_tarifa t ON t.planta_key = c.planta_key AND t.codigo = c.tarifa_codigo
         LEFT JOIN fg_servicio s ON s.id = t.servicio_id
         WHERE c.id = $1${bloquear ? ' FOR UPDATE OF c' : ''}`,
        [certificadoId]
    );
    if (result.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    const certificado = result.rows[0];
    const acceso = await faregasAuthService.validarAccesoPlanta(
        userContext.username,
        userContext.perfil_id,
        certificado.planta_key
    );
    if (!acceso) throw new Error('PLANTA_NO_AUTORIZADA');
    return certificado;
};

const asegurarOperacionComercial = async (client, certificado, orden, username) => {
    if (orden.operacion_id) return Number(orden.operacion_id);
    const existente = await client.query(`
        SELECT operacion_id FROM fg_operacion_detalle
        WHERE certificado_id = $1 LIMIT 1
    `, [certificado.id]);
    if (existente.rowCount > 0) {
        const operacionId = Number(existente.rows[0].operacion_id);
        await client.query('UPDATE fg_orden_pago SET operacion_id = $2 WHERE id = $1', [orden.id, operacionId]);
        orden.operacion_id = operacionId;
        return operacionId;
    }

    const tarifa = tarifasService.validarTarifaCertificacion(
        await tarifasService.obtenerTarifaOperativaPorCodigo(certificado.planta_key, certificado.tarifa_codigo, client)
    );
    const snapshot = construirSnapshotProducto(tarifa, certificado);
    const vehiculo = await client.query('SELECT placa FROM fg_certificado_vehiculo WHERE certificado_id = $1', [certificado.id]);
    
    const requiereChip = Boolean(certificado.producto_chip_id);
    let chipFiscal = requiereChip ? await client.query(`
        SELECT id, codigo_sku, descripcion, unidad, tipo_afectacion_igv,
               codigo_clasificacion_sunat, activo, es_para_venta
        FROM fg_producto_facturacion
        WHERE id = $1
    `, [certificado.producto_facturacion_chip_id]) : { rows: [] };
    let chipData = chipFiscal.rows[0] || null;

    // Un borrador todavía sin operación puede recuperar un vínculo fiscal que
    // fue corregido en la configuración después de crearlo. El precio del chip
    // permanece congelado; solo se repara el producto fiscal inválido.
    if (
        requiereChip
        && !esProductoFiscalChipValido(chipData)
        && Number(tarifa.producto_chip_id) === Number(certificado.producto_chip_id)
        && tarifa.chip_producto_facturacion_id
        && Number(tarifa.chip_producto_facturacion_id) !== Number(certificado.producto_facturacion_chip_id)
    ) {
        chipFiscal = await client.query(`
            SELECT id, codigo_sku, descripcion, unidad, tipo_afectacion_igv,
                   codigo_clasificacion_sunat, activo, es_para_venta
            FROM fg_producto_facturacion
            WHERE id = $1
        `, [tarifa.chip_producto_facturacion_id]);
        chipData = chipFiscal.rows[0] || null;
        if (esProductoFiscalChipValido(chipData)) {
            await client.query(`
                UPDATE fg_certificado
                SET producto_facturacion_chip_id = $2,
                    usuario_modificacion = $3,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $1 AND estado = 'BORRADOR'
            `, [certificado.id, chipData.id, username]);
            certificado.producto_facturacion_chip_id = chipData.id;
        }
    }
    if (requiereChip && !esProductoFiscalChipValido(chipData)) {
        const error = new Error('PRODUCTO_FISCAL_CHIP_INVALIDO');
        error.detalles = { productoChipId: Number(certificado.producto_chip_id) };
        throw error;
    }
    
    const operacion = await client.query(`
        INSERT INTO fg_operacion_comercial (
            planta_key, cliente_id, placa, moneda_key, base_imponible, igv,
            importe_total, estado, usuario_creacion
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
    `, [
        certificado.planta_key, certificado.cliente_id || null, vehiculo.rows[0]?.placa || null,
        orden.moneda_key, orden.baseimponible, orden.igv, orden.importe_total,
        orden.estado === 'PAGADO' ? 'PAGADO' : 'PENDIENTE_PAGO', username
    ]);
    const operacionId = Number(operacion.rows[0].id);

    // Detalle certificado
    const chipImporteTotal = requiereChip ? redondear(certificado.precio_chip) : 0;
    const certImporteTotal = redondear(Number(orden.importe_total) - chipImporteTotal);
    const certBase = redondear(certImporteTotal / 1.18);
    const certIgv = redondear(certImporteTotal - certBase);

    await client.query(`
        INSERT INTO fg_operacion_detalle (
            operacion_id, tipo_item, servicio_id, tarifa_id, certificado_id,
            cantidad, codigo_sku_snapshot, descripcion_snapshot, unidad_snapshot,
            afectacion_igv_snapshot, codigo_sunat_snapshot, producto_facturacion_id,
            valor_unitario, precio_unitario,
            base_imponible, igv, importe_total, genera_certificado_snapshot, orden
        ) VALUES ($1,'SERVICIO',$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,$12,$11,$13,$12,TRUE,1)
    `, [
        operacionId, tarifa.servicio_id, tarifa.id, certificado.id,
        snapshot.codigoSku, snapshot.descripcion, snapshot.unidad,
        snapshot.afectacionIgv, snapshot.codigoSunat,
        certificado.producto_facturacion_certificado_id || snapshot.productoFacturacionId,
        certBase, certImporteTotal, certIgv
    ]);

    // Detalle chip
    if (requiereChip) {
        const chipPrecio = chipImporteTotal;
        const chipBase = redondear(chipPrecio / 1.18);
        const chipIgv = redondear(chipPrecio - chipBase);

        await client.query(`
            INSERT INTO fg_operacion_detalle (
                operacion_id, tipo_item, cantidad, codigo_sku_snapshot, descripcion_snapshot,
                unidad_snapshot, afectacion_igv_snapshot, codigo_sunat_snapshot,
                producto_facturacion_id, valor_unitario, precio_unitario, base_imponible, igv,
                importe_total, genera_certificado_snapshot, orden
            ) VALUES ($1,'PRODUCTO',1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,$9,FALSE,2)
        `, [
            operacionId, chipData.codigo_sku, chipData.descripcion, chipData.unidad,
            chipData.tipo_afectacion_igv, chipData.codigo_clasificacion_sunat, chipData.id,
            chipBase, chipPrecio, chipIgv
        ]);
    }

    await client.query('UPDATE fg_orden_pago SET operacion_id = $2 WHERE id = $1', [orden.id, operacionId]);
    orden.operacion_id = operacionId;
    return operacionId;
};

const validarReferenciaPago = async (client, pago) => {
    if (pago.tipo === 'tarjeta') {
        if (!pago.tarjetaKey || !pago.nroOperacion) throw new Error('DATOS_TARJETA_INCOMPLETOS');
        const tarjeta = await client.query('SELECT nombre FROM tarjeta WHERE key = $1', [pago.tarjetaKey]);
        if (tarjeta.rowCount === 0) throw new Error('TARJETA_NOT_FOUND');
        const nombre = String(tarjeta.rows[0].nombre || '').toUpperCase();
        const esMedioAlternativo = nombre.includes('CUPONIDAD') || nombre.includes('YAPE') || nombre.includes('PLIN');
        if (!esMedioAlternativo && !['DEBITO', 'CREDITO'].includes(String(pago.modalidadTarjeta || '').toUpperCase())) {
            throw new Error('MODALIDAD_TARJETA_REQUERIDA');
        }
        if (nombre.includes('CUPONIDAD') && String(pago.nroOperacion).trim().length !== 10) {
            throw new Error('OPERACION_CUPONIDAD_INVALIDA');
        }
        if ((nombre.includes('YAPE') || nombre.includes('PLIN')) && !/^\d{4,10}$/.test(String(pago.nroOperacion).trim())) {
            throw new Error('OPERACION_BILLETERA_INVALIDA');
        }
    }

    if (pago.tipo === 'banco') {
        if (!pago.entidadFinancieraKey || !pago.cuentaCorrienteKey || !pago.nroOperacion || !pago.fechaDeposito) {
            throw new Error('DATOS_BANCO_INCOMPLETOS');
        }
        await validarCuentaFaregas(client, pago.cuentaCorrienteKey, pago.entidadFinancieraKey);
        const fechaDeposito = new Date(`${String(pago.fechaDeposito).slice(0, 10)}T00:00:00`);
        if (Number.isNaN(fechaDeposito.getTime())) throw new Error('FECHA_DEPOSITO_INVALIDA');
        const hoy = new Date();
        hoy.setHours(23, 59, 59, 999);
        if (fechaDeposito > hoy) throw new Error('FECHA_DEPOSITO_FUTURA');
    }
};

const esFechaIsoValida = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const [anio, mes, dia] = String(value).split('-').map(Number);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
};

const normalizarPeriodoCredito = (data = {}) => {
    const condicionPago = String(data.condicionPago || 'CONTADO').trim().toUpperCase();
    if (!['CONTADO', 'CREDITO'].includes(condicionPago)) throw new Error('CONDICION_PAGO_INVALIDA');
    if (condicionPago === 'CONTADO') {
        return { condicionPago, fechaInicioCredito: null, fechaVencimientoCredito: null };
    }
    const fechaInicioCredito = String(data.fechaInicioCredito || '').slice(0, 10);
    const fechaVencimientoCredito = String(data.fechaVencimientoCredito || '').slice(0, 10);
    if (!esFechaIsoValida(fechaInicioCredito)) throw new Error('FECHA_INICIO_CREDITO_INVALIDA');
    if (!esFechaIsoValida(fechaVencimientoCredito)) throw new Error('FECHA_VENCIMIENTO_CREDITO_INVALIDA');
    if (fechaVencimientoCredito < fechaInicioCredito) throw new Error('PERIODO_CREDITO_INVALIDO');
    return { condicionPago, fechaInicioCredito, fechaVencimientoCredito };
};

const firmaPagoTarjeta = (pago) => [
    String(pago.tarjetaKey || pago.tarjeta_key || ''),
    String(pago.nroOperacion || pago.nrooperaciontarjeta || '').trim(),
    Number(pago.importe || 0).toFixed(2)
].join('|');

const obtenerDigitosHistoricos = async (client, ordenId) => {
    const result = await client.query(`
        SELECT tarjeta_key, nrooperaciontarjeta, importe, digitotarjeta
        FROM fg_pago
        WHERE orden_pago_id = $1 AND digitotarjeta IS NOT NULL
        ORDER BY id
    `, [ordenId]);
    const porFirma = new Map();
    for (const row of result.rows) {
        const firma = firmaPagoTarjeta(row);
        const valores = porFirma.get(firma) || [];
        valores.push(row.digitotarjeta);
        porFirma.set(firma, valores);
    }
    return porFirma;
};

const tomarDigitosHistoricos = (porFirma, pago) => {
    const valores = porFirma.get(firmaPagoTarjeta(pago));
    return valores?.shift() || null;
};

exports.guardarPagosOperacion = async (operacionId, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const operacionResult = await client.query('SELECT * FROM fg_operacion_comercial WHERE id = $1 FOR UPDATE', [operacionId]);
        if (!operacionResult.rowCount) throw new Error('OPERACION_NOT_FOUND');
        const operacion = operacionResult.rows[0];

        if (!['BORRADOR', 'PENDIENTE_PAGO'].includes(operacion.estado)) throw new Error('OPERACION_NO_EDITABLE');

        const importeSolicitado = redondear(data.importeTotal);
        if (!Number.isFinite(importeSolicitado) || importeSolicitado < 0) throw new Error('IMPORTE_TOTAL_INVALIDO');
        
        if (Math.abs(Number(operacion.importe_total) - importeSolicitado) > 0.009) throw new Error('IMPORTE_NO_COINCIDE');

        const pagos = normalizarPagos(data.pagos);
        const periodoCredito = normalizarPeriodoCredito(data);
        for (const pago of pagos) await validarReferenciaPago(client, pago);

        let ordenResult = await client.query(
            'SELECT * FROM fg_orden_pago WHERE operacion_id = $1 FOR UPDATE',
            [operacionId]
        );
        let orden;
        if (ordenResult.rowCount === 0) {
            const base = redondear(importeSolicitado / 1.18);
            const igv = redondear(importeSolicitado - base);
            ordenResult = await client.query(`
                INSERT INTO fg_orden_pago (
                    operacion_id, importe_total, baseimponible, igv, importe_pagado,
                    saldo_pendiente, moneda_key, formapago_key, estado, usuariocreacion_username
                ) VALUES ($1, $2, $3, $4, 0, $2, 'sol', 'contado', 'PENDIENTE', $5)
                RETURNING *
            `, [operacionId, importeSolicitado, base, igv, userContext.username]);
            orden = ordenResult.rows[0];
        } else {
            orden = ordenResult.rows[0];
        }

        const totalPagado = redondear(pagos.reduce((total, pago) => total + pago.importe, 0));
        if (totalPagado - Number(orden.importe_total) > 0.009) throw new Error('PAGO_EXCEDE_TOTAL');

        const digitosHistoricos = await obtenerDigitosHistoricos(client, orden.id);
        await client.query('DELETE FROM fg_pago WHERE orden_pago_id = $1', [orden.id]);
        for (const pago of pagos) {
            const base = redondear(pago.importe / 1.18);
            const igv = redondear(pago.importe - base);
            await client.query(`
                INSERT INTO fg_pago (
                    baseimponible, digitotarjeta, estado, fechacreacion, fechdeposito,
                    igv, importe, nrooperacionbanco, nrooperaciontarjeta, sendedtooffisis,
                    orden_pago_id, cuentacorriente_key, entidadfinanciera_key, moneda_key,
                    tarjeta_key, tipocontado_key, modalidad_tarjeta
                ) VALUES (
                    $1, $2, 'CAN', CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, false,
                    $8, $9, $10, 'sol', $11, $12, $13
                )
            `, [
                base,
                pago.tipo === 'tarjeta' ? tomarDigitosHistoricos(digitosHistoricos, pago) : null,
                pago.tipo === 'banco' ? pago.fechaDeposito : null,
                igv,
                pago.importe,
                pago.tipo === 'banco' ? String(pago.nroOperacion).trim() : null,
                pago.tipo === 'tarjeta' ? String(pago.nroOperacion).trim() : null,
                orden.id,
                pago.tipo === 'banco' ? pago.cuentaCorrienteKey : null,
                pago.tipo === 'banco' ? pago.entidadFinancieraKey : null,
                pago.tipo === 'tarjeta' ? pago.tarjetaKey : null,
                pago.tipo,
                pago.tipo === 'tarjeta' ? pago.modalidadTarjeta : null
            ]);
        }

        const saldo = redondear(Number(orden.importe_total) - totalPagado);
        const estado = saldo === 0 ? 'PAGADO' : 'PENDIENTE';
        const ordenActualizada = await client.query(`
            UPDATE fg_orden_pago
            SET importe_pagado = $2, saldo_pendiente = $3, estado = $4,
                formapago_key = $5, fecha_inicio_credito = $6,
                fecha_vencimiento_credito = $7,
                fechmodi = CURRENT_TIMESTAMP, usuariomodi_username = $8
            WHERE id = $1
            RETURNING *
        `, [
            orden.id, totalPagado, saldo, estado,
            periodoCredito.condicionPago === 'CREDITO' ? 'credito' : 'contado',
            periodoCredito.fechaInicioCredito, periodoCredito.fechaVencimientoCredito,
            userContext.username
        ]);
        
        await client.query(`
            UPDATE fg_operacion_comercial
            SET estado = $2, usuario_modificacion = $3, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [operacionId, estado === 'PAGADO' ? 'PAGADO' : 'PENDIENTE_PAGO', userContext.username]);

        const pagosGuardados = await exports.listarPagosPorOrden(orden.id, client);
        await client.query('COMMIT');
        return { orden: ordenActualizada.rows[0], pagos: pagosGuardados };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const obtenerResumenComercial = async (queryable, certificado) => {
    const descuento = await descuentosService.obtenerResumenDescuentoCertificado(queryable, certificado);
    const precioCertificado = certificado.precio_certificado === null || certificado.precio_certificado === undefined
        ? Number(descuento.tarifaOriginal || 0)
        : Number(certificado.precio_certificado);
    const descuentoCertificado = redondear(Math.max(0, precioCertificado - Number(descuento.totalFinal || 0)));
    const certificadoNeto = redondear(precioCertificado - descuentoCertificado);
    const precioChip = certificado.producto_chip_id ? redondear(certificado.precio_chip || 0) : 0;
    return {
        precioCertificado: redondear(precioCertificado),
        descuentoCertificado,
        certificadoNeto,
        requiereChip: Boolean(certificado.producto_chip_id),
        productoChipId: certificado.producto_chip_id ? Number(certificado.producto_chip_id) : null,
        precioChip,
        importeTotal: redondear(certificadoNeto + precioChip)
    };
};

exports.guardarPagos = async (certificadoId, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const certificado = await obtenerCertificado(client, certificadoId, userContext, true);
        if (certificado.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        const importeSolicitado = redondear(data.importeTotal);
        if (!Number.isFinite(importeSolicitado) || importeSolicitado < 0) throw new Error('IMPORTE_TOTAL_INVALIDO');
        const pagos = normalizarPagos(data.pagos);
        const periodoCredito = normalizarPeriodoCredito(data);

        // La cortesía debe existir como reserva persistida antes de validar el pago cero.
        const reservaDescuento = await client.query(`
            SELECT cmp.*,
                   COALESCE(
                       dc.codigo,
                       CASE WHEN d.id = 17 OR UPPER(BTRIM(d.codigo)) = 'D_CONVENIO_A88137BB742F4157' OR EXISTS (
                           SELECT 1
                           FROM fg_descuentocliente dcp
                           WHERE dcp.descuento_id = d.id
                             AND UPPER(BTRIM(dcp.codigo)) IN ('CORTESIA_FAREGAS', 'DESCUENTO_TALLER')
                       ) THEN 'CORTESIA_FAREGAS' END,
                       d.codigo
                   ) AS codigo_autorizacion,
                   d.nombre AS descuento_nombre
            FROM fg_descuentocomprobante cmp
            LEFT JOIN fg_descuentocliente dc ON dc.id = cmp.descuento_cliente_id
            LEFT JOIN fg_descuento d ON d.id = COALESCE(cmp.descuento_id, dc.descuento_id)
            WHERE cmp.certificado_id = $1 AND cmp.estado IN ('RESERVADO', 'APLICADO')
            ORDER BY cmp.id DESC LIMIT 1
        `, [certificadoId]);
        const reserva = reservaDescuento.rows[0] || null;
        if (reserva && Number(reserva.descuento_id) === 17 && !reserva.descuento_cliente_id) {
            try {
                await client.query(`
                    UPDATE fg_descuentocomprobante
                    SET descuento_cliente_id = 30
                    WHERE id = $1 AND descuento_cliente_id IS NULL
                `, [reserva.id]);
                reserva.descuento_cliente_id = 30;
            } catch (_) {}
        }
        const esCortesia = esGratuidadTallerAutorizada({ reserva });

        if (esCortesia) {
            if (pagos.length > 0) throw new Error('CORTESIA_NO_ADMITE_PAGOS');
            if (periodoCredito.condicionPago === 'CREDITO') throw new Error('CORTESIA_NO_ADMITE_CREDITO');
            if (importeSolicitado !== 0) throw new Error('CORTESIA_IMPORTE_DEBE_SER_CERO');
        } else if (importeSolicitado === 0) {
            throw new Error('OPERACION_CERO_REQUIERE_AUTORIZACION_GRATUITA');
        }

        for (const pago of pagos) await validarReferenciaPago(client, pago);

        let ordenResult = await client.query(
            'SELECT * FROM fg_orden_pago WHERE certificado_id = $1 FOR UPDATE',
            [certificadoId]
        );
        let orden;
        if (ordenResult.rowCount === 0) {
            // INTEGRACION DESCUENTOS: Obtenemos el resumen del descuento, que nos da el importeFinal
            const resumenComercial = await obtenerResumenComercial(client, certificado);
            
            if (!resumenComercial.precioCertificado && !certificado.tarifa_codigo) {
                throw new Error('TARIFA_REQUERIDA');
            }

            const tarifaConfigurada = resumenComercial.importeTotal;

            if (Math.abs(tarifaConfigurada - importeSolicitado) > 0.009) throw new Error('TARIFA_NO_COINCIDE');
            const base = redondear(importeSolicitado / 1.18);
            const igv = redondear(importeSolicitado - base);
            const estadoInicial = esCortesia ? 'PAGADO' : 'PENDIENTE';
            const saldoInicial = esCortesia ? 0 : importeSolicitado;
            ordenResult = await client.query(`
                INSERT INTO fg_orden_pago (
                    certificado_id, importe_total, baseimponible, igv, importe_pagado,
                    saldo_pendiente, moneda_key, formapago_key, estado, usuariocreacion_username
                ) VALUES ($1, $2, $3, $4, 0, $5, 'sol', 'contado', $6, $7)
                RETURNING *
            `, [certificadoId, importeSolicitado, base, igv, saldoInicial, estadoInicial, userContext.username]);
            orden = ordenResult.rows[0];
        } else {
            orden = ordenResult.rows[0];
            if (Math.abs(Number(orden.importe_total) - importeSolicitado) > 0.009) {
                throw new Error('IMPORTE_ORDEN_NO_MODIFICABLE');
            }
        }

        const operacionId = await asegurarOperacionComercial(client, certificado, orden, userContext.username);

        await client.query(`UPDATE fg_descuentocomprobante
            SET orden_pago_id=$2,
                reservado_hasta=GREATEST(reservado_hasta, CURRENT_TIMESTAMP + INTERVAL '30 days'),
                usuario_modificacion=$3, fecha_modificacion=CURRENT_TIMESTAMP
            WHERE certificado_id=$1 AND estado='RESERVADO'`,
        [certificadoId, orden.id, userContext.username]);

        // Evaluación de SPOT Detracciones para cobro ordinario en caja
        let tipoComprobante = String(data.tipoComprobante || '').toUpperCase().trim();
        if (!tipoComprobante) {
            const rFac = await client.query('SELECT tipo_comprobante FROM fg_facturacion WHERE certificado_id = $1 LIMIT 1', [certificadoId]);
            if (rFac.rowCount > 0 && rFac.rows[0].tipo_comprobante) {
                tipoComprobante = String(rFac.rows[0].tipo_comprobante).toUpperCase().trim();
            }
        }
        const { evaluarDetraccion } = require('./faregas-detracciones.service');
        const evaluacionSpot = evaluarDetraccion({
            tipoComprobante,
            importeTotal: Number(orden.importe_total),
            moneda: 'PEN',
            items: [],
            esGratuito: esCortesia
        });
        const totalExigibleCaja = esCortesia ? 0 : (evaluacionSpot.sujeto ? evaluacionSpot.neto : Number(orden.importe_total));

        const totalPagado = redondear(pagos.reduce((total, pago) => total + pago.importe, 0));
        if (totalPagado - totalExigibleCaja > 0.009) throw new Error('PAGO_EXCEDE_TOTAL');

        const digitosHistoricos = await obtenerDigitosHistoricos(client, orden.id);
        await client.query('DELETE FROM fg_pago WHERE orden_pago_id = $1', [orden.id]);
        for (const pago of pagos) {
            const base = redondear(pago.importe / 1.18);
            const igv = redondear(pago.importe - base);
            await client.query(`
                INSERT INTO fg_pago (
                    baseimponible, digitotarjeta, estado, fechacreacion, fechdeposito,
                    igv, importe, nrooperacionbanco, nrooperaciontarjeta, sendedtooffisis,
                    orden_pago_id, cuentacorriente_key, entidadfinanciera_key, moneda_key,
                    tarjeta_key, tipocontado_key, modalidad_tarjeta
                ) VALUES (
                    $1, $2, 'CAN', CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, false,
                    $8, $9, $10, 'sol', $11, $12, $13
                )
            `, [
                base,
                pago.tipo === 'tarjeta' ? tomarDigitosHistoricos(digitosHistoricos, pago) : null,
                pago.tipo === 'banco' ? pago.fechaDeposito : null,
                igv,
                pago.importe,
                pago.tipo === 'banco' ? String(pago.nroOperacion).trim() : null,
                pago.tipo === 'tarjeta' ? String(pago.nroOperacion).trim() : null,
                orden.id,
                pago.tipo === 'banco' ? pago.cuentaCorrienteKey : null,
                pago.tipo === 'banco' ? pago.entidadFinancieraKey : null,
                pago.tipo === 'tarjeta' ? pago.tarjetaKey : null,
                pago.tipo,
                pago.tipo === 'tarjeta' ? pago.modalidadTarjeta : null
            ]);
        }

        const saldo = esCortesia ? 0 : redondear(Math.max(0, totalExigibleCaja - totalPagado));
        const estado = esCortesia || saldo === 0 ? 'PAGADO' : 'PENDIENTE';
        const ordenActualizada = await client.query(`
            UPDATE fg_orden_pago
            SET importe_pagado = $2, saldo_pendiente = $3, estado = $4,
                formapago_key = $5, fecha_inicio_credito = $6,
                fecha_vencimiento_credito = $7,
                fechmodi = CURRENT_TIMESTAMP, usuariomodi_username = $8
            WHERE id = $1
            RETURNING *
        `, [
            orden.id, totalPagado, saldo, estado,
            periodoCredito.condicionPago === 'CREDITO' ? 'credito' : 'contado',
            periodoCredito.fechaInicioCredito, periodoCredito.fechaVencimientoCredito,
            userContext.username
        ]);
        await client.query(`
            UPDATE fg_operacion_comercial
            SET estado = $2, usuario_modificacion = $3, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [operacionId, estado === 'PAGADO' ? 'PAGADO' : 'PENDIENTE_PAGO', userContext.username]);

        // INTEGRACION DESCUENTOS: Consumir el descuento
        if (estado === 'PAGADO') {
            await descuentosService.consumirDescuentoSiExiste(client, certificadoId, orden.id, userContext);
        }

        const pagosGuardados = await exports.listarPagosPorOrden(orden.id, client);
        await client.query('COMMIT');
        return {
            orden: ordenActualizada.rows[0],
            pagos: pagosGuardados,
            resumenComercial: await obtenerResumenComercial(client, certificado)
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.listarPagosPorOrden = async (ordenId, queryable = db) => {
    const result = await queryable.query(`
        SELECT id, importe, baseimponible, igv, estado, fechacreacion, fechdeposito,
               tipocontado_key AS "tipoContadoKey", tarjeta_key AS "tarjetaKey",
               modalidad_tarjeta AS "modalidadTarjeta",
               nrooperacionbanco AS "nroOperacionBanco",
               nrooperaciontarjeta AS "nroOperacionTarjeta",
               digitotarjeta AS "digitosTarjeta",
               cuentacorriente_key AS "cuentaCorrienteKey",
               entidadfinanciera_key AS "entidadFinancieraKey",
               moneda_key AS "monedaKey", sendedtooffisis AS "enviadoOfisis"
        FROM fg_pago WHERE orden_pago_id = $1 ORDER BY id
    `, [ordenId]);
    return result.rows;
};

exports.obtenerPagosOperacion = async (operacionId, userContext) => {
    const operacionResult = await db.query('SELECT * FROM fg_operacion_comercial WHERE id = $1', [operacionId]);
    if (!operacionResult.rowCount) throw new Error('OPERACION_NOT_FOUND');
    
    const ordenResult = await db.query('SELECT * FROM fg_orden_pago WHERE operacion_id = $1', [operacionId]);
    if (ordenResult.rowCount === 0) {
        return { orden: null, pagos: [], importeTotal: Number(operacionResult.rows[0].importe_total) };
    }
    const orden = ordenResult.rows[0];
    return { orden, pagos: await exports.listarPagosPorOrden(orden.id), importeTotal: Number(orden.importe_total) };
};

exports.obtenerPagos = async (certificadoId, userContext) => {
    const certificado = await obtenerCertificado(db, certificadoId, userContext);
    const ordenResult = await db.query('SELECT * FROM fg_orden_pago WHERE certificado_id = $1', [certificadoId]);
    if (ordenResult.rowCount === 0) {
        const resumenComercial = await obtenerResumenComercial(db, certificado);
        return {
            orden: null,
            pagos: [],
            importeTotal: resumenComercial.precioCertificado || certificado.tarifa_codigo
                ? resumenComercial.importeTotal
                : null,
            condicionPago: 'CONTADO',
            fechaInicioCredito: null,
            fechaVencimientoCredito: null,
            resumenComercial
        };
    }
    const orden = ordenResult.rows[0];
    return {
        orden,
        pagos: await exports.listarPagosPorOrden(orden.id),
        importeTotal: Number(orden.importe_total),
        condicionPago: String(orden.formapago_key || '').toLowerCase() === 'credito' ? 'CREDITO' : 'CONTADO',
        fechaInicioCredito: orden.fecha_inicio_credito || null,
        fechaVencimientoCredito: orden.fecha_vencimiento_credito || null,
        resumenComercial: await obtenerResumenComercial(db, certificado)
    };
};

exports._private = {
    obtenerResumenComercial,
    asegurarOperacionComercial,
    validarReferenciaPago,
    normalizarPeriodoCredito,
    firmaPagoTarjeta
};
