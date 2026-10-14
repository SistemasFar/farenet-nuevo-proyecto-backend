const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    construirPayloadNubefact
} = require('../integrations/nubefact-faregas.adapter');
const {
    MATRIZ_INFORMACION_PDF
} = require('../integrations/nubefact-faregas-informacion-adicional');

const facturacionBase = (overrides = {}) => ({
    id: 91,
    tipo_comprobante: 'BOLETA',
    tipo_documento_cliente: 'DNI',
    nro_documento: '32922762',
    nombre_razon_social: 'CLIENTE DE PRUEBA',
    direccion: 'AV. PRUEBA 123',
    email: 'cliente@example.com',
    telefono: '999111222',
    condicion_pago: 'CONTADO',
    medio_pago: 'EFECTIVO',
    fecha_documento: '2026-10-14',
    fecha_vencimiento: null,
    serie: 'BE20',
    numero: 8138,
    base_imponible: 76.27,
    igv: 13.73,
    importe_total: 90,
    sede_nombre_snapshot: 'SURCO',
    sede_telefono_snapshot: '717-3131',
    sede_correo_snapshot: 'surco@faregas.pe',
    codigo_descuento_snapshot: null,
    ...overrides
});

const certificado = {
    id: 527,
    tipo_certificado_clave: 'GLP_ANUAL',
    numero_certificado: null
};

const vehiculo = {
    placa: 'ABC123',
    clase: 'AUTOMOVIL',
    marca: 'TOYOTA',
    modelo: 'YARIS',
    numero_motor: 'MOTOR123'
};

const detalle = (overrides = {}) => ({
    unidad_snapshot: 'ZZ',
    codigo_sku_snapshot: 'GLP-ANUAL',
    codigo_sunat_snapshot: '78181500',
    descripcion_snapshot: 'CERTIFICADO ANUAL GLP',
    cantidad: 1,
    valor_unitario: 76.27,
    precio_unitario: 90,
    descuento: 0,
    base_imponible: 76.27,
    afectacion_igv_snapshot: '10',
    igv: 13.73,
    importe_total: 90,
    ...overrides
});

const resumen = (overrides = {}) => ({
    totales: {
        precioAntesDescuento: 90,
        descuento: 0,
        baseImponible: 76.27,
        igv: 13.73,
        total: 90,
        ...(overrides.totales || {})
    }
});

const payload = ({ facturacion = facturacionBase(), detalles = [detalle()], cuotas = [], resumenTributario = resumen() } = {}) => construirPayloadNubefact({
    facturacion,
    certificado,
    vehiculo,
    detalles,
    cuotas,
    resumenTributario
});

test('boleta al contado usa campos nativos y no inventa OT ni número de certificado', () => {
    const result = payload();

    assert.equal(result.tipo_de_comprobante, 2);
    assert.equal(result.fecha_de_emision, '14-10-2026');
    assert.equal(result.condiciones_de_pago, 'CONTADO');
    assert.equal(result.cancelado, true);
    assert.equal(result.placa_vehiculo, 'ABC123');
    assert.equal(result.orden_compra_servicio, '');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].codigo, 'GLP-ANUAL');
    assert.equal(result.items[0].codigo_producto_sunat, '78181500');
    assert.equal(result.total_gravada, 76.27);
    assert.equal(result.total_igv, 13.73);
    assert.equal(result.total, 90);
    assert.match(result.observaciones, /PUNTO DE VENTA: FAREGAS - SURCO/);
    assert.match(result.observaciones, /VEHÍCULO: PLACA ABC123.*MARCA TOYOTA.*MODELO YARIS.*MOTOR MOTOR123/);
    assert.match(result.observaciones, /REFERENCIA FAREGAS: BORRADOR 527/);
    assert.doesNotMatch(result.observaciones, /NÚMERO DE CERTIFICADO/);
    assert.doesNotMatch(result.observaciones, /ORDEN DE TRABAJO|\bOT\b/);
});

test('factura al contado conserva RUC, dirección fiscal y detalle tributario', () => {
    const result = payload({
        facturacion: facturacionBase({
            tipo_comprobante: 'FACTURA',
            tipo_documento_cliente: 'RUC',
            nro_documento: '20521536463',
            nombre_razon_social: 'EMPRESA DE PRUEBA S.A.C.',
            serie: 'FE12',
            numero: 1516
        })
    });

    assert.equal(result.tipo_de_comprobante, 1);
    assert.equal(result.cliente_tipo_de_documento, 6);
    assert.equal(result.cliente_numero_de_documento, '20521536463');
    assert.equal(result.cliente_direccion, 'AV. PRUEBA 123');
    assert.deepEqual(result.items.map(item => [item.cantidad, item.unidad_de_medida, item.descripcion, item.valor_unitario, item.precio_unitario, item.total]), [
        [1, 'ZZ', 'CERTIFICADO ANUAL GLP', 76.27, 90, 90]
    ]);
});

