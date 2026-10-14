const test = require('node:test');
const assert = require('node:assert/strict');
const { numeroALetras } = require('../utils/numero-a-letras');
const { generarQrSvg, generarQrDataUri } = require('../utils/qr-code');
const { renderBoletaHtml } = require('../templates/comprobante-boleta.template');
const { renderFacturaHtml } = require('../templates/comprobante-factura.template');
const {
    validarConsistenciaFiscal,
    mapearFormaPago,
    formatearFechaPeruana
} = require('../services/faregas-comprobante-impreso.service');

test('numeroALetras produce exactamente el formato oficial para comprobantes', () => {
    assert.equal(numeroALetras(70.00), 'Son: Setenta con 00/100 Soles');
    assert.equal(numeroALetras(50.00), 'Son: Cincuenta con 00/100 Soles');
    assert.equal(numeroALetras(90.00), 'Son: Noventa con 00/100 Soles');
    assert.equal(numeroALetras(100.00), 'Son: Cien con 00/100 Soles');
    assert.equal(numeroALetras(1250.50), 'Son: Mil doscientos cincuenta con 50/100 Soles');
    assert.equal(numeroALetras(0.00), 'Son: Cero con 00/100 Soles');
    assert.equal(numeroALetras(1.00), 'Son: Un con 00/100 Soles');
    assert.equal(numeroALetras(10.00), 'Son: Diez con 00/100 Soles');
    assert.equal(numeroALetras(21.00), 'Son: Veintiuno con 00/100 Soles');
    assert.equal(numeroALetras(101.00), 'Son: Ciento un con 00/100 Soles');
    assert.equal(numeroALetras(120.00), 'Son: Ciento veinte con 00/100 Soles');
    assert.equal(numeroALetras(999.00), 'Son: Novecientos noventa y nueve con 00/100 Soles');
    assert.equal(numeroALetras(1000.00), 'Son: Mil con 00/100 Soles');
    assert.equal(numeroALetras(1500.00), 'Son: Mil quinientos con 00/100 Soles');
    assert.equal(numeroALetras(9999.00), 'Son: Nueve mil novecientos noventa y nueve con 00/100 Soles');
    assert.equal(numeroALetras(9999.99), 'Son: Nueve mil novecientos noventa y nueve con 99/100 Soles');
    assert.equal(numeroALetras(99.999), 'Son: Cien con 00/100 Soles');
});

test('generador QR genera vector SVG válido y contiene la cadena tributaria SUNAT', () => {
    const qrCadena = '20521536463|03|BE20|00008138|7.63|50.00|12/10/2026|1|40117627|';
    const svg = generarQrSvg(qrCadena, { size: 100 });
    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 \d+ \d+"/);
    assert.match(svg, /<rect /);

    const dataUri = generarQrDataUri(qrCadena);
    assert.match(dataUri, /^data:image\/svg\+xml;base64,/);
});

test('A. Boleta al contado contiene bloques de sede, cliente, vehículo y certificado DG', () => {
    const data = {
        emisor: {
            ruc: '20521536463',
            razonSocial: 'SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.',
            direccion: 'JR. ALBERTO SECADA NRO. 315, CALLAO',
            puntoVenta: 'SURCO',
            telefono: '942900001',
            correo: 'cert_surco@faregas.pe'
        },
        comprobante: {
            tipo: 'BOLETA',
            serie: 'BBB1',
            numero: 160,
            fechaDocumento: '14/10/2026',
            fechaVencimiento: '14/10/2026',
            formaPago: 'Contado',
            moneda: 'Soles'
        },
        cliente: {
            nombre: 'JUAN PEREZ',
            tipoDoc: 'DNI',
            nroDoc: '12345678',
            telefono: '999888777'
        },
        vehiculo: {
            placa: 'ABC123',
            marca: 'NISSAN',
            tipo: 'SEDAN',
            motor: 'QG15123456',
            modelo: 'SUNNY'
        },
        items: [
            {
                cantidad: 1,
                unidad: 'NIU',
                descripcion: 'REVISION ANUAL GLP',
                valorReferencial: 90.00,
                precioUnitario: 90.00,
                valorUnitario: 76.27,
                total: 90.00
            }
        ],
        totales: {
            gravada: 76.27,
            igv: 13.73,
            total: 90.00
        },
        numeroCertificado: 'DG-01-0012345',
        ordenTrabajo: '',
        qrSource: '20521536463|03|BBB1|00000160|13.73|90.00|14/10/2026|1|12345678|'
    };

    const html = renderBoletaHtml(data);

    assert.match(html, /BOLETA DE VENTA ELECTRÓNICA/);
    assert.match(html, /BBB1-00000160/);
    assert.match(html, /JUAN PEREZ/);
    assert.match(html, /12345678/);
    assert.match(html, /Punto de venta:<\/strong> FAREGAS - SURCO/);
    assert.match(html, /ABC123/);
    assert.match(html, /NISSAN/);
    assert.match(html, /QG15123456/);
    assert.match(html, /REVISION ANUAL GLP/);
    assert.match(html, /NIU/);
    assert.match(html, /Son: Noventa con 00\/100 Soles/);
    assert.match(html, /Numero Certificado:<\/span> DG-01-0012345/);
    assert.doesNotMatch(html, /Orden Trabajo:<\/span>/, 'No debe renderizar Orden Trabajo falsa cuando no existe');
    assert.doesNotMatch(html, /dmsfact/i);
    assert.doesNotMatch(html, /034-005-0010980/);
});

