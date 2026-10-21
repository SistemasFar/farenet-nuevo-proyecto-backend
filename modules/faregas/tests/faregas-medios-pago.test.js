const test = require('node:test');
const assert = require('node:assert/strict');

const {
    resolverNombreMedioPago,
    agruparDesglosePagos,
    derivarMedioPago
} = require('../services/faregas-facturacion.rules');

const {
    resolverFormaPagoYDetalle,
    parseDetallePagosDesdeTexto,
    mapearFormaPago
} = require('../services/faregas-comprobante-impreso.service');

const {
    construirPayloadNubefact
} = require('../integrations/nubefact-faregas.adapter');

const {
    renderBoletaHtml
} = require('../templates/comprobante-boleta.template');

const {
    renderFacturaHtml
} = require('../templates/comprobante-factura.template');

// Helper base para facturación en pruebas
const fixtureFacturacion = (overrides = {}) => ({
    id: 801,
    certificado_id: 650,
    operacion_id: 500,
    tipo_comprobante: 'BOLETA',
    serie: 'BBB1',
    numero: 250,
    nro_documento: '74045612',
    tipo_documento_cliente: 'DNI',
    nombre_razon_social: 'GRACE PRUEBA',
    direccion: 'CALLE AREQUIPA 152',
    email: 'grace@example.com',
    telefono: '999888777',
    condicion_pago: 'CONTADO',
    medio_pago: 'EFECTIVO',
    fecha_documento: '2026-10-21',
    fecha_vencimiento: null,
    base_imponible: 84.75,
    igv: 15.25,
    importe_total: 100.00,
    sede_nombre_snapshot: 'FAREGAS - SURCO',
    sede_telefono_snapshot: '(01) 717-3131',
    sede_correo_snapshot: 'surco@faregas.pe',
    veh_placa: 'ABC123',
    veh_marca: 'TOYOTA',
    veh_modelo: 'YARIS',
    veh_clase: 'AUTOMOVIL',
    veh_motor: 'HZ1110WKR295C0031',
    ...overrides
});

const fixtureItems = [
    {
        codigo_sku_snapshot: '0127',
        descripcion_snapshot: 'CERTIFICADO DE CONFORMIDAD DE PESADOS',
        unidad_snapshot: 'NIU',
        cantidad: 1,
        valor_unitario: 84.75,
        precio_unitario: 100.00,
        total: 100.00
    }
];

// =============================================================================
// PRUEBAS OBLIGATORIAS (SECCIÓN 12)
// =============================================================================

test('1. YAPE por S/ 100.00 se identifica específicamente en reglas, payload y PDF', () => {
    const pagos = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '7', tarjeta_nombre: 'YAPE', importe: 100.00 }
    ];

    const medioDerivado = derivarMedioPago(pagos);
    assert.equal(medioDerivado, 'YAPE');

    const resolucion = resolverFormaPagoYDetalle(fixtureFacturacion({ medio_pago: medioDerivado }), pagos);
    assert.equal(resolucion.formaPago, 'YAPE');
    assert.deepEqual(resolucion.detallePagos, []);

    const payload = construirPayloadNubefact({
        facturacion: fixtureFacturacion({ medio_pago: medioDerivado }),
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });
    assert.equal(payload.medio_de_pago, 'YAPE');
    assert.equal(payload.condiciones_de_pago, 'CONTADO');

    const html = renderBoletaHtml({
        emisor: { ruc: '20521536463', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 250, formaPago: resolucion.formaPago, detallePagos: resolucion.detallePagos },
        cliente: { nombre: 'GRACE PRUEBA', tipoDoc: 'DNI', nroDoc: '74045612' },
        vehiculo: { placa: 'ABC123' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'CERTIFICADO', precioUnitario: 100, total: 100 }],
        totales: { total: 100, gravada: 84.75, igv: 15.25 }
    });
    assert.match(html, /Forma de Pago:<\/span>\s*YAPE/);
    assert.doesNotMatch(html, /Billetera Digital/);
    assert.doesNotMatch(html, /DETALLE DE PAGOS:/);
});

