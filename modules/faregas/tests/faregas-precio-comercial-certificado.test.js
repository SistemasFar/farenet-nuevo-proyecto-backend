const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../config/database');
const tarifasService = require('../services/faregas-tarifas.service');
const certificadosService = require('../services/faregas-certificados.service');
const pagosService = require('../services/faregas-pagos.service');
const descuentosService = require('../services/faregas-descuentos.service');
const resumenTributarioService = require('../services/faregas-resumen-tributario.service');
const nubefactAdapter = require('../integrations/nubefact-faregas.adapter');

const filaTarifa = (overrides = {}) => ({
    categoria_codigo: 'GLP',
    categoria_nombre: 'GLP',
    categoria_orden: 1,
    servicio_id: 233,
    servicio_codigo: '0041',
    servicio_nombre: 'CERTIFICACION ANUAL DE GLP',
    servicio_orden: 1,
    tipo_flujo: 'CERTIFICACION',
    requiere_certificado: true,
    requiere_vehiculo: true,
    tipo_certificado_clave: 'GLP_ANUAL',
    modalidad: 'ANUAL',
    tarifa_id: 183,
    tarifa_codigo: '0041',
    precio_tarifa: '50.00',
    producto_facturacion_id: '63',
    producto_precio_unitario: '67.80',
    producto_precio_referencia: '80.00',
    producto_sku: '0041',
    producto_descripcion: 'CERTIFICACION ANUAL DE GLP',
    producto_unidad: 'NIU',
    producto_afectacion_igv: '10',
    producto_codigo_sunat: null,
    requiere_chip: false,
    producto_chip_id: null,
    chip_precio: null,
    ...overrides
});

test('resuelve P. venta para los casos 0041, 0042 y taller, sin usar fg_tarifa.precio', () => {
    assert.equal(tarifasService.resolverPrecioComercial({
        productoFacturacionId: 63,
        precioReferencia: '80.00',
        precioUnitario: '67.80',
        precioTarifa: '45.00'
    }), 80);
    assert.equal(tarifasService.resolverPrecioComercial({
        productoFacturacionId: 62,
        precioReferencia: '90.00',
        precioUnitario: '76.27',
        precioTarifa: '45.00'
    }), 90);
    assert.equal(tarifasService.resolverPrecioComercial({
        productoFacturacionId: 61,
        precioReferencia: '350.00',
        precioUnitario: '296.61',
        precioTarifa: '45.00'
    }), 350);
    assert.equal(tarifasService.resolverPrecioComercial({
        productoFacturacionId: null,
        precioReferencia: null,
        precioUnitario: null,
        precioTarifa: '45.00'
    }), null);
    assert.equal(tarifasService.resolverPrecioComercial({
        productoFacturacionId: 99,
        precioReferencia: null,
        precioUnitario: '80.00',
        precioTarifa: '45.00'
    }), 80);
});

test('el catálogo de Nuevo Certificado muestra 80.00 para SKU 0041', () => {
    const catalogo = tarifasService.construirCatalogo(
        { key: '13', nombre: 'COLINA' },
        [filaTarifa()]
    );
    const tarifa = catalogo.categorias[0].servicios[0].tarifa;
    assert.equal(tarifa.precio, 80);
    assert.equal(tarifa.importeTotal, 80);
});

test('la tarifa operativa entrega el mismo precio comercial al borrador', async () => {
    const queryable = {
        query: async (sql) => {
            assert.match(sql, /pf\.precio_referencia AS producto_precio_referencia/);
            assert.match(sql, /pf\.precio_unitario AS producto_precio_unitario/);
            return { rowCount: 1, rows: [filaTarifa({ id: 183, codigo: '0041' })] };
        }
    };
    const tarifa = await tarifasService.obtenerTarifaOperativaPorCodigo('13', '0041', queryable);
    assert.equal(tarifa.precio, 80);
});

