const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const service = require('../services/faregas-chips.service');

const usuario = { username: 'USUARIO_VENTAS', perfil_id: 'SISTEMAS', planta_key: '201' };
const queryOriginal = db.query;
const accesoOriginal = authService.validarAccesoPlanta;

test.afterEach(() => {
    db.query = queryOriginal;
    authService.validarAccesoPlanta = accesoOriginal;
});

test('lista ventas canónicas de la sede autenticada con chips y comprobante', async () => {
    const consultas = [];
    db.query = async (sql, params) => {
        consultas.push({ sql, params });
        return {
            rowCount: 1,
            rows: [{
                operacion_id: '214',
                creado_en: '2026-09-24T12:14:48.126',
                tipo_documento_cliente_snapshot: 'DNI',
                documento_cliente_snapshot: '12345678',
                nombre_cliente_snapshot: 'CLIENTE PRUEBA',
                estado_venta: 'PAGADO',
                importe_total: '180.00',
                chips: ['CHIPPRO'],
                facturacion_id: '255',
                comprobante_estado: 'BORRADOR',
                nro_comprobante: null,
                enlace_pdf: null
            }]
        };
    };
    authService.validarAccesoPlanta = async () => ({ key: '201', nombre: 'INDEPENDENCIA' });

    const ventas = await service.listarVentas(usuario.planta_key, usuario);
    assert.equal(ventas.length, 1);
    assert.equal(ventas[0].operacionId, 214);
    assert.deepEqual(ventas[0].chips, ['CHIPPRO']);
    assert.equal(ventas[0].estadoVenta, 'PAGADO');
    assert.equal(ventas[0].importeTotal, 180);
    assert.equal(ventas[0].facturacion.estado, 'BORRADOR');
    assert.deepEqual(consultas[0].params, ['201']);
    assert.match(consultas[0].sql, /fg_operacion_detalle_chip/);
    assert.match(consultas[0].sql, /LEFT JOIN fg_facturacion f/);
    assert.doesNotMatch(consultas[0].sql, /fg_venta/i);
});

const ejecutarListadoConFiltros = async (filtros) => {
    const consultas = [];
    db.query = async (sql, params) => {
        consultas.push({ sql, params });
        return {
            rowCount: 1,
            rows: [{
                operacion_id: '217', creado_en: '2026-09-24T23:50:00.000Z',
                tipo_documento_cliente_snapshot: 'DNI', documento_cliente_snapshot: '12345678',
                nombre_cliente_snapshot: 'CLIENTE', estado_venta: 'PAGADO',
                importe_total: '180.00', chips: ['CHIP'],
                facturacion_id: null, comprobante_estado: null,
                nro_comprobante: null, enlace_pdf: null
            }]
        };
    };
    authService.validarAccesoPlanta = async () => ({ key: '201', nombre: 'INDEPENDENCIA' });
    const ventas = await service.listarVentas('201', usuario, filtros);
    return { ventas, consultas };
};

test('filtra listado solo por fecha Desde', async () => {
    const { consultas } = await ejecutarListadoConFiltros({ fechaDesde: '2026-09-20', plantaKey: '999' });
    assert.deepEqual(consultas[0].params, ['201', '2026-09-20']);
    assert.match(consultas[0].sql, /oc\.fecha_creacion >= \$2::date/);
    assert.equal(consultas[0].params[0], '201');
});

test('filtra listado solo por fecha Hasta de forma inclusiva', async () => {
    const { consultas } = await ejecutarListadoConFiltros({ fechaHasta: '2026-09-24' });
    assert.deepEqual(consultas[0].params, ['201', '2026-09-24']);
    assert.match(consultas[0].sql, /oc\.fecha_creacion < \$2::date \+ INTERVAL '1 day'/);
});

test('filtra listado por Desde y Hasta', async () => {
    const { consultas } = await ejecutarListadoConFiltros({ fechaDesde: '2026-09-20', fechaHasta: '2026-09-24' });
    assert.deepEqual(consultas[0].params, ['201', '2026-09-20', '2026-09-24']);
    assert.match(consultas[0].sql, /oc\.fecha_creacion >= \$2::date/);
    assert.match(consultas[0].sql, /oc\.fecha_creacion < \$3::date \+ INTERVAL '1 day'/);
});

test('rechaza rango de fechas invertido en backend', async () => {
    authService.validarAccesoPlanta = async () => ({ key: '201', nombre: 'INDEPENDENCIA' });
    await assert.rejects(
        service.listarVentas('201', usuario, { fechaDesde: '2026-09-25', fechaHasta: '2026-09-24' }),
        error => error.code === 'RANGO_FECHAS_INVALIDO'
            && error.statusCode === 400
            && /Desde no puede ser posterior/.test(error.detalles || '')
    );
});

test('rechaza formato de fecha inválido en backend', async () => {
    authService.validarAccesoPlanta = async () => ({ key: '201', nombre: 'INDEPENDENCIA' });
    await assert.rejects(
        service.listarVentas('201', usuario, { fechaDesde: '20/09/2026' }),
        error => error.code === 'FECHA_INVALIDA' && error.statusCode === 400
    );
});