test('2. PLIN por S/ 100.00 se identifica específicamente en reglas, payload y PDF', () => {
    const pagos = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '8', tarjeta_nombre: 'PLIN', importe: 100.00 }
    ];

    const medioDerivado = derivarMedioPago(pagos);
    assert.equal(medioDerivado, 'PLIN');

    const resolucion = resolverFormaPagoYDetalle(fixtureFacturacion({ medio_pago: medioDerivado }), pagos);
    assert.equal(resolucion.formaPago, 'PLIN');

    const payload = construirPayloadNubefact({
        facturacion: fixtureFacturacion({ medio_pago: medioDerivado }),
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });
    assert.equal(payload.medio_de_pago, 'PLIN');

    const html = renderBoletaHtml({
        emisor: { ruc: '20521536463', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 199, formaPago: resolucion.formaPago, detallePagos: resolucion.detallePagos },
        cliente: { nombre: 'GRACE', tipoDoc: 'DNI', nroDoc: '74045612' },
        vehiculo: { placa: 'ABC123' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'CONFORMIDAD', precioUnitario: 100, total: 100 }],
        totales: { total: 100, gravada: 84.75, igv: 15.25 }
    });
    assert.match(html, /Forma de Pago:<\/span>\s*PLIN/);
    assert.doesNotMatch(html, /Billetera Digital/);
});

test('3. VISA por S/ 100.00 se identifica como TARJETA VISA', () => {
    const pagos = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '3', tarjeta_nombre: 'VISA', importe: 100.00 }
    ];

    const medioDerivado = derivarMedioPago(pagos);
    assert.equal(medioDerivado, 'TARJETA VISA');

    const resolucion = resolverFormaPagoYDetalle(fixtureFacturacion({ medio_pago: medioDerivado }), pagos);
    assert.equal(resolucion.formaPago, 'TARJETA VISA');

    const payload = construirPayloadNubefact({
        facturacion: fixtureFacturacion({ medio_pago: medioDerivado }),
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });
    assert.equal(payload.medio_de_pago, 'TARJETA VISA');
});

test('4. MASTERCARD por S/ 100.00 se identifica como TARJETA MASTERCARD', () => {
    const pagos = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '4', tarjeta_nombre: 'MASTERCARD', importe: 100.00 }
    ];

    const medioDerivado = derivarMedioPago(pagos);
    assert.equal(medioDerivado, 'TARJETA MASTERCARD');

    const resolucion = resolverFormaPagoYDetalle(fixtureFacturacion({ medio_pago: medioDerivado }), pagos);
    assert.equal(resolucion.formaPago, 'TARJETA MASTERCARD');

    const payload = construirPayloadNubefact({
        facturacion: fixtureFacturacion({ medio_pago: medioDerivado }),
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });
    assert.equal(payload.medio_de_pago, 'TARJETA MASTERCARD');
});

test('5. Efectivo por S/ 100.00 se identifica como EFECTIVO', () => {
    const pagos = [
        { tipocontado_key: 'efectivo', importe: 100.00 }
    ];

    const medioDerivado = derivarMedioPago(pagos);
    assert.equal(medioDerivado, 'EFECTIVO');

    const resolucion = resolverFormaPagoYDetalle(fixtureFacturacion({ medio_pago: medioDerivado }), pagos);
    assert.equal(resolucion.formaPago, 'EFECTIVO');

    const payload = construirPayloadNubefact({
        facturacion: fixtureFacturacion({ medio_pago: medioDerivado }),
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });
    assert.equal(payload.medio_de_pago, 'EFECTIVO');
});

test('6. Transferencia bancaria por S/ 100.00 se identifica como TRANSFERENCIA BANCARIA', () => {
    const pagos = [
        { tipocontado_key: 'banco', entidad_nombre: 'BCP', importe: 100.00 }
    ];

    const medioDerivado = derivarMedioPago(pagos);
    assert.equal(medioDerivado, 'TRANSFERENCIA BANCARIA');

    const resolucion = resolverFormaPagoYDetalle(fixtureFacturacion({ medio_pago: medioDerivado }), pagos);
    assert.equal(resolucion.formaPago, 'TRANSFERENCIA BANCARIA');

    const payload = construirPayloadNubefact({
        facturacion: fixtureFacturacion({ medio_pago: medioDerivado }),
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });
    assert.equal(payload.medio_de_pago, 'TRANSFERENCIA BANCARIA');
});

