const db = require('../../../config/database');
const nubefactAdapter = require('../integrations/nubefact-faregas.adapter');
const nubefactService = require('../../../services/integrations/nubefact.service');

const crearVenta = async (payload, userContext) => {
    const {
        plantaKey,
        tipoComprobante, // FACTURA o BOLETA
        tipoDocumentoCliente, // RUC, DNI
        nroDocumento,
        nombreRazonSocial,
        direccion,
        email,
        telefono,
        condicionPago, // CONTADO o CREDITO
        medioPago, // EFECTIVO, YAPE, etc (legacy o unico)
        pagosAgregados = [], // [{ tipo, importe, tarjetaKey, nroOperacion, digitosTarjeta, entidadFinancieraKey, cuentaCorrienteKey, fechaDeposito }]
        chips // array de string (números de chip)
    } = payload;

    if (!chips || chips.length === 0) {
        throw new Error('CHIPS_REQUERIDOS');
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Validar chips y obtener precios
        const chipsPlaceholders = chips.map((_, i) => `$${i + 1}`).join(',');
        const queryChips = `
            SELECT c.id, c.numero_chip, c.estado, c.producto_inventariable_id,
                   pi.codigo as producto_codigo, pi.nombre as producto_nombre,
                   pis.precio
            FROM fg_chip c
            JOIN fg_producto_inventariable pi ON c.producto_inventariable_id = pi.id
            JOIN fg_producto_inventariable_sede pis ON pi.id = pis.producto_inventariable_id AND pis.planta_key = $${chips.length + 1}
            WHERE c.numero_chip IN (${chipsPlaceholders})
        `;
        const resultChips = await client.query(queryChips, [...chips, plantaKey]);

        if (resultChips.rowCount !== chips.length) {
            throw new Error('CHIPS_NO_ENCONTRADOS_O_PRECIO_NO_CONFIGURADO');
        }

        let baseImponible = 0;
        let igv = 0;
        let importeTotal = 0;
        const detalles = [];

        for (const c of resultChips.rows) {
            if (c.estado !== 'DISPONIBLE') {
                const e=new Error('CHIP_NO_DISPONIBLE'); e.detalles={ chip: c.numero_chip, estado: c.estado }; throw e;
            }
            const precio = Number(c.precio);
            const base = precio / 1.18;
            const impuesto = precio - base;

            importeTotal += precio;
            baseImponible += base;
            igv += impuesto;

            detalles.push({
                chip_id: c.id,
                producto_inventariable_id: c.producto_inventariable_id,
                precio_unitario: precio,
                cantidad: 1,
                total: precio,
                producto_codigo: c.producto_codigo,
                producto_nombre: c.producto_nombre
            });
        }

        const totalPagado = pagosAgregados.reduce((sum, p) => sum + Number(p.importe), 0);
        const formapago_key = pagosAgregados.length > 0 ? pagosAgregados[0].tipo : (medioPago || 'EFECTIVO');
        const estadoPago = (condicionPago === 'CREDITO' || totalPagado < importeTotal) ? 'CREDITO' : 'CANCELADO';

        // 2. Crear Venta
        const ventaResult = await client.query(
            `INSERT INTO fg_venta (
                planta_key, cliente_tipo_documento, cliente_nro_documento, cliente_nombre,
                cliente_direccion, cliente_email, base_imponible, igv, importe_total,
                estado, creado_por
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'COMPLETADO', $10) RETURNING id`,
            [
                plantaKey, tipoDocumentoCliente, nroDocumento, nombreRazonSocial,
                direccion, email, baseImponible, igv, importeTotal, userContext.username
            ]
        );
        const ventaId = ventaResult.rows[0].id;

        // 3. Insertar Detalles de la Venta
        for (const det of detalles) {
            await client.query(
                `INSERT INTO fg_venta_detalle (
                    venta_id, chip_id, producto_inventariable_id, precio_unitario, cantidad, total
                ) VALUES ($1, $2, $3, $4, $5, $6)`,
                [ventaId, det.chip_id, det.producto_inventariable_id, det.precio_unitario, det.cantidad, det.total]
            );
        }

        // 4. Cambiar estado de Chips a VENDIDO
        for (const det of detalles) {
            await client.query(
                `UPDATE fg_chip SET estado = 'VENDIDO', actualizado_en = CURRENT_TIMESTAMP, actualizado_por = $2 WHERE id = $1`,
                [det.chip_id, userContext.username]
            );
            await client.query(
                `INSERT INTO fg_chip_movimiento (
                    chip_id, tipo_movimiento, operacion_comercial_id, usuario, detalles, referencia
                ) VALUES ($1, 'VENTA', $2, $3, $4, $5)`,
                [
                    det.chip_id, ventaId, userContext.username,
                    JSON.stringify({ estado_anterior: 'DISPONIBLE', estado_nuevo: 'VENDIDO', precio: det.total }),
                    `Venta Directa #${ventaId}`
                ]
            );
        }

        // 5. Crear Orden de Pago (Caja)
        const ordenPagoRes = await client.query(
            `INSERT INTO fg_orden_pago (
                venta_id, importe_total, baseimponible, igv, importe_pagado, saldo_pendiente,
                fechacreacion, usuariocreacion_username, moneda_key, formapago_key, estado
            ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, 'PEN', $8, $9) RETURNING id`,
            [ventaId, importeTotal, baseImponible, igv, totalPagado, importeTotal - totalPagado, userContext.username, formapago_key, estadoPago]
        );
        const ordenPagoId = ordenPagoRes.rows[0].id;

        // 6. Insertar Movimientos de Pago (fg_orden_pago_movimiento)
        for (const pago of pagosAgregados) {
            await client.query(
                `INSERT INTO fg_orden_pago_movimiento (
                    orden_pago_id, medio_pago, monto, nro_operacion,
                    tarjeta_key, digitos_tarjeta, entidad_financiera_key, cuenta_corriente_key,
                    fecha_deposito, usuariocreacion_username
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    ordenPagoId, pago.tipo, pago.importe, pago.nroOperacion || null,
                    pago.tarjetaKey || null, pago.digitosTarjeta || null, pago.entidadFinancieraKey || null,
                    pago.cuentaCorrienteKey || null, pago.fechaDeposito || null, userContext.username
                ]
            );
        }

        // Si es a credito y no pasaron cuotas, creamos una cuota automática (adaptación simple para Venta)
        const cuotas = [];
        if (condicionPago === 'CREDITO') {
            cuotas.push({ numero_cuota: 1, fecha_pago: new Date().toISOString(), importe: importeTotal - totalPagado });
        }

        // 7. Facturacion
        const resSerie = await client.query(
            `SELECT ts.id, ts.serie, ts.numero_actual 
             FROM fg_talonario_serie ts
             WHERE ts.planta_key = $1 AND ts.tipo_comprobante = $2 AND ts.entorno = $3 AND ts.estado = 'ACTIVO'
             ORDER BY ts.id LIMIT 1 FOR UPDATE`,
            [plantaKey, tipoComprobante, process.env.NUBEFACT_ENTORNO || 'DEMO']
        );
        if (resSerie.rowCount === 0) throw new Error('SERIE_NO_CONFIGURADA');

        const serie = resSerie.rows[0].serie;
        let numeroCorrelativo = Number(resSerie.rows[0].numero_actual) + 1;
        await client.query(`UPDATE fg_talonario_serie SET numero_actual = $1 WHERE id = $2`, [numeroCorrelativo, resSerie.rows[0].id]);

        const facturacionResult = await client.query(
            `INSERT INTO fg_facturacion (
                venta_id, tipo_comprobante, tipo_documento_cliente, nro_documento,
                nombre_razon_social, direccion, email, telefono, moneda_key,
                base_imponible, igv, importe_total, condicion_pago,
                fecha_vencimiento, medio_pago, estado, usuario_creacion,
                serie, numero, serie_comprobante_id, entorno_facturador
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_DATE,$14,'PENDIENTE_SUNAT',$15,$16,$17,$18,$19)
            RETURNING *`,
            [
                ventaId, tipoComprobante, tipoDocumentoCliente, nroDocumento,
                nombreRazonSocial, direccion, email, telefono, 'PEN',
                baseImponible, igv, importeTotal, condicionPago,
                formapago_key, userContext.username,
                serie, numeroCorrelativo, resSerie.rows[0].id, process.env.NUBEFACT_ENTORNO || 'DEMO'
            ]
        );
        const facturacionId = facturacionResult.rows[0].id;
        const nroComprobante = `${serie}-${String(numeroCorrelativo).padStart(8, '0')}`;
        await client.query(`UPDATE fg_facturacion SET nro_comprobante = $1 WHERE id = $2`, [nroComprobante, facturacionId]);

        // Enviar a Nubefact
        const facturacionObj = facturacionResult.rows[0];
        const payloadNubefact = nubefactAdapter.construirPayloadNubefact({
            facturacion: facturacionObj,
            certificado: { tipo_certificado_clave: 'VENTA CHIP', id: ventaId },
            vehiculo: { placa: '-' },
            cuotas: cuotas,
            detalles: detalles.map(d => ({
                codigo_sku_snapshot: d.producto_codigo,
                descripcion_snapshot: `VENTA DE ${d.producto_nombre}`,
                unidad_snapshot: 'ZZ',
                cantidad: d.cantidad,
                valor_unitario: d.precio_unitario / 1.18,
                precio_unitario: d.precio_unitario,
                base_imponible: (d.precio_unitario / 1.18) * d.cantidad,
                igv: (d.precio_unitario - (d.precio_unitario / 1.18)) * d.cantidad,
                importe_total: d.precio_unitario * d.cantidad,
                descuento: 0,
                afectacion_igv_snapshot: '10'
            }))
        });

        const respuestaNubefact = await nubefactService.emitir(payloadNubefact, facturacionObj.entorno_facturador);
        
        await client.query(
            `UPDATE fg_facturacion 
             SET respuesta_proveedor = $1, enlace_pdf = $2, enlace_xml = $3, enlace_cdr = $4, aceptada_sunat = $5, estado = $6
             WHERE id = $7`,
            [
                respuestaNubefact, respuestaNubefact.enlace_del_pdf, respuestaNubefact.enlace_del_xml,
                respuestaNubefact.enlace_del_cdr, respuestaNubefact.aceptada_por_sunat,
                respuestaNubefact.aceptada_por_sunat ? 'ACEPTADO' : 'PENDIENTE_SUNAT',
                facturacionId
            ]
        );

        await client.query('COMMIT');
        return { success: true, ventaId, ordenPagoId, facturacionId, nroComprobante, enlace_pdf: respuestaNubefact.enlace_del_pdf };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en crearVenta:', error);
        throw error;
    } finally {
        client.release();
    }
};


const listarVentas = async (plantaKey) => {
    const client = await db.getClient();
    try {
        const query = `
            SELECT v.id, v.creado_en, v.cliente_nombre, v.cliente_nro_documento,
                   v.importe_total, v.estado as venta_estado,
                   f.id as facturacion_id, f.nro_comprobante, f.estado as facturacion_estado,
                   f.enlace_pdf, f.enlace_xml,
                   (
                       SELECT json_agg(json_build_object('numero_chip', c.numero_chip, 'producto', pi.nombre))
                       FROM fg_venta_detalle vd
                       JOIN fg_chip c ON vd.chip_id = c.id
                       JOIN fg_producto_inventariable pi ON vd.producto_inventariable_id = pi.id
                       WHERE vd.venta_id = v.id
                   ) as chips
            FROM fg_venta v
            LEFT JOIN fg_facturacion f ON f.venta_id = v.id
            WHERE v.planta_key = $1
            ORDER BY v.id DESC
            LIMIT 100
        `;
        const { rows } = await client.query(query, [plantaKey]);
        return rows;
    } finally {
        client.release();
    }
};

module.exports = {
    listarVentas,
    crearVenta
};
