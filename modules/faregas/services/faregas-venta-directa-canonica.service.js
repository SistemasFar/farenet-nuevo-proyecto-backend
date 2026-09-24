const db = require('../../../config/database');
const authService = require('./faregas-auth.service');
const { normalizarLoteScanner } = require('./faregas-chips.rules');
const {
    redondear,
    normalizarPagos,
    esProductoFiscalChipValido
} = require('./faregas-pagos.rules');

const texto = (value) => String(value ?? '').trim();

const calcularBaseIgv = (importe) => {
    const base = redondear(Number(importe) / 1.18);
    return { base, igv: redondear(Number(importe) - base) };
};

const validarTextoCliente = (data) => {
    const tipoDocumento = texto(data.tipoDocumentoCliente).toUpperCase();
    const numeroDocumento = texto(data.nroDocumento);
    const nombre = texto(data.nombreRazonSocial);
    const direccion = texto(data.direccion) || null;

    if (!tipoDocumento || !numeroDocumento || !nombre) {
        throw new Error('DATOS_CLIENTE_REQUERIDOS');
    }
    if (tipoDocumento.length > 20 || numeroDocumento.length > 20 || nombre.length > 250) {
        throw new Error('DATOS_CLIENTE_INVALIDOS');
    }
    if (direccion && direccion.length > 500) {
        throw new Error('DATOS_CLIENTE_INVALIDOS');
    }

    return { tipoDocumento, numeroDocumento, nombre, direccion };
};

const validarPago = async (client, pago) => {
    if (pago.tipo === 'tarjeta') {
        if (!pago.tarjetaKey || !pago.nroOperacion) throw new Error('DATOS_TARJETA_INCOMPLETOS');
        const tarjeta = await client.query('SELECT nombre FROM tarjeta WHERE key = $1', [pago.tarjetaKey]);
        if (!tarjeta.rowCount) throw new Error('TARJETA_NOT_FOUND');

        const nombre = String(tarjeta.rows[0].nombre || '').toUpperCase();
        const sinDigitos = ['CUPONIDAD', 'PAGO WEB', 'YAPE', 'PLIN'].some((tipo) => nombre.includes(tipo));
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
        if (!cuenta.rowCount) throw new Error('CUENTA_BANCARIA_INVALIDA');

        const fechaDeposito = new Date(`${String(pago.fechaDeposito).slice(0, 10)}T00:00:00`);
        if (Number.isNaN(fechaDeposito.getTime())) throw new Error('FECHA_DEPOSITO_INVALIDA');
        const hoy = new Date();
        hoy.setHours(23, 59, 59, 999);
        if (fechaDeposito > hoy) throw new Error('FECHA_DEPOSITO_FUTURA');
    }
};

const obtenerConfiguracionProducto = async (client, plantaKey, productoInventariableId) => {
    const result = await client.query(`
        SELECT pi.id, pi.codigo, pi.nombre, pi.activo,
               pis.precio, pis.activo AS sede_activa,
               pis.stock_permitido, pis.venta_habilitada,
               COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id) AS producto_facturacion_id,
               pf.codigo_sku, pf.descripcion, pf.unidad,
               pf.tipo_afectacion_igv, pf.codigo_clasificacion_sunat,
               pf.activo AS fiscal_activo, pf.es_para_venta
        FROM fg_producto_inventariable pi
        JOIN fg_producto_inventariable_sede pis
          ON pis.producto_inventariable_id = pi.id
         AND pis.planta_key = $2
         AND pis.activo = TRUE
        JOIN fg_planta p
          ON p.key = pis.planta_key
         AND p.activo = TRUE
        LEFT JOIN fg_producto_facturacion pf
          ON pf.id = COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id)
        WHERE pi.id = $1
          AND pi.activo = TRUE
        FOR UPDATE OF pis
    `, [productoInventariableId, plantaKey]);

    if (!result.rowCount) throw new Error('PRODUCTO_INVENTARIABLE_NO_CONFIGURADO_SEDE');

    const config = result.rows[0];
    if (config.stock_permitido !== true) throw new Error('STOCK_CHIP_NO_PERMITIDO');
    if (config.venta_habilitada !== true) throw new Error('VENTA_CHIP_NO_HABILITADA');
    if (!config.producto_facturacion_id || !esProductoFiscalChipValido({
        activo: config.fiscal_activo,
        es_para_venta: config.es_para_venta,
        codigo_sku: config.codigo_sku,
        descripcion: config.descripcion,
        unidad: config.unidad,
        tipo_afectacion_igv: config.tipo_afectacion_igv,
        codigo_clasificacion_sunat: config.codigo_clasificacion_sunat
    })) {
        throw new Error('PRODUCTO_FISCAL_CHIP_INVALIDO');
    }

    const precio = Number(config.precio);
    if (!Number.isFinite(precio) || precio <= 0) throw new Error('PRECIO_PRODUCTO_INVALIDO');
    config.precio = redondear(precio);
    return config;
};

