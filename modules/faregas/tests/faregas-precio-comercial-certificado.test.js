const test = require('node:test');
const assert = require('node:assert/strict');

const tarifasService = require('../services/faregas-tarifas.service');
const pagosService = require('../services/faregas-pagos.service');
const descuentosService = require('../services/faregas-descuentos.service');
const resumenTributarioService = require('../services/faregas-resumen-tributario.service');
const nubefactAdapter = require('../integrations/nubefact-faregas.adapter');

const filaTarifa = (overrides = {}) => ({
    categoria_codigo: 'GLP',
    categoria_nombre: 'GLP',
    categoria_orden: 1,
    servicio_id: 233,
    servicio_codigo: '0228',
    servicio_nombre: 'CERTIFICADO ANUAL GLP - MOTO TAXI',
    servicio_orden: 1,
    tipo_flujo: 'CERTIFICACION',
    requiere_certificado: true,
    requiere_vehiculo: true,
    tipo_certificado_clave: 'GLP_ANUAL',
    modalidad: 'ANUAL',
    tarifa_id: 183,
    tarifa_codigo: 'GLP_ANUAL_MOTO',
    precio_tarifa: '38.14',
    producto_facturacion_id: '14',
    producto_precio_unitario: '38.14',
    producto_precio_referencia: '45.00',
    producto_sku: '0228',
    producto_descripcion: 'CERTIFICADO ANUAL GLP - MOTO TAXI',
    producto_unidad: 'NIU',
    producto_afectacion_igv: '10',
    producto_codigo_sunat: null,
    requiere_chip: false,
    producto_chip_id: null,
    chip_precio: null,
    ...overrides
});

test('resuelve precio_referencia, fallback unitario y compatibilidad sin producto', () => {
    assert.equal(tarifasService.resolverPrecioComercial({
        productoFacturacionId: 14,
        precioReferencia: '45.00',
        precioUnitario: '38.14',
        precioTarifa: '38.14'
    }), 45);
    assert.equal(tarifasService.resolverPrecioComercial({
        productoFacturacionId: 15,
        precioReferencia: null,
        precioUnitario: '50.00',
        precioTarifa: '40.00'
    }), 50);
    assert.equal(tarifasService.resolverPrecioComercial({
        productoFacturacionId: 16,
        precioReferencia: '60.00',
        precioUnitario: '60.00',
        precioTarifa: '55.00'
    }), 60);
    assert.equal(tarifasService.resolverPrecioComercial({
        productoFacturacionId: null,
        precioReferencia: null,
        precioUnitario: null,
        precioTarifa: '70.00'
    }), 70);
});

test('el catálogo de Nuevo Certificado muestra 45.00 para SKU 0228', () => {
    const catalogo = tarifasService.construirCatalogo(
        { key: '13', nombre: 'COLINA' },
        [filaTarifa()]
    );
    const tarifa = catalogo.categorias[0].servicios[0].tarifa;
    assert.equal(tarifa.precio, 45);
    assert.equal(tarifa.importeTotal, 45);
});

test('la tarifa operativa entrega el mismo precio comercial al borrador', async () => {
    const queryable = {
        query: async (sql) => {
            assert.match(sql, /pf\.precio_referencia AS producto_precio_referencia/);
            assert.match(sql, /pf\.precio_unitario AS producto_precio_unitario/);
            return { rowCount: 1, rows: [filaTarifa({ id: 183, codigo: 'GLP_ANUAL_MOTO' })] };
        }
    };
    const tarifa = await tarifasService.obtenerTarifaOperativaPorCodigo('13', 'GLP_ANUAL_MOTO', queryable);
    assert.equal(tarifa.precio, 45);
});

test('el fallback tributario no vuelve a leer 38.14 directamente de fg_tarifa', async () => {
    const queryable = {
        query: async (sql) => {
            assert.match(sql, /t\.precio AS precio_tarifa/);
            assert.match(sql, /pf\.precio_referencia AS producto_precio_referencia/);
            return {
                rowCount: 1,
                rows: [filaTarifa({
                    producto_facturacion_id: 14,
                    producto_precio_referencia: '45.00',
                    producto_precio_unitario: '38.14',
                    precio_tarifa: '38.14'
                })]
            };
        }
    };
    const detalle = await resumenTributarioService._private.obtenerDetalle({
        certificado_id: 9001,
        planta_key: '13',
        tarifa_codigo: '0228'
    }, queryable);
    assert.equal(detalle.tarifa_precio, 45);
});