test('7. Pago mixto YAPE S/ 60.00 + EFECTIVO S/ 40.00 se desglosa en NubeFact y PDF', () => {
    const pagos = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '7', tarjeta_nombre: 'YAPE', importe: 60.00 },
        { tipocontado_key: 'efectivo', importe: 40.00 }
    ];

    const medioDerivado = derivarMedioPago(pagos);
    assert.equal(medioDerivado, 'MIXTO: YAPE S/ 60.00, EFECTIVO S/ 40.00');

    const resolucion = resolverFormaPagoYDetalle(fixtureFacturacion({ medio_pago: medioDerivado }), pagos);
    assert.equal(resolucion.formaPago, 'MIXTO');
    assert.deepEqual(resolucion.detallePagos, [
        { medio: 'YAPE', importe: 60.00 },
        { medio: 'EFECTIVO', importe: 40.00 }
    ]);

    const payload = construirPayloadNubefact({
        facturacion: fixtureFacturacion({ medio_pago: medioDerivado }),
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });
    assert.equal(payload.medio_de_pago, 'MIXTO: YAPE S/ 60.00, EFECTIVO S/ 40.00');
    assert.match(payload.observaciones, /DETALLE DE PAGOS: YAPE S\/ 60\.00 · EFECTIVO S\/ 40\.00/);

    const html = renderBoletaHtml({
        emisor: { ruc: '20521536463', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 251, formaPago: resolucion.formaPago, detallePagos: resolucion.detallePagos },
        cliente: { nombre: 'CLIENTE MIXTO', tipoDoc: 'DNI', nroDoc: '11223344' },
        vehiculo: { placa: 'ABC123' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'CERTIFICADO', precioUnitario: 100, total: 100 }],
        totales: { total: 100, gravada: 84.75, igv: 15.25 }
    });
    assert.match(html, /Forma de Pago:<\/span>\s*MIXTO/);
    assert.match(html, /DETALLE DE PAGOS:/);
    assert.match(html, /-\s*YAPE:\s*S\/\s*60\.00/);
    assert.match(html, /-\s*EFECTIVO:\s*S\/\s*40\.00/);
});

test('8. Pago mixto VISA S/ 50.00 + PLIN S/ 30.00 + EFECTIVO S/ 20.00 muestra los tres medios e importes', () => {
    const pagos = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '3', tarjeta_nombre: 'VISA', importe: 50.00 },
        { tipocontado_key: 'tarjeta', tarjeta_key: '8', tarjeta_nombre: 'PLIN', importe: 30.00 },
        { tipocontado_key: 'efectivo', importe: 20.00 }
    ];

    const medioDerivado = derivarMedioPago(pagos);
    assert.equal(medioDerivado, 'MIXTO: TARJETA VISA S/ 50.00, PLIN S/ 30.00, EFECTIVO S/ 20.00');

    const resolucion = resolverFormaPagoYDetalle(fixtureFacturacion({ medio_pago: medioDerivado }), pagos);
    assert.equal(resolucion.formaPago, 'MIXTO');
    assert.equal(resolucion.detallePagos.length, 3);
    assert.deepEqual(resolucion.detallePagos, [
        { medio: 'TARJETA VISA', importe: 50.00 },
        { medio: 'PLIN', importe: 30.00 },
        { medio: 'EFECTIVO', importe: 20.00 }
    ]);

    const payload = construirPayloadNubefact({
        facturacion: fixtureFacturacion({ medio_pago: medioDerivado }),
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });
    assert.equal(payload.medio_de_pago, 'MIXTO: TARJETA VISA S/ 50.00, PLIN S/ 30.00, EFECTIVO S/ 20.00');
    assert.match(payload.observaciones, /DETALLE DE PAGOS: TARJETA VISA S\/ 50\.00 · PLIN S\/ 30\.00 · EFECTIVO S\/ 20\.00/);

    const html = renderFacturaHtml({
        emisor: { ruc: '20521536463', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'FACTURA', serie: 'FFF1', numero: 100, formaPago: resolucion.formaPago, detallePagos: resolucion.detallePagos },
        cliente: { nombre: 'EMPRESA TEST S.A.C.', tipoDoc: 'RUC', nroDoc: '20600123456', direccion: 'AV. LIMA 123' },
        vehiculo: { placa: 'ABC123' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'SERVICIO', precioUnitario: 100, total: 100 }],
        totales: { total: 100, gravada: 84.75, igv: 15.25 }
    });
    assert.match(html, /Forma de Pago:<\/span>\s*MIXTO/);
    assert.match(html, /-\s*TARJETA VISA:\s*S\/\s*50\.00/);
    assert.match(html, /-\s*PLIN:\s*S\/\s*30\.00/);
    assert.match(html, /-\s*EFECTIVO:\s*S\/\s*20\.00/);
});