const crearVentaDirecta = async (payload, userContext) => {
    const plantaKey = userContext?.planta_key;
    if (!plantaKey) throw new Error('PLANTA_REQUERIDA');

    if (!Array.isArray(payload.chips) || payload.chips.length === 0) {
        throw new Error('CHIPS_REQUERIDOS');
    }

    const lote = normalizarLoteScanner(payload.chips);
    if (lote.errores.length > 0) throw new Error('CHIP_NUMERO_INVALIDO');
    if (lote.duplicados.length > 0) throw new Error('CHIP_DUPLICADO');
    if (lote.validos.length === 0) throw new Error('CHIPS_REQUERIDOS');

    const condicionPago = texto(payload.condicionPago || 'CONTADO').toUpperCase();
    if (!['CONTADO', 'CREDITO'].includes(condicionPago)) throw new Error('CONDICION_PAGO_INVALIDA');
    if (condicionPago !== 'CONTADO') throw new Error('CONDICION_PAGO_NO_DISPONIBLE');

    const cliente = validarTextoCliente(payload);
    if (!['', 'BOLETA', 'FACTURA'].includes(texto(payload.tipoComprobante).toUpperCase())) {
        throw new Error('TIPO_COMPROBANTE_INVALIDO');
    }

    if (!await authService.validarAccesoPlanta(userContext.username, userContext.perfil_id, plantaKey)) {
        throw new Error('PLANTA_NO_AUTORIZADA');
    }

    const pagos = normalizarPagos(payload.pagosAgregados || []);
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const chipsResult = await client.query(`
            SELECT id, numero_chip, estado, planta_actual_key, producto_inventariable_id
            FROM fg_chip
            WHERE numero_chip = ANY($1::varchar[])
            ORDER BY numero_chip
            FOR UPDATE
        `, [lote.validos]);

        if (chipsResult.rowCount !== lote.validos.length) {
            throw new Error('CHIP_NO_ENCONTRADO');
        }

        const chipsPorNumero = new Map(chipsResult.rows.map((chip) => [chip.numero_chip, chip]));
        const chips = lote.validos.map((numero) => {
            const chip = chipsPorNumero.get(numero);
            if (!chip) throw new Error('CHIP_NO_ENCONTRADO');
            if (chip.planta_actual_key !== plantaKey) throw new Error('CHIP_OTRA_SEDE');
            if (chip.estado !== 'DISPONIBLE') {
                const error = new Error('CHIP_NO_DISPONIBLE');
                error.detalles = { chip: chip.numero_chip, estado: chip.estado };
                throw error;
            }
            return chip;
        });

        const configuraciones = new Map();
        for (const chip of chips) {
            const productId = Number(chip.producto_inventariable_id);
            if (!configuraciones.has(productId)) {
                configuraciones.set(productId, await obtenerConfiguracionProducto(client, plantaKey, productId));
            }
        }

        let baseImponible = 0;
        let igv = 0;
        let importeTotal = 0;
        const detalles = [];

        for (const chip of chips) {
            const config = configuraciones.get(Number(chip.producto_inventariable_id));
            const calculo = calcularBaseIgv(config.precio);
            const detalle = {
                chipId: Number(chip.id),
                numeroChip: chip.numero_chip,
                productoFacturacionId: Number(config.producto_facturacion_id),
                codigoSku: config.codigo_sku,
                descripcion: config.descripcion,
                unidad: config.unidad,
                afectacionIgv: config.tipo_afectacion_igv,
                codigoSunat: config.codigo_clasificacion_sunat,
                precioUnitario: config.precio,
                valorUnitario: calculo.base,
                baseImponible: calculo.base,
                igv: calculo.igv,
                importeTotal: config.precio
            };
            detalles.push(detalle);
            baseImponible = redondear(baseImponible + detalle.baseImponible);
            igv = redondear(igv + detalle.igv);
            importeTotal = redondear(importeTotal + detalle.importeTotal);
        }

        const totalPagado = redondear(pagos.reduce((total, pago) => total + pago.importe, 0));
        if (totalPagado - importeTotal > 0.009) throw new Error('PAGO_EXCEDE_TOTAL');
        if (importeTotal - totalPagado > 0.009) throw new Error('PAGO_INCOMPLETO');
        for (const pago of pagos) await validarPago(client, pago);

        // El esquema canónico no tiene columna de origen; la relación detalle-chip
        // identifica esta venta sin inventar un tipo o valor no persistido.
        const operacionResult = await client.query(`
            INSERT INTO fg_operacion_comercial (
                planta_key, cliente_id, tipo_documento_cliente_snapshot,
                documento_cliente_snapshot, nombre_cliente_snapshot,
                direccion_cliente_snapshot, moneda_key, base_imponible, igv,
                importe_total, estado, usuario_creacion
            ) VALUES ($1, NULL, $2, $3, $4, $5, 'sol', $6, $7, $8, 'PAGADO', $9)
            RETURNING id
        `, [
            plantaKey,
            cliente.tipoDocumento,
            cliente.numeroDocumento,
            cliente.nombre,
            cliente.direccion,
            baseImponible,
            igv,
            importeTotal,
            userContext.username
        ]);
        const operacionId = Number(operacionResult.rows[0].id);

        const detalleIds = [];
        for (const [indice, detalle] of detalles.entries()) {
            const detalleResult = await client.query(`
                INSERT INTO fg_operacion_detalle (
                    operacion_id, tipo_item, producto_facturacion_id, cantidad,
                    codigo_sku_snapshot, descripcion_snapshot, unidad_snapshot,
                    afectacion_igv_snapshot, codigo_sunat_snapshot, valor_unitario,
                    precio_unitario, base_imponible, igv, importe_total,
                    genera_certificado_snapshot, orden
                ) VALUES ($1, 'PRODUCTO', $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, FALSE, $13)
                RETURNING id
            `, [
                operacionId,
                detalle.productoFacturacionId,
                detalle.codigoSku,
                detalle.descripcion,
                detalle.unidad,
                detalle.afectacionIgv,
                detalle.codigoSunat,
                detalle.valorUnitario,
                detalle.precioUnitario,
                detalle.baseImponible,
                detalle.igv,
                detalle.importeTotal,
                indice + 1
            ]);
            const detalleId = Number(detalleResult.rows[0].id);
            detalleIds.push(detalleId);
            await client.query(
                'INSERT INTO fg_operacion_detalle_chip (operacion_detalle_id, chip_id) VALUES ($1, $2)',
                [detalleId, detalle.chipId]
            );
        }

        const ordenResult = await client.query(`
            INSERT INTO fg_orden_pago (
                operacion_id, importe_total, baseimponible, igv, importe_pagado,
                saldo_pendiente, moneda_key, formapago_key, estado,
                usuariocreacion_username
            ) VALUES ($1, $2, $3, $4, $5, 0, 'sol', 'contado', 'PAGADO', $6)
            RETURNING id
        `, [operacionId, importeTotal, baseImponible, igv, totalPagado, userContext.username]);
        const ordenPagoId = Number(ordenResult.rows[0].id);

        for (const pago of pagos) {
            const calculoPago = calcularBaseIgv(pago.importe);
            await client.query(`
                INSERT INTO fg_pago (
                    baseimponible, digitotarjeta, estado, fechacreacion, fechdeposito,
                    igv, importe, nrooperacionbanco, nrooperaciontarjeta,
                    sendedtooffisis, orden_pago_id, cuentacorriente_key,
                    entidadfinanciera_key, moneda_key, tarjeta_key, tipocontado_key
                ) VALUES ($1, $2, 'CAN', CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, FALSE, $8, $9, $10, 'sol', $11, $12)
            `, [
                calculoPago.base,
                pago.tipo === 'tarjeta' ? pago.digitosTarjeta || null : null,
                pago.tipo === 'banco' ? pago.fechaDeposito : null,
                calculoPago.igv,
                pago.importe,
                pago.tipo === 'banco' ? String(pago.nroOperacion).trim() : null,
                pago.tipo === 'tarjeta' ? String(pago.nroOperacion).trim() : null,
                ordenPagoId,
                pago.tipo === 'banco' ? pago.cuentaCorrienteKey : null,
                pago.tipo === 'banco' ? pago.entidadFinancieraKey : null,
                pago.tipo === 'tarjeta' ? pago.tarjetaKey : null,
                pago.tipo
            ]);
        }

        for (const detalle of detalles) {
            const actualizacion = await client.query(`
                UPDATE fg_chip
                SET estado = 'VENDIDO', operacion_reserva_id = NULL, reservado_en = NULL,
                    actualizado_por = $2, actualizado_en = CURRENT_TIMESTAMP
                WHERE id = $1
                  AND estado = 'DISPONIBLE'
                  AND planta_actual_key = $3
            `, [detalle.chipId, userContext.username, plantaKey]);
            if (actualizacion.rowCount !== 1) throw new Error('CHIP_NO_DISPONIBLE');

            await client.query(`
                INSERT INTO fg_chip_movimiento (
                    chip_id, tipo_movimiento, planta_origen_key, usuario,
                    operacion_comercial_id, referencia, detalles
                ) VALUES ($1, 'VENTA', $2, $3, $4, $5, $6)
            `, [
                detalle.chipId,
                plantaKey,
                userContext.username,
                operacionId,
                `Operación comercial #${operacionId}`,
                JSON.stringify({
                    estado_anterior: 'DISPONIBLE',
                    estado_nuevo: 'VENDIDO',
                    precio_unitario: detalle.precioUnitario
                })
            ]);
        }

        await client.query('COMMIT');
        return {
            operacionId,
            ordenPagoId,
            detalles: detalles.map((detalle, index) => ({ ...detalle, detalleId: detalleIds[index] })),
            total: importeTotal,
            baseImponible,
            igv,
            totalPagado,
            estado: 'PAGADO'
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    crearVentaDirecta
};
