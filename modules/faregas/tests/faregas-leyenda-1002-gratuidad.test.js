const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../config/env-loader').loadEnv(true);

const {
    construirPayloadNubefact
} = require('../integrations/nubefact-faregas.adapter');
const {
    construirInformacionAdicional
} = require('../integrations/nubefact-faregas-informacion-adicional');
const {
    renderBoletaHtml
} = require('../templates/comprobante-boleta.template');
const {
    renderFacturaHtml
} = require('../templates/comprobante-factura.template');

const facturacionBase = (overrides = {}) => ({
    id: 801,
    tipo_comprobante: 'BOLETA',
    tipo_documento_cliente: 'DNI',
    nro_documento: '74045612',
    nombre_razon_social: 'JUAN PEREZ TALLER',
    direccion: 'AV. LOS TALLERES 123',
    email: 'taller@example.com',
    condicion_pago: 'CONTADO',
    medio_pago: '',
    fecha_documento: '2026-10-22',
    fecha_vencimiento: null,
    serie: 'BBB1',
    numero: 215,
    base_imponible: 0,
    igv: 0,
    importe_total: 0,
    sede_nombre_snapshot: 'FAREGAS - SURCO',
    sede_telefono_snapshot: '(01) 717-3131',
    codigo_descuento_snapshot: 'DESCUENTO_TALLER',
    ...overrides
});

const certificadoTaller = (sku, overrides = {}) => ({
    id: 660,
    tipo_certificado_clave: sku === '0423' ? 'GNV_TALLER' : 'GLP_TALLER',
    tarifa_codigo: sku,
    numero_certificado: '41-0000999',
    servicio_tipo_flujo: 'TALLER_INSPECCION',
    formato_datos_snapshot: {
        taller: {
            nombre: 'TALLER MECÁNICO AUTORIZADO S.A.C.',
            direccion: 'CALLE TALLERES 456'
        }
    },
    ...overrides
});

const detalleTaller = (sku, descripcion, tarifa = 350.00) => ({
    producto_facturacion_id: 50,
    unidad_snapshot: 'NIU',
    codigo_sku_snapshot: sku,
    codigo_sunat_snapshot: '78181500',
    descripcion_snapshot: descripcion,
    cantidad: 1,
    valor_unitario: Number((tarifa / 1.18).toFixed(2)),
    precio_unitario: tarifa,
    descuento: Number((tarifa / 1.18).toFixed(2)),
    base_imponible: 0,
    afectacion_igv_snapshot: '10',
    igv: 0,
    importe_total: 0
});

const resumenTaller = (tarifa = 350.00) => ({
    cliente: { numeroDocumento: '74045612', nombreRazonSocial: 'JUAN PEREZ TALLER' },
    comprobante: { serie: 'BBB1', numero: 215 },
    emisor: { ruc: '20600444531', razonSocial: 'FAREGAS S.A.C.' },
    totales: {
        precioAntesDescuento: tarifa,
        descuento: 0.00,
        baseImponible: 0.00,
        igv: 0.00,
        total: 0.00,
        gratuita: tarifa
    },
    descuento: {
        codigo: 'DESCUENTO_TALLER',
        importeOriginal: tarifa,
        importe: 0.00,
        importeFinal: 0.00,
        autorizacionGratuita: true,
        importeReferencialGratuito: tarifa
    }
});