test('9. Dos pagos con YAPE (S/ 30.00 + S/ 20.00) se consolidan como YAPE S/ 50.00 y NO se marcan como MIXTO', () => {
    const pagos = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '7', tarjeta_nombre: 'YAPE', importe: 30.00 },
        { tipocontado_key: 'tarjeta', tarjeta_key: '7', tarjeta_nombre: 'YAPE', importe: 20.00 }
    ];

    const medioDerivado = derivarMedioPago(pagos);
    assert.equal(medioDerivado, 'YAPE', 'Dos pagos del mismo medio no deben ser MIXTO');

    const resolucion = resolverFormaPagoYDetalle(fixtureFacturacion({ medio_pago: medioDerivado }), pagos);
    assert.equal(resolucion.formaPago, 'YAPE');
    assert.deepEqual(resolucion.detallePagos, []);

    const payload = construirPayloadNubefact({
        facturacion: fixtureFacturacion({ medio_pago: medioDerivado }),
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });
    assert.equal(payload.medio_de_pago, 'YAPE');
    assert.doesNotMatch(payload.observaciones, /DETALLE DE PAGOS/);
});

test('10. Boleta electrónica renderiza forma de pago específica', () => {
    const html = renderBoletaHtml({
        emisor: { ruc: '20521536463', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 199, formaPago: 'PLIN', detallePagos: [] },
        cliente: { nombre: 'GRACE', tipoDoc: 'DNI', nroDoc: '74045612' },
        vehiculo: { placa: 'ABC123' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'CERTIFICADO', precioUnitario: 100, total: 100 }],
        totales: { total: 100, gravada: 84.75, igv: 15.25 }
    });
    assert.match(html, /Forma de Pago:<\/span>\s*PLIN/);
});

test('11. Factura electrónica al contado muestra medio de pago específico y NO el término genérico Contado', () => {
    const pagos = [{ tipocontado_key: 'tarjeta', tarjeta_key: '3', tarjeta_nombre: 'VISA', importe: 100.00 }];
    const resolucion = resolverFormaPagoYDetalle(
        fixtureFacturacion({ tipo_comprobante: 'FACTURA', condicion_pago: 'CONTADO', medio_pago: 'TARJETA VISA' }),
        pagos
    );
    assert.equal(resolucion.formaPago, 'TARJETA VISA');

    const html = renderFacturaHtml({
        emisor: { ruc: '20521536463', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'FACTURA', serie: 'FFF1', numero: 50, formaPago: resolucion.formaPago, detallePagos: [] },
        cliente: { nombre: 'CLIENTE EMPRESA', tipoDoc: 'RUC', nroDoc: '20100000001', direccion: 'AV. CENTRAL 100' },
        vehiculo: { placa: 'ABC123' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'REVISION', precioUnitario: 100, total: 100 }],
        totales: { total: 100, gravada: 84.75, igv: 15.25 }
    });
    assert.match(html, /Forma de Pago:<\/span>\s*TARJETA VISA/);
});

test('12. Factura al crédito conserva su condición de crédito, cuotas y no inventa medio pagado', () => {
    const cuotas = [
        { numero_cuota: 1, fecha_pago: '2026-11-15', importe: 60.00 },
        { numero_cuota: 2, fecha_pago: '2026-11-30', importe: 40.00 }
    ];
    const facturacion = fixtureFacturacion({
        tipo_comprobante: 'FACTURA',
        condicion_pago: 'CREDITO',
        medio_pago: null,
        fecha_vencimiento: '2026-11-30'
    });

    const resolucion = resolverFormaPagoYDetalle(facturacion, []);
    assert.equal(resolucion.formaPago, 'Crédito');
    assert.deepEqual(resolucion.detallePagos, []);

    const payload = construirPayloadNubefact({
        facturacion,
        cuotas,
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });
    assert.equal(payload.condiciones_de_pago, 'CREDITO');
    assert.equal(payload.medio_de_pago, 'credito');
    assert.equal(payload.cancelado, false);
    assert.equal(payload.venta_al_credito.length, 2);

    const html = renderFacturaHtml({
        emisor: { ruc: '20521536463', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'FACTURA', serie: 'FFF1', numero: 80, formaPago: resolucion.formaPago, detallePagos: [] },
        cliente: { nombre: 'CLIENTE CREDITO', tipoDoc: 'RUC', nroDoc: '20100000001', direccion: 'CALLE 1' },
        vehiculo: { placa: 'ABC123' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'SERVICIO', precioUnitario: 100, total: 100 }],
        totales: { total: 100, gravada: 84.75, igv: 15.25 },
        cuotas
    });
    assert.match(html, /Forma de Pago:<\/span>\s*Crédito/);
    assert.match(html, /Cuota:/);
    assert.doesNotMatch(html, /DETALLE DE PAGOS:/);
});