test('el catálogo compuesto suma P. venta del certificado y el precio comercial del chip', () => {
    const catalogo = tarifasService.construirCatalogo(
        { key: '13', nombre: 'COLINA' },
        [filaTarifa({
            requiere_chip: true,
            producto_chip_id: '10',
            chip_precio: '60.00'
        })]
    );
    const tarifa = catalogo.categorias[0].servicios[0].tarifa;
    assert.equal(tarifa.precio, 80);
    assert.equal(tarifa.chip.precio, 60);
    assert.equal(tarifa.importeTotal, 140);
});

test('el certificado conserva el snapshot 80 y uno nuevo toma el P. venta actualizado a 90', async () => {
    const originalObtenerTarifa = tarifasService.obtenerTarifaOperativaPorCodigo;
    const originalQuery = db.query;
    const originalConnect = db.connect;
    const snapshots = [];
    let precioVenta = 80;

    tarifasService.obtenerTarifaOperativaPorCodigo = async () => ({
        ...filaTarifa({ id: 183, codigo: '0041' }),
        id: 183,
        codigo: '0041',
        precio: precioVenta,
        producto_facturacion_id: 63,
        requiere_chip: false
    });
    db.query = async (sql) => {
        assert.match(sql, /SELECT activo FROM fg_tipo_certificado/);
        return { rowCount: 1, rows: [{ activo: true }] };
    };
    db.connect = async () => ({
        query: async (sql, params = []) => {
            if (/INSERT INTO fg_certificado\s*\(/.test(sql)) {
                snapshots.push({ precioCertificado: params[7], importeTotal: params[11] });
                return {
                    rowCount: 1,
                    rows: [{ id: 9000 + snapshots.length, estado: 'BORRADOR', pasoActual: 'DATOS_INICIALES' }]
                };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    });

    try {
        await certificadosService.crearBorrador(
            { tarifaCodigo: '0041' },
            { username: 'TEST', planta_key: '13' }
        );
        precioVenta = 90;
        await certificadosService.crearBorrador(
            { tarifaCodigo: '0041' },
            { username: 'TEST', planta_key: '13' }
        );

        assert.deepEqual(snapshots, [
            { precioCertificado: 80, importeTotal: 80 },
            { precioCertificado: 90, importeTotal: 90 }
        ]);
        assert.equal(snapshots[0].precioCertificado, 80);
    } finally {
        tarifasService.obtenerTarifaOperativaPorCodigo = originalObtenerTarifa;
        db.query = originalQuery;
        db.connect = originalConnect;
    }
});

test('Pago calcula el descuento sobre el snapshot comercial de 80.00', async () => {
    const originalDescuento = descuentosService.obtenerResumenDescuentoCertificado;
    descuentosService.obtenerResumenDescuentoCertificado = async () => ({
        tarifaOriginal: 80,
        totalFinal: 72
    });

    try {
        const pago = await pagosService._private.obtenerResumenComercial({}, {
            precio_certificado: 80,
            producto_chip_id: null,
            precio_chip: null
        });
        assert.equal(pago.precioCertificado, 80);
        assert.equal(pago.descuentoCertificado, 8);
        assert.equal(pago.importeTotal, 72);
    } finally {
        descuentosService.obtenerResumenDescuentoCertificado = originalDescuento;
    }
});

test('el fallback tributario usa P. venta y no vuelve a leer fg_tarifa.precio', async () => {
    const queryable = {
        query: async (sql) => {
            assert.match(sql, /t\.precio AS precio_tarifa/);
            assert.match(sql, /pf\.precio_referencia AS producto_precio_referencia/);
            return {
                rowCount: 1,
                rows: [filaTarifa({
                    producto_facturacion_id: 63,
                    producto_precio_referencia: '80.00',
                    producto_precio_unitario: '67.80',
                    precio_tarifa: '50.00'
                })]
            };
        }
    };
    const detalle = await resumenTributarioService._private.obtenerDetalle({
        certificado_id: 9001,
        planta_key: '13',
        tarifa_codigo: '0041'
    }, queryable);
    assert.equal(detalle.tarifa_precio, 80);
});

test('Pago, operación, resumen tributario y payload Nubefact conservan 80.00 sin doble IGV', async () => {
    const originalDescuento = descuentosService.obtenerResumenDescuentoCertificado;
    descuentosService.obtenerResumenDescuentoCertificado = async () => ({
        tarifaOriginal: 80,
        totalFinal: 80
    });

    try {
        const certificado = {
            id: 9001,
            planta_key: '13',
            cliente_id: 77,
            tarifa_codigo: '0041',
            producto_facturacion_certificado_id: 63,
            precio_certificado: 80,
            producto_chip_id: null,
            precio_chip: null
        };
        const pago = await pagosService._private.obtenerResumenComercial({}, certificado);
        assert.equal(pago.precioCertificado, 80);
        assert.equal(pago.importeTotal, 80);

        const consultas = [];
        const client = {
            query: async (sql, params = []) => {
                consultas.push({ sql, params });
                if (/SELECT operacion_id FROM fg_operacion_detalle/.test(sql)) {
                    return { rowCount: 0, rows: [] };
                }
                if (/SELECT\s+t\.id/.test(sql)) {
                    return { rowCount: 1, rows: [filaTarifa({ id: 183, codigo: '0041' })] };
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
            baseimponible: 67.8,
            igv: 12.2,
            importe_total: 80,
            estado: 'PAGADO'
        };
        await pagosService._private.asegurarOperacionComercial(client, certificado, orden, 'TEST');
        const operacionInsert = consultas.find(({ sql }) => /INSERT INTO fg_operacion_comercial/.test(sql));
        const detalleInsert = consultas.find(({ sql }) => /INSERT INTO fg_operacion_detalle/.test(sql));
        assert.equal(operacionInsert.params[6], 80);
        assert.equal(detalleInsert.params[10], 67.8);
        assert.equal(detalleInsert.params[11], 80);
        assert.equal(detalleInsert.params[12], 12.2);

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
                base_imponible: 67.8,
                igv: 12.2,
                importe_total: 80,
                condicion_pago: 'CONTADO',
                medio_pago: 'EFECTIVO'
            },
            detalles: [{
                tipo_item: 'SERVICIO',
                cantidad: 1,
                orden: 1,
                producto_facturacion_id: 63,
                producto_activo: true,
                producto_sku: '0041',
                producto_descripcion: 'CERTIFICACION ANUAL DE GLP',
                producto_unidad: 'NIU',
                producto_afectacion_igv: '10',
                tarifa_precio: 80,
                detalle_base_imponible: 67.8,
                detalle_igv: 12.2,
                detalle_importe_total: 80
            }],
            descuento: null,
            pagos: [{ medio_pago: 'EFECTIVO' }],
            serie: { serieboleta: 'BBB1', fuente: 'FG_SERIE_COMPROBANTE' }
        });
        assert.equal(resumen.totales.baseImponible, 67.8);
        assert.equal(resumen.totales.igv, 12.2);
        assert.equal(resumen.totales.total, 80);

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
                base_imponible: 67.8,
                igv: 12.2,
                importe_total: 80,
                condicion_pago: 'CONTADO',
                medio_pago: 'EFECTIVO'
            },
            detalles: resumenTributarioService.construirDetallesNubefact(resumen),
            resumenTributario: resumen
        });
        assert.equal(payload.total_gravada, 67.8);
        assert.equal(payload.total_igv, 12.2);
        assert.equal(payload.total, 80);
        assert.equal(payload.items[0].valor_unitario, 67.8);
        assert.equal(payload.items[0].precio_unitario, 80);
        assert.equal(payload.items[0].total, 80);
    } finally {
        descuentosService.obtenerResumenDescuentoCertificado = originalDescuento;
    }
});

test.after(async () => {
    await db.end();
});
