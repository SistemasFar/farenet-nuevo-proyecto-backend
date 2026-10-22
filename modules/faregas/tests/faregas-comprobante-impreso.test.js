const test = require('node:test');
const assert = require('node:assert/strict');
const { numeroALetras } = require('../utils/numero-a-letras');
const { generarQrSvg, generarQrDataUri } = require('../utils/qr-code');
const { renderBoletaHtml } = require('../templates/comprobante-boleta.template');
const { renderFacturaHtml } = require('../templates/comprobante-factura.template');
const {
    validarConsistenciaFiscal,
    mapearFormaPago,
    formatearFechaPeruana,
    construirCuotasImpresas
} = require('../services/faregas-comprobante-impreso.service');
const {
    DIRECCION_HISTORICA_FAREGAS,
    obtenerIdentidadCorporativaFaregas
} = require('../services/faregas-representacion-corporativa.service');

test('identidad corporativa usa fg_empresa y aísla la dirección histórica de la fuente fiscal DEMO', async () => {
    const queryable = {
        async query(sql, params) {
            assert.match(sql, /FROM fg_empresa/);
            assert.deepEqual(params, ['FAREGAS']);
            return {
                rowCount: 1,
                rows: [{
                    nombre: 'SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.',
                    ruc: '20521536463',
                    direccion: 'Av. Secundaria 456'
                }]
            };
        }
    };

    const identidad = await obtenerIdentidadCorporativaFaregas(queryable);

    assert.deepEqual(identidad, {
        razonSocial: 'SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.',
        ruc: '20521536463',
        direccion: DIRECCION_HISTORICA_FAREGAS
    });
});

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
            direccion: DIRECCION_HISTORICA_FAREGAS,
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
    assert.match(html, /SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S\.A\.C\./);
    assert.match(html, /20521536463/);
    assert.match(html, /JR\. ALBERTO SECADA NRO\. 315, PROV\. CONST\. DEL CALLAO, CALLAO/);
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
    assert.equal(mapearFormaPago('CONTADO', 'TARJETA_DEBITO'), 'TARJETA DÉBITO');
    assert.equal(mapearFormaPago('CONTADO', 'TARJETA_CREDITO'), 'TARJETA CRÉDITO');
    assert.equal(mapearFormaPago('CONTADO', 'EFECTIVO'), 'EFECTIVO');

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
            direccion: DIRECCION_HISTORICA_FAREGAS,
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
    assert.match(html, /SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S\.A\.C\./);
    assert.match(html, /20521536463/);
    assert.match(html, /JR\. ALBERTO SECADA NRO\. 315, PROV\. CONST\. DEL CALLAO, CALLAO/);
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
        totales: { gravada: 169.49, igv: 30.51, total: 200 },
        cuotas: [
            { numero: '001', fecha: '31/10/2026', importe: 80 },
            { numero: '002', fecha: '30/11/2026', importe: 120 }
        ]
    };

    const html = renderFacturaHtml(data);
    assert.match(html, /Fecha Vencimiento:<\/span> 31\/10\/2026/);
    assert.match(html, /Forma de Pago:<\/span> Crédito/);
    assert.match(html, /Cuota:<\/strong> 001/);
    assert.match(html, /Fecha:<\/strong> 31\/10\/2026/);
    assert.match(html, /Monto:<\/strong> S\/ 80\.00/);
    assert.match(html, /Cuota:<\/strong> 002/);
});

