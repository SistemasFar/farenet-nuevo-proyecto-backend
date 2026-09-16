const db = require('../../../config/database');
const faregasAuthService = require('./faregas-auth.service');
const tarifasService = require('./faregas-tarifas.service');
const descuentosService = require('./faregas-descuentos.service');
const {
    redondear,
    obtenerTarifaConfigurada,
    normalizarPagos,
    construirSnapshotProducto,
    esProductoFiscalChipValido
} = require('./faregas-pagos.rules');

const obtenerCertificado = async (queryable, certificadoId, userContext, bloquear = false) => {
    const result = await queryable.query(
        `SELECT id, estado, planta_key, tipo_certificado_clave, tarifa_codigo, cliente_id,
                producto_facturacion_certificado_id, precio_certificado,
                producto_chip_id, producto_facturacion_chip_id, precio_chip, importe_total
         FROM fg_certificado WHERE id = $1${bloquear ? ' FOR UPDATE' : ''}`,
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
        const sinDigitos = ['CUPONIDAD', 'PAGO WEB', 'YAPE', 'PLIN'].some(tipo => nombre.includes(tipo));
        if (!sinDigitos && !/^\d{4}$/.test(String(pago.digitosTarjeta || ''))) {
            throw new Error('DIGITOS_TARJETA_INVALIDOS');
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
        const cuenta = await client.query(
            'SELECT 1 FROM cuentacorriente WHERE key = $1 AND entidadfinanciera_key = $2',
            [pago.cuentaCorrienteKey, pago.entidadFinancieraKey]
        );
        if (cuenta.rowCount === 0) throw new Error('CUENTA_BANCARIA_INVALIDA');
        const fechaDeposito = new Date(`${String(pago.fechaDeposito).slice(0, 10)}T00:00:00`);
        if (Number.isNaN(fechaDeposito.getTime())) throw new Error('FECHA_DEPOSITO_INVALIDA');
        const hoy = new Date();
        hoy.setHours(23, 59, 59, 999);
        if (fechaDeposito > hoy) throw new Error('FECHA_DEPOSITO_FUTURA');
    }
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

        await client.query('DELETE FROM fg_pago WHERE orden_pago_id = $1', [orden.id]);
        for (const pago of pagos) {
            const base = redondear(pago.importe / 1.18);
            const igv = redondear(pago.importe - base);
            await client.query(`
                INSERT INTO fg_pago (
                    baseimponible, digitotarjeta, estado, fechacreacion, fechdeposito,
                    igv, importe, nrooperacionbanco, nrooperaciontarjeta, sendedtooffisis,
                    orden_pago_id, cuentacorriente_key, entidadfinanciera_key, moneda_key,
                    tarjeta_key, tipocontado_key
                ) VALUES (
                    $1, $2, 'CAN', CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, false,
                    $8, $9, $10, 'sol', $11, $12
                )
            `, [
                base,
                pago.tipo === 'tarjeta' ? pago.digitosTarjeta || null : null,
                pago.tipo === 'banco' ? pago.fechaDeposito : null,
                igv,
                pago.importe,
                pago.tipo === 'banco' ? String(pago.nroOperacion).trim() : null,
                pago.tipo === 'tarjeta' ? String(pago.nroOperacion).trim() : null,
                orden.id,
                pago.tipo === 'banco' ? pago.cuentaCorrienteKey : null,
                pago.tipo === 'banco' ? pago.entidadFinancieraKey : null,
                pago.tipo === 'tarjeta' ? pago.tarjetaKey : null,
                pago.tipo
            ]);
        }

        const saldo = redondear(Number(orden.importe_total) - totalPagado);
        const estado = saldo === 0 ? 'PAGADO' : 'PENDIENTE';
        const ordenActualizada = await client.query(`
            UPDATE fg_orden_pago
            SET importe_pagado = $2, saldo_pendiente = $3, estado = $4,
                fechmodi = CURRENT_TIMESTAMP, usuariomodi_username = $5
            WHERE id = $1
            RETURNING *
        `, [orden.id, totalPagado, saldo, estado, userContext.username]);
        
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
            ordenResult = await client.query(`
                INSERT INTO fg_orden_pago (
                    certificado_id, importe_total, baseimponible, igv, importe_pagado,
                    saldo_pendiente, moneda_key, formapago_key, estado, usuariocreacion_username
                ) VALUES ($1, $2, $3, $4, 0, $2, 'sol', 'contado', 'PENDIENTE', $5)
                RETURNING *
            `, [certificadoId, importeSolicitado, base, igv, userContext.username]);
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

        const totalPagado = redondear(pagos.reduce((total, pago) => total + pago.importe, 0));
        if (totalPagado - Number(orden.importe_total) > 0.009) throw new Error('PAGO_EXCEDE_TOTAL');

        await client.query('DELETE FROM fg_pago WHERE orden_pago_id = $1', [orden.id]);
        for (const pago of pagos) {
            const base = redondear(pago.importe / 1.18);
            const igv = redondear(pago.importe - base);
            await client.query(`
                INSERT INTO fg_pago (
                    baseimponible, digitotarjeta, estado, fechacreacion, fechdeposito,
                    igv, importe, nrooperacionbanco, nrooperaciontarjeta, sendedtooffisis,
                    orden_pago_id, cuentacorriente_key, entidadfinanciera_key, moneda_key,
                    tarjeta_key, tipocontado_key
                ) VALUES (
                    $1, $2, 'CAN', CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, false,
                    $8, $9, $10, 'sol', $11, $12
                )
            `, [
                base,
                pago.tipo === 'tarjeta' ? pago.digitosTarjeta || null : null,
                pago.tipo === 'banco' ? pago.fechaDeposito : null,
                igv,
                pago.importe,
                pago.tipo === 'banco' ? String(pago.nroOperacion).trim() : null,
                pago.tipo === 'tarjeta' ? String(pago.nroOperacion).trim() : null,
                orden.id,
                pago.tipo === 'banco' ? pago.cuentaCorrienteKey : null,
                pago.tipo === 'banco' ? pago.entidadFinancieraKey : null,
                pago.tipo === 'tarjeta' ? pago.tarjetaKey : null,
                pago.tipo
            ]);
        }

        const saldo = redondear(Number(orden.importe_total) - totalPagado);
        const estado = saldo === 0 ? 'PAGADO' : 'PENDIENTE';
        const ordenActualizada = await client.query(`
            UPDATE fg_orden_pago
            SET importe_pagado = $2, saldo_pendiente = $3, estado = $4,
                fechmodi = CURRENT_TIMESTAMP, usuariomodi_username = $5
            WHERE id = $1
            RETURNING *
        `, [orden.id, totalPagado, saldo, estado, userContext.username]);
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
            resumenComercial
        };
    }
    const orden = ordenResult.rows[0];
    return {
        orden,
        pagos: await exports.listarPagosPorOrden(orden.id),
        importeTotal: Number(orden.importe_total),
        resumenComercial: await obtenerResumenComercial(db, certificado)
    };
};

exports._private = {
    obtenerResumenComercial,
    asegurarOperacionComercial
};
