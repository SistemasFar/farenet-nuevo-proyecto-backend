const db = require('../../../config/database');
const faregasAuthService = require('./faregas-auth.service');
const tarifasService = require('./faregas-tarifas.service');
const descuentosService = require('./faregas-descuentos.service');
const { redondear, obtenerTarifaConfigurada, normalizarPagos } = require('./faregas-pagos.rules');

const obtenerCertificado = async (queryable, certificadoId, userContext, bloquear = false) => {
    const result = await queryable.query(
        `SELECT id, estado, planta_key, tipo_certificado_clave, tarifa_codigo FROM fg_certificado WHERE id = $1${bloquear ? ' FOR UPDATE' : ''}`,
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

exports.guardarPagos = async (certificadoId, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const certificado = await obtenerCertificado(client, certificadoId, userContext, true);
        if (certificado.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        const importeSolicitado = redondear(data.importeTotal);
        if (!Number.isFinite(importeSolicitado) || importeSolicitado <= 0) throw new Error('IMPORTE_TOTAL_INVALIDO');
        const pagos = normalizarPagos(data.pagos);
        for (const pago of pagos) await validarReferenciaPago(client, pago);

        let ordenResult = await client.query(
            'SELECT * FROM fg_orden_pago WHERE certificado_id = $1 FOR UPDATE',
            [certificadoId]
        );
        let orden;
        if (ordenResult.rowCount === 0) {
            // INTEGRACION DESCUENTOS: Obtenemos el resumen del descuento, que nos da el importeFinal
            const resumenDescuento = await descuentosService.obtenerResumenDescuentoCertificado(client, certificado);
            
            if (!resumenDescuento.tarifaOriginal && !certificado.tarifa_codigo) {
                throw new Error('TARIFA_REQUERIDA');
            }

            const tarifaConfigurada = resumenDescuento.totalFinal; // Es igual a tarifaOriginal si no hay descuento

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

        // INTEGRACION DESCUENTOS: Consumir el descuento
        if (estado === 'PAGADO') {
            await descuentosService.consumirDescuentoSiExiste(client, certificadoId, orden.id, userContext);
        }

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

exports.obtenerPagos = async (certificadoId, userContext) => {
    const certificado = await obtenerCertificado(db, certificadoId, userContext);
    const ordenResult = await db.query('SELECT * FROM fg_orden_pago WHERE certificado_id = $1', [certificadoId]);
    if (ordenResult.rowCount === 0) {
        let importeTotal = null;
        
        // INTEGRACION DESCUENTOS
        const resumenDescuento = await descuentosService.obtenerResumenDescuentoCertificado(db, certificado);
        if (resumenDescuento.tarifaOriginal || certificado.tarifa_codigo) {
            importeTotal = resumenDescuento.totalFinal;
        }

        return { orden: null, pagos: [], importeTotal };
    }
    const orden = ordenResult.rows[0];
    return { orden, pagos: await exports.listarPagosPorOrden(orden.id), importeTotal: Number(orden.importe_total) };
};