test('B. Boleta con tarjeta conserva forma de pago Tarjeta de Débito', () => {
    assert.equal(mapearFormaPago('CONTADO', 'TARJETA_DEBITO'), 'Tarjeta de Débito');
    assert.equal(mapearFormaPago('CONTADO', 'TARJETA_CREDITO'), 'Tarjeta de Crédito');
    assert.equal(mapearFormaPago('CONTADO', 'EFECTIVO'), 'Contado');

    const data = {
        emisor: { ruc: '20521536463', puntoVenta: 'SURQUILLO' },
        comprobante: {
            tipo: 'BOLETA', serie: 'BE20', numero: 8138,
            fechaDocumento: '12/10/2026', formaPago: 'Tarjeta de Débito'
        },
        cliente: { nombre: 'SUDARIO LUCAS MARINA', tipoDoc: 'DNI', nroDoc: '40117627' },
        vehiculo: { placa: 'B2X125' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'CERTIFICADO GNV', precioUnitario: 50, valorUnitario: 42.37, total: 50 }],
        totales: { gravada: 42.37, igv: 7.63, total: 50 },
        numeroCertificado: 'DG-22-0014037'
    };

    const html = renderBoletaHtml(data);
    assert.match(html, /Forma de Pago:<\/span> Tarjeta de Débito/);
    assert.match(html, /DG-22-0014037/);
});

test('C. Factura al contado contiene RUC, Domicilio fiscal y desglose tributario', () => {
    const data = {
        emisor: {
            ruc: '20521536463',
            razonSocial: 'SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.',
            direccion: 'JR. ALBERTO SECADA NRO. 315, CALLAO',
            puntoVenta: 'TRENEMAN'
        },
        comprobante: {
            tipo: 'FACTURA',
            serie: 'FE12',
            numero: 1516,
            fechaDocumento: '12/10/2026',
            formaPago: 'Contado'
        },
        cliente: {
            nombre: 'DE LA CRUZ QUISPE JUAN CARLOS',
            tipoDoc: 'RUC',
            nroDoc: '10094658336',
            direccion: 'CALLE CHAVEZ DE LA ROSA 1 85DPTO 2 LIMA PE'
        },
        vehiculo: {
            placa: 'BNP611',
            marca: 'TOYOTA',
            tipo: 'CAMIONETA RURAL',
            motor: '2NRF923660',
            modelo: 'RUSH'
        },
        items: [
            {
                cantidad: 1,
                unidad: 'NIU',
                descripcion: '0161 - CERTIFICACION ANUAL DE GLP',
                valorReferencial: 70.00,
                precioUnitario: 70.00,
                valorUnitario: 59.32,
                total: 70.00
            }
        ],
        totales: {
            gravada: 59.32,
            inafecta: 0,
            exonerada: 0,
            gratuita: 0,
            descuento: 0,
            igv: 10.68,
            total: 70.00
        },
        numeroCertificado: 'DG-41 0068412'
    };

    const html = renderFacturaHtml(data);
    assert.match(html, /FACTURA ELECTRÓNICA/);
    assert.match(html, /FE12-00001516/);
    assert.match(html, /CALLE CHAVEZ DE LA ROSA 1 85DPTO 2 LIMA PE/);
    assert.match(html, /10094658336/);
    assert.match(html, /Op\. Gravada/);
    assert.match(html, /S\/ 59\.32/);
    assert.match(html, /S\/ 10\.68/);
    assert.match(html, /S\/ 70\.00/);
    assert.match(html, /DG-41 0068412/);
});