test('13. Duplicado de certificado: resuelve medios de pago desde la operación vinculada', () => {
    const pagosDuplicado = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '8', tarjeta_nombre: 'PLIN', importe: 50.00 }
    ];
    const facturacionDuplicado = fixtureFacturacion({
        certificado_id: null,
        operacion_id: 999,
        medio_pago: derivarMedioPago(pagosDuplicado),
        importe_total: 50.00
    });

    const resolucion = resolverFormaPagoYDetalle(facturacionDuplicado, pagosDuplicado);
    assert.equal(resolucion.formaPago, 'PLIN');
});

test('14. Venta directa: resuelve medios de pago mixtos desde fg_orden_pago', () => {
    const pagosVentaDirecta = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '4', tarjeta_nombre: 'MASTERCARD', importe: 70.00 },
        { tipocontado_key: 'efectivo', importe: 30.00 }
    ];
    const facturacionVentaDirecta = fixtureFacturacion({
        certificado_id: null,
        operacion_id: 1001,
        medio_pago: derivarMedioPago(pagosVentaDirecta),
        importe_total: 100.00
    });

    const resolucion = resolverFormaPagoYDetalle(facturacionVentaDirecta, pagosVentaDirecta);
    assert.equal(resolucion.formaPago, 'MIXTO');
    assert.equal(resolucion.detallePagos.length, 2);
    assert.equal(resolucion.detallePagos[0].medio, 'TARJETA MASTERCARD');
    assert.equal(resolucion.detallePagos[1].medio, 'EFECTIVO');
});

test('15. Recuperación de pagos registrados: resuelve nombre por tarjeta_key cuando tarjeta_nombre no viene de BD', () => {
    const pagoSinNombre = { tipocontado_key: 'tarjeta', tarjeta_key: '7', importe: 100.00 };
    assert.equal(resolverNombreMedioPago(pagoSinNombre), 'YAPE');

    const pagoPlinSinNombre = { tipocontado_key: 'tarjeta', tarjeta_key: '8', importe: 100.00 };
    assert.equal(resolverNombreMedioPago(pagoPlinSinNombre), 'PLIN');

    const pagoVisaSinNombre = { tipocontado_key: 'tarjeta', tarjeta_key: '3', importe: 100.00 };
    assert.equal(resolverNombreMedioPago(pagoVisaSinNombre), 'TARJETA VISA');

    const pagoMasterSinNombre = { tipocontado_key: 'tarjeta', tarjeta_key: '4', importe: 100.00 };
    assert.equal(resolverNombreMedioPago(pagoMasterSinNombre), 'TARJETA MASTERCARD');

    const pagoCuponidad = { tipocontado_key: 'tarjeta', tarjeta_key: '5', importe: 100.00 };
    assert.equal(resolverNombreMedioPago(pagoCuponidad), 'CUPONIDAD');

    const pagoWeb = { tipocontado_key: 'tarjeta', tarjeta_key: '6', importe: 100.00 };
    assert.equal(resolverNombreMedioPago(pagoWeb), 'PAGO WEB');
});

test('16. Payload NubeFact simulado: medio_de_pago respeta formato y no excede 250 caracteres', () => {
    const pagos = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '3', tarjeta_nombre: 'VISA', importe: 50.00 },
        { tipocontado_key: 'tarjeta', tarjeta_key: '8', tarjeta_nombre: 'PLIN', importe: 30.00 },
        { tipocontado_key: 'efectivo', importe: 20.00 }
    ];
    const medioPago = derivarMedioPago(pagos);
    assert.ok(medioPago.length <= 250);

    const payload = construirPayloadNubefact({
        facturacion: fixtureFacturacion({ medio_pago: medioPago }),
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });
    assert.equal(payload.medio_de_pago, 'MIXTO: TARJETA VISA S/ 50.00, PLIN S/ 30.00, EFECTIVO S/ 20.00');
    assert.ok(payload.medio_de_pago.length <= 250);
});