test('Pago, operación, resumen tributario y payload Nubefact conservan 45.00', async () => {
    const originalDescuento = descuentosService.obtenerResumenDescuentoCertificado;
    descuentosService.obtenerResumenDescuentoCertificado = async () => ({
        tarifaOriginal: 45,
        totalFinal: 45
    });

    try {
        const certificado = {
            id: 9001,
            planta_key: '13',
            cliente_id: 77,
            tarifa_codigo: 'GLP_ANUAL_MOTO',
            producto_facturacion_certificado_id: 14,
            precio_certificado: 45,
            producto_chip_id: null,
            precio_chip: null
        };
        const pago = await pagosService._private.obtenerResumenComercial({}, certificado);
        assert.equal(pago.precioCertificado, 45);
        assert.equal(pago.importeTotal, 45);

        const consultas = [];
        const client = {
            query: async (sql, params = []) => {
                consultas.push({ sql, params });
                if (/SELECT operacion_id FROM fg_operacion_detalle/.test(sql)) {
                    return { rowCount: 0, rows: [] };
                }
                if (/SELECT\s+t\.id/.test(sql)) {
                    return { rowCount: 1, rows: [filaTarifa({ id: 183, codigo: 'GLP_ANUAL_MOTO' })] };
                }
                if (/SELECT placa FROM fg_certificado_vehiculo/.test(sql)) {
                    return { rowCount: 1, rows: [{ placa: 'ABC123' }] };
                }
                if (/INSERT INTO fg_operacion_comercial/.test(sql)) {
                    return { rowCount: 1, rows: [{ id: 7001 }] };
                }
                return { rowCount: 1, rows: [] };
            }
        };
        const orden = {
            id: 8001,
            moneda_key: 'sol',
            baseimponible: 38.14,
            igv: 6.86,
            importe_total: 45,
            estado: 'PAGADO'
        };
        await pagosService._private.asegurarOperacionComercial(client, certificado, orden, 'TEST');
        const operacionInsert = consultas.find(({ sql }) => /INSERT INTO fg_operacion_comercial/.test(sql));
        const detalleInsert = consultas.find(({ sql }) => /INSERT INTO fg_operacion_detalle/.test(sql));
        assert.equal(operacionInsert.params[6], 45);
        assert.equal(detalleInsert.params[11], 45);

        const resumen = resumenTributarioService._private.construirResumen({
            contexto: {
                facturacion_id: 6001,
                planta_key: '13',
                sede_nombre: 'COLINA',
                empresa_key: 'CAMBRIDGE',
                razon_social_emisor: 'CAMBRIDGE',
                ruc_emisor: '20123456789',
                entorno_facturador: 'DEMO',
                tipo_comprobante: 'BOLETA',
                tipo_documento_cliente: 'DNI',
                nro_documento: '12345678',
                nombre_razon_social: 'CLIENTE PRUEBA',
                moneda_key: 'SOL',
                base_imponible: 38.14,
                igv: 6.86,
                importe_total: 45,
                condicion_pago: 'CONTADO',
                medio_pago: 'EFECTIVO'
            },
            detalles: [{
                tipo_item: 'SERVICIO',
                cantidad: 1,
                orden: 1,
                producto_facturacion_id: 14,
                producto_activo: true,
                producto_sku: '0228',
                producto_descripcion: 'CERTIFICADO ANUAL GLP - MOTO TAXI',
                producto_unidad: 'NIU',
                producto_afectacion_igv: '10',
                tarifa_precio: 45,
                detalle_base_imponible: 38.14,
                detalle_igv: 6.86,
                detalle_importe_total: 45
            }],
            descuento: null,
            pagos: [{ medio_pago: 'EFECTIVO' }],
            serie: { serieboleta: 'BBB1', fuente: 'FG_SERIE_COMPROBANTE' }
        });
        assert.equal(resumen.totales.baseImponible, 38.14);
        assert.equal(resumen.totales.igv, 6.86);
        assert.equal(resumen.totales.total, 45);

        const payload = nubefactAdapter.construirPayloadNubefact({
            facturacion: {
                id: 6001,
                tipo_comprobante: 'BOLETA',
                tipo_documento_cliente: 'DNI',
                nro_documento: '12345678',
                nombre_razon_social: 'CLIENTE PRUEBA',
                direccion: 'COLINA',
                serie: 'BBB1',
                numero: 120,
                base_imponible: 38.14,
                igv: 6.86,
                importe_total: 45,
                condicion_pago: 'CONTADO',
                medio_pago: 'EFECTIVO'
            },
            detalles: resumenTributarioService.construirDetallesNubefact(resumen),
            resumenTributario: resumen
        });
        assert.equal(payload.total_gravada, 38.14);
        assert.equal(payload.total_igv, 6.86);
        assert.equal(payload.total, 45);
        assert.equal(payload.items[0].precio_unitario, 45);
        assert.equal(payload.items[0].total, 45);
    } finally {
        descuentosService.obtenerResumenDescuentoCertificado = originalDescuento;
    }
});