test('comprobante de duplicado construye cuotas sin depender de una variable fuera de alcance', () => {
    const cuotas = [{ numero_cuota: 1, fecha_pago: '2026-10-31', importe: '50.00' }];

    assert.deepEqual(construirCuotasImpresas({ condicion_pago: 'CONTADO' }, cuotas), []);
    assert.deepEqual(construirCuotasImpresas({ condicion_pago: 'CREDITO' }, cuotas), [
        { numero: '001', fecha: '31/10/2026', importe: 50 }
    ]);
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

test('Caso A: Orden de Trabajo = Placa del vehículo en Boleta y Factura', () => {
    const dataBoleta = {
        emisor: { ruc: '20521536463', puntoVenta: 'SURQUILLO' },
        comprobante: {
            tipo: 'BOLETA', serie: 'BE20', numero: 8138,
            fechaDocumento: '12/10/2026', fechaVencimiento: '12/10/2026',
            moneda: 'Soles', formaPago: 'Tarjeta de Débito'
        },
        cliente: { nombre: 'SUDARIO LUCAS MARINA', tipoDoc: 'DNI', nroDoc: '40117627' },
        vehiculo: { placa: 'B2X125' },
        items: [{ cantidad: 1, unidad: 'NIU', descripcion: 'CERTIFICADO GNV', precioUnitario: 50, valorUnitario: 42.37, total: 50 }],
        totales: { gravada: 42.37, igv: 7.63, total: 50 },
        numeroCertificado: 'DG-22-0014037',
        ordenTrabajo: 'B2X125'
    };
    const htmlBoleta = renderBoletaHtml(dataBoleta);
    assert.match(htmlBoleta, /Orden Trabajo:<\/span>\s*B2X125/);
    assert.match(htmlBoleta, /Numero Certificado:<\/span>\s*DG-22-0014037/);
    assert.match(htmlBoleta, /Forma de Pago:<\/span>\s*Tarjeta de Débito/);

    const dataFactura = {
        ...dataBoleta,
        comprobante: { ...dataBoleta.comprobante, tipo: 'FACTURA', serie: 'FE12', numero: 1516 },
        cliente: { nombre: 'EMPRESA TRANSPORTE S.A.C.', tipoDoc: 'RUC', nroDoc: '20600123456', direccion: 'AV. LIMA 100' }
    };
    const htmlFactura = renderFacturaHtml(dataFactura);
    assert.match(htmlFactura, /Orden Trabajo:<\/span>\s*B2X125/);
    assert.match(htmlFactura, /Numero Certificado:<\/span>\s*DG-22-0014037/);
    assert.match(htmlFactura, /Forma de Pago:<\/span>\s*Tarjeta de Débito/);
});

test('Caso B: Pago EFECTIVO -> Forma de Pago = Efectivo', () => {
    assert.equal(mapearFormaPago('CONTADO', 'EFECTIVO'), 'EFECTIVO');
    assert.equal(mapearFormaPago('CONTADO', [{ tipo: 'efectivo' }]), 'EFECTIVO');
    assert.equal(mapearFormaPago('CONTADO', null, [{ tipocontado_key: 'efectivo' }]), 'EFECTIVO');
});

test('comprobante gratuito de taller replica el contenido económico del modelo histórico sin inventar vehículo ni pago', () => {
    const data = {
        emisor: { ruc: '20521536463', razonSocial: 'SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 213, fechaDocumento: '22/10/2026', moneda: 'Soles', formaPago: 'Contado' },
        cliente: { nombre: 'CLIENTE DE PRUEBA', tipoDoc: 'DNI', nroDoc: '74045612' },
        vehiculo: {},
        taller: { nombre: 'CHARING S.A.C.' },
        esTaller: true,
        esOperacionGratuita: true,
        items: [{
            cantidad: 1,
            unidad: 'NIU',
            descripcion: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GLP',
            valorReferencial: 350,
            precioUnitario: 0,
            valorUnitario: 0,
            total: 0
        }],
        totales: { gravada: 0, gratuita: 350, descuento: 0, exonerada: 0, inafecta: 0, igv: 0, total: 0 },
        descuento: { codigo: 'DESCUENTO_TALLER', descripcion: 'AUTORIZACIÓN DE OPERACIÓN GRATUITA' }
    };

    const html = renderBoletaHtml(data);
    assert.match(html, /Taller<\/td><td class="v-value" colspan="3">CHARING S\.A\.C\./);
    assert.match(html, /1002 - TRANSFERENCIA GRATUITA DE UN BIEN Y\/O SERVICIO PRESTADO GRATUITAMENTE/);
    assert.match(html, /<td class="col-num">350\.00<\/td>\s*<td class="col-num">0\.00<\/td>\s*<td class="col-num">0\.00<\/td>\s*<td class="col-num">0\.00<\/td>/);
    assert.match(html, /Op\. Gratuita<\/td>\s*<td class="t-num">S\/ 350\.00<\/td>/);
    assert.match(html, /Descuentos<\/td>\s*<td class="t-num">S\/ 0\.00<\/td>/);
    assert.match(html, /Importe Total<\/strong><\/td>\s*<td class="t-num"><strong>S\/ 0\.00/);
    assert.match(html, /CERO CON 00\/100 SOLES/i);
    assert.doesNotMatch(html, />Placa<|Marca Vehículo|Motor Vehículo|Orden Trabajo|EFECTIVO/);
});

test('Caso C: Pago TARJETA con tipo DÉBITO -> Forma de Pago = Tarjeta de Débito', () => {
    assert.equal(mapearFormaPago('CONTADO', 'TARJETA_DEBITO'), 'TARJETA DÉBITO');
    assert.equal(mapearFormaPago('CONTADO', 'TARJETA', 'DEBITO'), 'TARJETA DÉBITO');
    assert.equal(mapearFormaPago('CONTADO', 'TARJETA', { tipo_tarjeta: 'DEBITO' }), 'TARJETA DÉBITO');
    assert.equal(mapearFormaPago('CONTADO', [{ tipo: 'tarjeta', tipo_tarjeta: 'DEBITO' }]), 'TARJETA DÉBITO');
    assert.equal(mapearFormaPago('CONTADO', 'TARJETA'), 'TARJETA', 'Una tarjeta histórica sin modalidad no debe inventarse como débito');
});

test('Caso D: Pago TARJETA con tipo CRÉDITO -> Forma de Pago = Tarjeta de Crédito', () => {
    assert.equal(mapearFormaPago('CONTADO', 'TARJETA_CREDITO'), 'TARJETA CRÉDITO');
    assert.equal(mapearFormaPago('CONTADO', 'TARJETA', 'CREDITO'), 'TARJETA CRÉDITO');
    assert.equal(mapearFormaPago('CONTADO', 'TARJETA', { tipo_tarjeta: 'CREDITO' }), 'TARJETA CRÉDITO');
    assert.equal(mapearFormaPago('CONTADO', [{ tipo: 'tarjeta', tipo_tarjeta: 'CREDITO' }]), 'TARJETA CRÉDITO');
});

test('Caso E: Pagos mixtos -> No pierde información ni elige arbitrariamente', () => {
    assert.equal(mapearFormaPago('CONTADO', 'EFECTIVO, TARJETA'), 'MIXTO');
    assert.equal(mapearFormaPago('CONTADO', null, [
        { tipo: 'efectivo', importe: 50 },
        { tipo: 'tarjeta', tipo_tarjeta: 'DEBITO', importe: 40 }
    ]), 'MIXTO');
    assert.equal(mapearFormaPago('CONTADO', null, [
        { tipocontado_key: 'efectivo', importe: 50 },
        { tipocontado_key: 'tarjeta', tipo_tarjeta: 'CREDITO', importe: 40 }
    ]), 'MIXTO');
    assert.equal(mapearFormaPago('CONTADO', null, [
        { tipocontado_key: 'efectivo' },
        { tipocontado_key: 'efectivo' }
    ]), 'EFECTIVO', 'Pagos repetidos del mismo medio se consolidan');
});

test('Caso E.1: BANCO del flujo Faregas se imprime como Transferencia Bancaria o Depósito', () => {
    assert.equal(mapearFormaPago('CONTADO', 'BANCO'), 'TRANSFERENCIA BANCARIA');
    assert.equal(mapearFormaPago('CONTADO', null, [{
        tipocontado_key: 'banco',
        fechdeposito: '2026-10-15',
        nrooperacionbanco: '12222'
    }]), 'DEPÓSITO BANCARIO');
});

test('Caso F: Condición comercial = CRÉDITO -> Forma de Pago = Crédito (no confunde con Tarjeta de Crédito)', () => {
    assert.equal(mapearFormaPago('CREDITO', 'EFECTIVO'), 'Crédito');
    assert.equal(mapearFormaPago('CREDITO', 'TARJETA'), 'Crédito');
    assert.equal(mapearFormaPago('CREDITO', 'TARJETA_CREDITO'), 'Crédito');
    assert.equal(mapearFormaPago('CREDITO_30', 'TARJETA'), 'Crédito');
    assert.equal(mapearFormaPago('CREDITO', [{ tipo: 'tarjeta', tipo_tarjeta: 'CREDITO' }]), 'Crédito');
});

test.after(async () => {
    const db = require('../../../config/database');
    if (db && typeof db.end === 'function') {
        await db.end();
    }
});