test('17. PDF propio: renderiza detalle y totales coincidentes', () => {
    const detallePagos = [
        { medio: 'YAPE', importe: 60.00 },
        { medio: 'EFECTIVO', importe: 40.00 }
    ];
    const sumaDetalle = detallePagos.reduce((acc, d) => acc + d.importe, 0);
    assert.equal(sumaDetalle, 100.00);

    const html = renderBoletaHtml({
        emisor: { ruc: '20521536463', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 200, formaPago: 'MIXTO', detallePagos },
        cliente: { nombre: 'CLIENTE TEST', tipoDoc: 'DNI', nroDoc: '88888888' },
        vehiculo: { placa: 'ABC123' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'SERVICIO', precioUnitario: 100, total: 100 }],
        totales: { total: 100, gravada: 84.75, igv: 15.25 }
    });

    assert.match(html, /Forma de Pago:<\/span>\s*MIXTO/);
    assert.match(html, /DETALLE DE PAGOS:/);
    assert.match(html, /-\s*YAPE:\s*S\/\s*60\.00/);
    assert.match(html, /-\s*EFECTIVO:\s*S\/\s*40\.00/);
});

test('18. Comprobación de consistencia entre datos persistidos y representación', () => {
    const pagosPersistidos = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '7', tarjeta_nombre: 'YAPE', importe: 100.00 }
    ];
    const medioPersistido = derivarMedioPago(pagosPersistidos);
    const facturacionPersistida = fixtureFacturacion({ medio_pago: medioPersistido });

    const resolucionPdf = resolverFormaPagoYDetalle(facturacionPersistida, pagosPersistidos);
    const payloadNubeFact = construirPayloadNubefact({
        facturacion: facturacionPersistida,
        items: fixtureItems,
        certificadoData: { id: 650 },
        vehiculoData: { placa: 'ABC123' }
    });

    assert.equal(resolucionPdf.formaPago, 'YAPE');
    assert.equal(payloadNubeFact.medio_de_pago, 'YAPE');
    assert.equal(resolucionPdf.formaPago, payloadNubeFact.medio_de_pago);
});

test('19. Operación sin medio específico histórico: conserva descriptor histórico sin inventar marca', () => {
    // Si históricamente se almacenó 'TARJETA' sin marca
    const resolucionTarjeta = resolverFormaPagoYDetalle(fixtureFacturacion({ medio_pago: 'TARJETA' }), []);
    assert.equal(resolucionTarjeta.formaPago, 'TARJETA');
    assert.doesNotMatch(resolucionTarjeta.formaPago, /VISA|MASTERCARD|YAPE|PLIN/);

    // Si históricamente se almacenó 'Billetera Digital' sin marca
    const resolucionBilletera = resolverFormaPagoYDetalle(fixtureFacturacion({ medio_pago: 'Billetera Digital' }), []);
    assert.equal(resolucionBilletera.formaPago, 'Billetera Digital');
    assert.doesNotMatch(resolucionBilletera.formaPago, /YAPE|PLIN/);
});

test('20. Prevención de dobles contabilizaciones: desglose agrupa montos sin duplicar', () => {
    const pagosRepetidos = [
        { tipocontado_key: 'tarjeta', tarjeta_key: '7', tarjeta_nombre: 'YAPE', importe: 30.00 },
        { tipocontado_key: 'tarjeta', tarjeta_key: '7', tarjeta_nombre: 'YAPE', importe: 20.00 },
        { tipocontado_key: 'efectivo', importe: 50.00 }
    ];

    const desglose = agruparDesglosePagos(pagosRepetidos);
    assert.equal(desglose.length, 2, 'Deben haber exactamente 2 grupos (YAPE y EFECTIVO)');

    const grupoYape = desglose.find(g => g.medio === 'YAPE');
    const grupoEfectivo = desglose.find(g => g.medio === 'EFECTIVO');

    assert.equal(grupoYape.importe, 50.00);
    assert.equal(grupoYape.cantidad, 2);
    assert.equal(grupoEfectivo.importe, 50.00);
    assert.equal(grupoEfectivo.cantidad, 1);

    const totalCalculado = desglose.reduce((acc, g) => acc + g.importe, 0);
    assert.equal(totalCalculado, 100.00, 'La suma debe ser exactamente 100.00 sin duplicaciones');
});

test.after(async () => {
    const db = require('../../../config/database');
    if (db && typeof db.end === 'function') {
        await db.end();
    }
});