test('obtiene detalle canónico con snapshots, pagos y último motivo de facturación', async () => {
    const consultas = [];
    db.query = async (sql, params) => {
        consultas.push({ sql, params });
        if (sql.includes('FROM fg_operacion_comercial')) {
            return { rowCount: 1, rows: [{
                id: 216, planta_key: '201', estado: 'PAGADO',
                tipo_documento_cliente_snapshot: 'DNI', documento_cliente_snapshot: '74045612',
                nombre_cliente_snapshot: 'DDDSD', direccion_cliente_snapshot: 'DSSDSDDS',
                moneda_key: 'sol', importe_total: '180.00', fecha_creacion: '2026-09-24T19:21:31.319Z'
            }] };
        }
        if (sql.includes('FROM fg_operacion_detalle od')) {
            return { rows: [{
                detalle_id: 146, tipo_item: 'PRODUCTO', codigo_sku_snapshot: 'CHIP + PORTA CHIP - SURCO',
                descripcion_snapshot: 'CHIP + PORTA CHIP', unidad_snapshot: 'NIU',
                afectacion_igv_snapshot: '10', codigo_sunat_snapshot: null, cantidad: '1.000',
                valor_unitario: '152.540000', precio_unitario: '180.000000',
                base_imponible: '152.54', igv: '27.46', importe_total: '180.00',
                chip_id: 100, numero_chip: 'CHIPBB', chip_estado: 'VENDIDO',
                planta_actual_key: '201', planta_nombre: 'INDEPENDENCIA'
            }] };
        }
        if (sql.includes('FROM fg_orden_pago op')) {
            return { rows: [{
                orden_id: 226, orden_estado: 'PAGADO', importe_total: 180,
                importe_pagado: 180, saldo_pendiente: 0, moneda_key: 'sol', formapago_key: 'contado',
                pago_id: 1255, pago_estado: 'CAN', importe: 180, tipocontado_key: 'efectivo',
                tarjeta_key: null, entidadfinanciera_key: null, nrooperacionbanco: null,
                nrooperaciontarjeta: null, fechdeposito: null
            }] };
        }
        if (sql.includes('FROM fg_facturacion f')) {
            return { rows: [{
                facturacion_id: 256, comprobante_estado: 'RECHAZADO', tipo_comprobante: 'BOLETA',
                serie: 'BBB1', numero: 50, nro_comprobante: 'BBB1-00000050',
                sunat_responsecode: null, respuesta_proveedor: { codigo: 21 },
                sunat_description: 'No puedes enviar mas de 50 documentos en una cuenta DEMO.',
                enlace_pdf: null, intentos: 1, fecha_ultimo_intento: '2026-09-24T19:21:31.435Z',
                intento_numero: 1, intento_estado: 'RECHAZADO', intento_http_status: 400,
                intento_error: 'REJECTED_BY_PROVIDER'
            }] };
        }
        throw new Error(`Consulta inesperada: ${sql}`);
    };
    authService.validarAccesoPlanta = async () => ({ key: '201', nombre: 'INDEPENDENCIA' });

    const detalle = await service.obtenerDetalleVenta(216, usuario);

    assert.equal(detalle.operacionId, 216);
    assert.equal(detalle.cliente.documento, '74045612');
    assert.equal(detalle.detalles[0].precioUnitario, 180);
    assert.equal(detalle.detalles[0].chip.numero, 'CHIPBB');
    assert.equal(detalle.ordenPago.pagado, 180);
    assert.equal(detalle.pagos[0].tipo, 'EFECTIVO');
    assert.equal(detalle.facturacion.nroComprobante, 'BBB1-00000050');
    assert.equal(detalle.facturacion.sunatResponseCode, 21);
    assert.equal(detalle.facturacion.ultimoIntento.httpStatus, 400);
    assert.match(detalle.facturacion.mensajeRechazo, /50 documentos/);
    assert.equal(consultas[0].params[0], 216);
    assert.doesNotMatch(consultas.map((item) => item.sql).join(' '), /fg_venta/i);
});

test('bloquea el detalle si la operación pertenece a otra sede', async () => {
    let consultas = 0;
    db.query = async () => {
        consultas += 1;
        return { rowCount: 1, rows: [{ id: 216, planta_key: '202' }] };
    };
    authService.validarAccesoPlanta = async () => null;

    await assert.rejects(
        service.obtenerDetalleVenta(216, usuario),
        /PLANTA_NO_AUTORIZADA/
    );
    assert.equal(consultas, 1);
});

test('no acepta una sede distinta a req\.user\.planta_key desde el listado', async () => {
    db.query = async () => assert.fail('no debe consultar si el acceso es rechazado');
    authService.validarAccesoPlanta = async () => null;

    await assert.rejects(
        service.listarVentas('999', usuario),
        /PLANTA_NO_AUTORIZADA/
    );
});