// =========================================================================
// 1. Boleta gratuita del producto 0423 (GNV)
// =========================================================================
test('1. Boleta gratuita del producto 0423 (GNV): tarifa 350, exigible 0, payload y leyendas consistentes', () => {
    const facturacion = facturacionBase();
    const certificado = certificadoTaller('0423');
    const detalles = [detalleTaller('0423', 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GNV', 350.00)];
    const resumen = resumenTaller(350.00);

    const payload = construirPayloadNubefact({
        facturacion,
        certificado,
        reservaDescuento: { codigo_autorizacion: 'DESCUENTO_TALLER' },
        detalles,
        resumenTributario: resumen
    });

    assert.equal(payload.tipo_de_comprobante, 2); // Boleta
    assert.equal(payload.total_gratuita, 350.00); // Operación gratuita: S/ 350.00
    assert.equal(payload.total, 0.00); // Total exigible: S/ 0.00
    assert.equal(payload.total_descuento, 0.00); // Descuento comercial: S/ 0.00
    assert.equal(payload.total_gravada, 0.00);
    assert.equal(payload.total_igv, 0.00);
    assert.equal(payload.cancelado, true);

    // Ítem
    assert.equal(payload.items.length, 1);
    const item = payload.items[0];
    assert.equal(item.codigo, '0423');
    assert.equal(item.tipo_de_igv, 6); // Gravado - Retiro o transferencia gratuita
    assert.equal(item.precio_unitario, 350.00); // Valor referencial unitario
    assert.equal(item.total, 350.00);

    // Leyenda tributaria SUNAT 1002
    assert.ok(Array.isArray(payload.leyendas));
    assert.equal(payload.leyendas.length, 1);
    assert.equal(payload.leyendas[0].codigo, '1002');
    assert.equal(payload.leyendas[0].valor, 'TRANSFERENCIA GRATUITA DE UN BIEN Y/O SERVICIO PRESTADO GRATUITAMENTE');

    // Observaciones comerciales no deben contener código administrativo DESCUENTO_TALLER
    assert.doesNotMatch(payload.observaciones, /DESCUENTO_TALLER/);
});

// =========================================================================
// 2. Boleta gratuita del producto 0422 (GLP)
// =========================================================================
test('2. Boleta gratuita del producto 0422 (GLP): tarifa 350, exigible 0, leyenda 1002 presente', () => {
    const facturacion = facturacionBase();
    const certificado = certificadoTaller('0422');
    const detalles = [detalleTaller('0422', 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GLP', 350.00)];
    const resumen = resumenTaller(350.00);

    const payload = construirPayloadNubefact({
        facturacion,
        certificado,
        reservaDescuento: { codigo_autorizacion: 'DESCUENTO_TALLER' },
        detalles,
        resumenTributario: resumen
    });

    assert.equal(payload.total_gratuita, 350.00);
    assert.equal(payload.total, 0.00);
    assert.equal(payload.total_descuento, 0.00);
    assert.equal(payload.items[0].tipo_de_igv, 6);
    assert.equal(payload.leyendas[0].codigo, '1002');
    assert.doesNotMatch(payload.observaciones, /DESCUENTO_TALLER/);
});

// =========================================================================
// 3. Leyenda 1002 completa en PDF propio (Boleta y Factura)
// =========================================================================
test('3. PDF propio presenta bloque tributario independiente con código 1002 y texto oficial completo', () => {
    const viewModel = {
        emisor: { ruc: '20600444531', razonSocial: 'FAREGAS S.A.C.', direccion: 'DIR EMISOR', puntoVenta: 'FAREGAS - SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 215, fechaDocumento: '22/10/2026', formaPago: 'Contado', detallePagos: [], moneda: 'Soles' },
        cliente: { nombre: 'JUAN PEREZ TALLER', tipoDoc: 'DNI', nroDoc: '74045612' },
        vehiculo: {},
        taller: { nombre: 'TALLER MECÁNICO AUTORIZADO S.A.C.' },
        esTaller: true,
        esOperacionGratuita: true,
        items: [{
            cantidad: 1,
            unidad: 'NIU',
            descripcion: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GNV',
            valorReferencial: 350.00,
            precioUnitario: 0.00,
            valorUnitario: 0.00,
            total: 0.00
        }],
        totales: { gravada: 0, gratuita: 350.00, descuento: 0, exonerada: 0, inafecta: 0, igv: 0, total: 0.00 },
        descuento: { codigo: 'DESCUENTO_TALLER' },
        numeroCertificado: '41-0000999'
    };

    const htmlBoleta = renderBoletaHtml(viewModel);
    // Bloque tributario independiente
    assert.match(htmlBoleta, /bloque-tributario-leyenda/);
    assert.match(htmlBoleta, /INFORMACIÓN TRIBUTARIA/);
    assert.match(htmlBoleta, /CÓDIGO SUNAT:\s*<strong>1002<\/strong>/);
    assert.match(htmlBoleta, /1002 - TRANSFERENCIA GRATUITA DE UN BIEN Y\/O SERVICIO PRESTADO GRATUITAMENTE/);
    // Franja destacada debajo de productos
    assert.match(htmlBoleta, /leyenda-gratuita/);

    // Mismo bloque en Factura
    const htmlFactura = renderFacturaHtml({ ...viewModel, comprobante: { ...viewModel.comprobante, tipo: 'FACTURA', serie: 'FFF1' } });
    assert.match(htmlFactura, /bloque-tributario-leyenda/);
    assert.match(htmlFactura, /CÓDIGO SUNAT:\s*<strong>1002<\/strong>/);
    assert.match(htmlFactura, /1002 - TRANSFERENCIA GRATUITA DE UN BIEN Y\/O SERVICIO PRESTADO GRATUITAMENTE/);
});

// =========================================================================
// 4. Importe referencial correcto según la tarifa (S/ 350.00)
// =========================================================================
test('4. Importe referencial en PDF propio coincide exactamente con la tarifa (350.00)', () => {
    const viewModel = {
        emisor: { ruc: '20600444531', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 215, fechaDocumento: '22/10/2026', formaPago: 'Contado' },
        cliente: { nombre: 'CLIENTE', tipoDoc: 'DNI', nroDoc: '74045612' },
        taller: { nombre: 'TALLER S.A.C.' },
        esTaller: true,
        esOperacionGratuita: true,
        items: [{
            cantidad: 1,
            unidad: 'NIU',
            descripcion: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GNV',
            valorReferencial: 350.00,
            precioUnitario: 0.00,
            valorUnitario: 0.00,
            total: 0.00
        }],
        totales: { gravada: 0, gratuita: 350.00, descuento: 0, exonerada: 0, inafecta: 0, igv: 0, total: 0.00 },
        descuento: { codigo: 'DESCUENTO_TALLER' }
    };
    const html = renderBoletaHtml(viewModel);
    assert.match(html, /<td class="col-num">350\.00<\/td>/); // VALOR REF.
    assert.match(html, /Op\. Gratuita<\/td>\s*<td class="t-num">S\/ 350\.00<\/td>/);
    assert.match(html, /VALOR REF\.:<\/strong> S\/ 350\.00/);
});

// =========================================================================
// 5. Total exigible S/ 0.00
// =========================================================================
test('5. Total exigible del comprobante es exactamente S/ 0.00', () => {
    const viewModel = {
        emisor: { ruc: '20600444531', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 215, fechaDocumento: '22/10/2026', formaPago: 'Contado' },
        cliente: { nombre: 'CLIENTE', tipoDoc: 'DNI', nroDoc: '74045612' },
        taller: { nombre: 'TALLER' },
        esTaller: true,
        esOperacionGratuita: true,
        items: [{ cantidad: 1, valorReferencial: 350.00, precioUnitario: 0.00, valorUnitario: 0.00, total: 0.00 }],
        totales: { gravada: 0, gratuita: 350.00, descuento: 0, igv: 0, total: 0.00 }
    };
    const html = renderBoletaHtml(viewModel);
    assert.match(html, /Importe Total<\/strong><\/td>\s*<td class="t-num"><strong>S\/ 0\.00<\/strong><\/td>/);
    assert.match(html, /TOTAL EXIGIBLE:<\/strong> S\/ 0\.00/);
    assert.match(html, /Son: Cero con 00\/100 Soles/i);
});

// =========================================================================
// 6. Descuento comercial S/ 0.00
// =========================================================================
test('6. Descuento comercial es S/ 0.00 (no se confunde con la gratuidad)', () => {
    const viewModel = {
        emisor: { ruc: '20600444531', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 215, fechaDocumento: '22/10/2026', formaPago: 'Contado' },
        cliente: { nombre: 'CLIENTE', tipoDoc: 'DNI', nroDoc: '74045612' },
        taller: { nombre: 'TALLER' },
        esTaller: true,
        esOperacionGratuita: true,
        items: [{ cantidad: 1, valorReferencial: 350.00, precioUnitario: 0.00, valorUnitario: 0.00, total: 0.00 }],
        totales: { gravada: 0, gratuita: 350.00, descuento: 0.00, igv: 0, total: 0.00 }
    };
    const html = renderBoletaHtml(viewModel);
    assert.match(html, /Descuentos<\/td>\s*<td class="t-num">S\/ 0\.00<\/td>/);
});

// =========================================================================
// 7. Importe cobrado por línea S/ 0.00
// =========================================================================
test('7. Detalle de línea en tabla: VALOR REF 350.00, PREC. UNIT. 0.00, VALOR UNIT. 0.00, V. VENTA 0.00', () => {
    const viewModel = {
        emisor: { ruc: '20600444531', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 215, fechaDocumento: '22/10/2026', formaPago: 'Contado' },
        cliente: { nombre: 'CLIENTE', tipoDoc: 'DNI', nroDoc: '74045612' },
        taller: { nombre: 'TALLER' },
        esTaller: true,
        esOperacionGratuita: true,
        items: [{
            cantidad: 1,
            unidad: 'NIU',
            descripcion: 'CERTIFICADO GNV',
            valorReferencial: 350.00,
            precioUnitario: 0.00,
            valorUnitario: 0.00,
            total: 0.00
        }],
        totales: { gravada: 0, gratuita: 350.00, descuento: 0, igv: 0, total: 0.00 }
    };
    const html = renderBoletaHtml(viewModel);
    // Regex que valida las 4 columnas de importes de la línea consecutivamente
    assert.match(html, /<td class="col-num">350\.00<\/td>\s*<td class="col-num">0\.00<\/td>\s*<td class="col-num">0\.00<\/td>\s*<td class="col-num">0\.00<\/td>/);
});

// =========================================================================
// 8. Consistencia del payload fiscal NubeFact
// =========================================================================
test('8. Payload fiscal NubeFact consistente: items, totales, afectación y leyenda 1002', () => {
    const payload = construirPayloadNubefact({
        facturacion: facturacionBase(),
        certificado: certificadoTaller('0423'),
        reservaDescuento: { codigo_autorizacion: 'DESCUENTO_TALLER' },
        detalles: [detalleTaller('0423', 'CERTIFICADO GNV', 350.00)],
        resumenTributario: resumenTaller(350.00)
    });

    assert.equal(payload.total_gratuita, 350.00);
    assert.equal(payload.total, 0.00);
    assert.equal(payload.total_gravada, 0.00);
    assert.equal(payload.total_igv, 0.00);
    assert.equal(payload.items[0].tipo_de_igv, 6);
    assert.equal(payload.leyendas[0].codigo, '1002');
    assert.equal(payload.leyendas[0].valor, 'TRANSFERENCIA GRATUITA DE UN BIEN Y/O SERVICIO PRESTADO GRATUITAMENTE');
});

// =========================================================================
// 9. PDF propio no muestra DESCUENTO_TALLER al cliente
// =========================================================================
test('9. PDF propio no muestra el código administrativo DESCUENTO_TALLER al cliente', () => {
    const viewModel = {
        emisor: { ruc: '20600444531', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 215, fechaDocumento: '22/10/2026', formaPago: 'Contado' },
        cliente: { nombre: 'CLIENTE', tipoDoc: 'DNI', nroDoc: '74045612' },
        taller: { nombre: 'TALLER' },
        esTaller: true,
        esOperacionGratuita: true,
        items: [{ cantidad: 1, valorReferencial: 350.00, precioUnitario: 0.00, valorUnitario: 0.00, total: 0.00 }],
        totales: { gravada: 0, gratuita: 350.00, descuento: 0, igv: 0, total: 0.00 },
        descuento: { codigo: 'DESCUENTO_TALLER', descripcion: 'DESCUENTO CERTIFICADO TALLER' }
    };
    const htmlBoleta = renderBoletaHtml(viewModel);
    assert.doesNotMatch(htmlBoleta, /DESCUENTO_TALLER/);
    assert.doesNotMatch(htmlBoleta, /descuento-box/);

    const htmlFactura = renderFacturaHtml({ ...viewModel, comprobante: { ...viewModel.comprobante, tipo: 'FACTURA' } });
    assert.doesNotMatch(htmlFactura, /DESCUENTO_TALLER/);
    assert.doesNotMatch(htmlFactura, /descuento-box/);
});

// =========================================================================
// 10. Observaciones NubeFact omite DESCUENTO_TALLER
// =========================================================================
test('10. Observaciones NubeFact no incluye CÓDIGO DE DESCUENTO: DESCUENTO_TALLER', () => {
    const info = construirInformacionAdicional({
        facturacion: { codigo_descuento_snapshot: 'DESCUENTO_TALLER', sede_nombre_snapshot: 'SURCO' },
        tipoFlujo: 'TALLER_INSPECCION',
        tallerNombre: 'TALLER TEST',
        gratuidadAutorizada: true
    });
    assert.doesNotMatch(info.texto, /DESCUENTO_TALLER/);
    assert.doesNotMatch(info.texto, /CÓDIGO DE DESCUENTO/);
});

// =========================================================================
// 11. Operación normal sin leyenda 1002
// =========================================================================
test('11. Operación normal onerosa no incluye leyenda 1002 ni bloque tributario gratuito', () => {
    const facturacionNormal = facturacionBase({
        base_imponible: 296.61,
        igv: 53.39,
        importe_total: 350.00,
        codigo_descuento_snapshot: null
    });
    const certificadoNormal = certificadoTaller('0423', { servicio_tipo_flujo: 'GNV_MODIFICACION' });
    const detallesNormal = [{
        producto_facturacion_id: 50,
        cantidad: 1,
        valor_unitario: 296.61,
        precio_unitario: 350.00,
        descuento: 0,
        base_imponible: 296.61,
        afectacion_igv_snapshot: '10',
        igv: 53.39,
        importe_total: 350.00
    }];

    const payload = construirPayloadNubefact({
        facturacion: facturacionNormal,
        certificado: certificadoNormal,
        detalles: detallesNormal,
        resumenTributario: {
            totales: {
                precioAntesDescuento: 350.00,
                descuento: 0.00,
                baseImponible: 296.61,
                igv: 53.39,
                total: 350.00,
                gratuita: 0.00
            }
        }
    });

    assert.equal(payload.total_gravada, 296.61);
    assert.equal(payload.total, 350.00);
    assert.equal(payload.total_gratuita, 0.00);
    assert.equal(payload.items[0].tipo_de_igv, 1);
    assert.equal(payload.leyendas.length, 0); // No hay leyenda 1002

    const html = renderBoletaHtml({
        emisor: { ruc: '20600444531', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 216, fechaDocumento: '22/10/2026', formaPago: 'Contado' },
        cliente: { nombre: 'CLIENTE', tipoDoc: 'DNI', nroDoc: '74045612' },
        esTaller: false,
        esOperacionGratuita: false,
        items: [{ cantidad: 1, valorReferencial: 350.00, precioUnitario: 350.00, valorUnitario: 296.61, total: 350.00 }],
        totales: { gravada: 296.61, gratuita: 0, descuento: 0, igv: 53.39, total: 350.00 }
    });
    assert.doesNotMatch(html, /1002/);
    assert.doesNotMatch(html, /bloque-tributario-leyenda/);
    assert.doesNotMatch(html, /TRANSFERENCIA GRATUITA/);
});

// =========================================================================
// 12. Descuento comercial normal sin tratamiento de gratuidad
// =========================================================================
test('12. Descuento comercial normal (ej. S/ 50.00) conserva código comercial y no incluye leyenda 1002', () => {
    const facturacionConDescuento = facturacionBase({
        base_imponible: 254.24,
        igv: 45.76,
        importe_total: 300.00,
        codigo_descuento_snapshot: 'DESC50'
    });
    const detalles = [{
        producto_facturacion_id: 50,
        cantidad: 1,
        valor_unitario: 296.61,
        precio_unitario: 350.00,
        descuento: 42.37,
        base_imponible: 254.24,
        afectacion_igv_snapshot: '10',
        igv: 45.76,
        importe_total: 300.00
    }];

    const payload = construirPayloadNubefact({
        facturacion: facturacionConDescuento,
        certificado: certificadoTaller('0423', { servicio_tipo_flujo: 'GNV_MODIFICACION' }),
        reservaDescuento: { codigo_autorizacion: 'DESC50', importe_descuento: 50.00 },
        detalles,
        resumenTributario: {
            totales: {
                precioAntesDescuento: 350.00,
                descuento: 50.00,
                baseImponible: 254.24,
                igv: 45.76,
                total: 300.00,
                gratuita: 0.00
            },
            descuento: { codigo: 'DESC50', importe: 50.00 }
        }
    });

    assert.equal(payload.total_descuento, 50.00);
    assert.equal(payload.total, 300.00);
    assert.equal(payload.total_gratuita, 0.00);
    assert.equal(payload.leyendas.length, 0); // No hay leyenda 1002
    assert.match(payload.observaciones, /CÓDIGO DE DESCUENTO: DESC50/); // Sí muestra descuento comercial legítimo

    // En PDF se muestra descuento-box
    const html = renderBoletaHtml({
        emisor: { ruc: '20600444531', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 217, fechaDocumento: '22/10/2026', formaPago: 'Contado' },
        cliente: { nombre: 'CLIENTE', tipoDoc: 'DNI', nroDoc: '74045612' },
        esTaller: false,
        esOperacionGratuita: false,
        items: [{ cantidad: 1, valorReferencial: 350.00, precioUnitario: 300.00, valorUnitario: 254.24, total: 300.00 }],
        totales: { gravada: 254.24, gratuita: 0, descuento: 50.00, igv: 45.76, total: 300.00 },
        descuento: { codigo: 'DESC50', descripcion: 'CAMPAÑA PRIMAVERA' }
    });
    assert.match(html, /descuento-box/);
    assert.match(html, /DESC50/);
    assert.doesNotMatch(html, /1002/);
    assert.doesNotMatch(html, /bloque-tributario-leyenda/);
});