test('D. Factura a crédito incluye fecha de vencimiento y forma de pago Crédito', () => {
    assert.equal(mapearFormaPago('CREDITO', null), 'Crédito');
    assert.equal(mapearFormaPago('CREDITO_30', null), 'Crédito');

    const data = {
        emisor: { ruc: '20521536463', puntoVenta: 'CENTRAL' },
        comprobante: {
            tipo: 'FACTURA',
            serie: 'FE01',
            numero: 500,
            fechaDocumento: '01/10/2026',
            fechaVencimiento: '31/10/2026',
            formaPago: 'Crédito'
        },
        cliente: { nombre: 'EMPRESA TRANSPORTE S.A.C.', tipoDoc: 'RUC', nroDoc: '20600123456', direccion: 'AV. LIMA 100' },
        vehiculo: { placa: 'XYZ987' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'SERVICIO CONFORMIDAD', precioUnitario: 200, valorUnitario: 169.49, total: 200 }],
        totales: { gravada: 169.49, igv: 30.51, total: 200 }
    };

    const html = renderFacturaHtml(data);
    assert.match(html, /Fecha Vencimiento:<\/span> 31\/10\/2026/);
    assert.match(html, /Forma de Pago:<\/span> Crédito/);
});

test('E. Comprobante con descuento reproduce el bloque de código y resumen', () => {
    const data = {
        emisor: { ruc: '20521536463', puntoVenta: 'SURQUILLO' },
        comprobante: { tipo: 'BOLETA', serie: 'BE20', numero: 8138 },
        cliente: { nombre: 'CLIENTE DESCUENTO', tipoDoc: 'DNI', nroDoc: '11223344' },
        vehiculo: { placa: 'B2X125' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'CERTIFICADO GNV', precioUnitario: 50, valorUnitario: 42.37, total: 50 }],
        totales: { gravada: 42.37, igv: 7.63, total: 50, descuento: 30 },
        descuento: {
            codigo: '058174',
            descripcion: 'DESCUENTO WS',
            monto: 30
        }
    };

    const html = renderBoletaHtml(data);
    assert.match(html, /058174/);
    assert.match(html, /DESCUENTO WS/);
    assert.match(html, /S\/ 30\.00/);
});

test('Consistencia Fiscal: rechaza generación si importes difieren del comprobante emitido', () => {
    const facturacion = {
        serie: 'BBB1',
        numero: 160,
        tipo_comprobante: 'BOLETA',
        nro_documento: '12345678',
        importe_total: '90.00',
        igv: '13.73',
        base_imponible: '76.27',
        fecha_documento: '2026-10-14'
    };

    const viewModelValido = {
        comprobante: { serie: 'BBB1', numero: 160, tipo: 'BOLETA', fechaDocumento: '14/10/2026' },
        cliente: { nroDoc: '12345678' },
        totales: { total: 90.00, igv: 13.73, gravada: 76.27 }
    };

    assert.doesNotThrow(() => {
        validarConsistenciaFiscal(facturacion, viewModelValido);
    });

    const viewModelInvalidoTotal = {
        comprobante: { serie: 'BBB1', numero: 160, tipo: 'BOLETA', fechaDocumento: '14/10/2026' },
        cliente: { nroDoc: '12345678' },
        totales: { total: 85.00, igv: 13.73, gravada: 76.27 }
    };

    assert.throws(() => {
        validarConsistenciaFiscal(facturacion, viewModelInvalidoTotal);
    }, /INCONSISTENCIA_FISCAL/);

    const viewModelInvalidaSerie = {
        comprobante: { serie: 'BE01', numero: 160, tipo: 'BOLETA', fechaDocumento: '14/10/2026' },
        cliente: { nroDoc: '12345678' },
        totales: { total: 90.00, igv: 13.73, gravada: 76.27 }
    };

    assert.throws(() => {
        validarConsistenciaFiscal(facturacion, viewModelInvalidaSerie);
    }, /INCONSISTENCIA_FISCAL/);
});