test('boleta con tarjeta conserva el medio de pago registrado', () => {
    const result = payload({
        facturacion: facturacionBase({ medio_pago: 'TARJETA' })
    });

    assert.equal(result.medio_de_pago, 'TARJETA');
    assert.equal(result.cancelado, true);
    assert.deepEqual(result.venta_al_credito, []);
});

test('factura a crédito envía vencimiento y cuotas como estructura nativa', () => {
    const result = payload({
        facturacion: facturacionBase({
            tipo_comprobante: 'FACTURA',
            tipo_documento_cliente: 'RUC',
            nro_documento: '20521536463',
            condicion_pago: 'CREDITO',
            medio_pago: 'CREDITO',
            fecha_vencimiento: '2026-11-14'
        }),
        cuotas: [
            { numero_cuota: 1, fecha_pago: '2026-10-31', importe: 40 },
            { numero_cuota: 2, fecha_pago: '2026-11-14', importe: 50 }
        ]
    });

    assert.equal(result.fecha_de_vencimiento, '14-11-2026');
    assert.equal(result.condiciones_de_pago, 'CREDITO');
    assert.equal(result.cancelado, false);
    assert.deepEqual(result.venta_al_credito, [
        { cuota: 1, fecha_de_pago: '31-10-2026', importe: 40 },
        { cuota: 2, fecha_de_pago: '14-11-2026', importe: 50 }
    ]);
});

test('descuento conserva importes estructurados y añade el código como información adicional', () => {
    const result = payload({
        facturacion: facturacionBase({ codigo_descuento_snapshot: 'CUPONCITO' }),
        detalles: [detalle({
            valor_unitario: 67.8,
            precio_unitario: 80,
            descuento: 25.42,
            base_imponible: 42.38,
            igv: 7.62,
            importe_total: 50
        })],
        resumenTributario: resumen({
            totales: {
                precioAntesDescuento: 80,
                descuento: 30,
                baseImponible: 42.38,
                igv: 7.62,
                total: 50
            }
        })
    });

    assert.equal(result.total_descuento, 30);
    assert.equal(result.total_gravada, 42.38);
    assert.equal(result.total_igv, 7.62);
    assert.equal(result.total, 50);
    assert.equal(result.items[0].descuento, 25.42);
    assert.match(result.observaciones, /CÓDIGO DE DESCUENTO: CUPONCITO/);
});

test('la matriz documenta qué puede representarse de forma nativa', () => {
    assert.equal(MATRIZ_INFORMACION_PDF.placa, 'NATIVO');
    assert.equal(MATRIZ_INFORMACION_PDF.codigoDescuento, 'INFORMACION_ADICIONAL');
    assert.equal(MATRIZ_INFORMACION_PDF.ordenTrabajo, 'NO_DISPONIBLE');
    assert.equal(MATRIZ_INFORMACION_PDF.numeroCertificadoAntesDeEmitir, 'NO_DISPONIBLE');
});

test('la migración sólo amplía facturación y no reescribe comprobantes históricos', () => {
    const sql = fs.readFileSync(path.join(
        __dirname,
        '../database/migrations/20261014_faregas_facturacion_snapshot_operativo.sql'
    ), 'utf8');

    assert.match(sql, /ALTER TABLE fg_facturacion/i);
    assert.match(sql, /fecha_documento DATE NULL/i);
    assert.match(sql, /codigo_descuento_snapshot/i);
    assert.doesNotMatch(sql, /\bUPDATE\b/i);
    assert.doesNotMatch(sql, /\bDELETE\b/i);
});

test('fecha_de_emision tolera Date objects de pg y cadenas ISO sin enviar formato en inglés a Nubefact', () => {
    const fechaDate = new Date('2026-10-14T05:00:00.000Z');
    const resultConDate = payload({
        facturacion: facturacionBase({ fecha_documento: fechaDate })
    });
    assert.equal(resultConDate.fecha_de_emision, '14-10-2026');
    assert.doesNotMatch(resultConDate.fecha_de_emision, /[a-zA-Z]/);

    const resultConCadenaIso = payload({
        facturacion: facturacionBase({ fecha_documento: '2026-10-14' })
    });
    assert.equal(resultConCadenaIso.fecha_de_emision, '14-10-2026');

    const resultConFechaInvalida = payload({
        facturacion: facturacionBase({ fecha_documento: 'invalida' })
    });
    assert.match(resultConFechaInvalida.fecha_de_emision, /^\d{2}-\d{2}-\d{4}$/);
});
