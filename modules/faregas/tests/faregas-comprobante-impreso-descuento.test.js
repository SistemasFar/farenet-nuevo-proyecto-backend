const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { construirResumenComercial } = require('../services/faregas-comprobante-impreso.service');
const { renderFacturaHtml } = require('../templates/comprobante-factura.template');
const { renderBoletaHtml } = require('../templates/comprobante-boleta.template');

const dataBase = ({ resumenComercial, totales, items } = {}) => ({
    emisor: {
        ruc: '20521536463',
        razonSocial: 'SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.',
        direccion: 'JR. ALBERTO SECADA NRO. 315, CALLAO',
        puntoVenta: 'FAREGAS - SURCO'
    },
    comprobante: {
        tipo: 'FACTURA',
        serie: 'FFF1',
        numero: 58,
        fechaDocumento: '18/11/2026',
        fechaVencimiento: '18/11/2026',
        moneda: 'Soles',
        formaPago: 'Contado'
    },
    cliente: { nombre: 'CLIENTE PRUEBA', tipoDoc: 'RUC', nroDoc: '20123456789' },
    vehiculo: { placa: 'ABC123' },
    items: items || [{
        cantidad: 1,
        unidad: 'ZZ',
        descripcion: 'CERTIFICADO INICIAL DE GLP',
        valorReferencial: 90,
        precioUnitario: 90,
        valorUnitario: 76.27,
        total: 90
    }],
    totales: totales || {
        gravada: 59.32,
        inafecta: 0,
        exonerada: 0,
        gratuita: 0,
        descuento: 16.95,
        igv: 10.68,
        total: 70
    },
    resumenComercial
});

describe('Representación comercial FAREGAS — descuento con IGV', () => {
    it('toma S/ 20.00 directamente del descuento persistido', () => {
        const resumen = construirResumenComercial({
            facturacionTotal: 70,
            descuentoPersistido: {
                importe_original: 90,
                importe_descuento: 20,
                importe_final: 70
            }
        });

        assert.deepEqual(resumen, {
            precioOriginal: 90,
            descuentoComercialConIgv: 20,
            total: 70,
            tieneDescuento: true
        });
    });

    it('conserva exactamente un descuento persistido de S/ 20.50', () => {
        const resumen = construirResumenComercial({
            facturacionTotal: 69.5,
            descuentoPersistido: {
                importe_original: 90,
                importe_descuento: 20.5,
                importe_final: 69.5
            }
        });

        assert.equal(resumen.descuentoComercialConIgv, 20.5);
        assert.equal(resumen.total, 69.5);
    });

    it('muestra un comprobante sin descuento sin inventar una resta', () => {
        const resumen = construirResumenComercial({ facturacionTotal: 90, descuentoPersistido: null });
        const html = renderFacturaHtml(dataBase({
            resumenComercial: resumen,
            totales: { gravada: 76.27, descuento: 0, igv: 13.73, total: 90 }
        }));

        assert.equal(resumen.tieneDescuento, false);
        assert.match(html, /Precio original<\/td>\s*<td class="t-num">S\/ 90\.00/);
        assert.doesNotMatch(html, /class="t-discount"/);
    });

    it('renderiza S/ 90.00 - S/ 20.00 = S/ 70.00 y mantiene el descuento fiscal separado', () => {
        const resumen = construirResumenComercial({
            facturacionTotal: 70,
            descuentoPersistido: {
                importe_original: 90,
                importe_descuento: 20,
                importe_final: 70
            }
        });
        const html = renderFacturaHtml(dataBase({ resumenComercial: resumen }));

        assert.match(html, /Precio original/);
        assert.match(html, /Descuento comercial/);
        assert.match(html, /- S\/ 20\.00/);
        assert.match(html, /S\/ 90\.00 - S\/ 20\.00 = S\/ 70\.00/);
        assert.match(html, /Descuento fiscal \(sin IGV\)/);
        assert.match(html, /S\/ 16\.95/);
        assert.match(html, /Representación comercial complementaria FAREGAS/);
        assert.match(html, /PDF oficial de NubeFact, el XML y el CDR permanecen disponibles/);
    });

    it('usa el mismo resumen comercial para boletas', () => {
        const resumen = construirResumenComercial({
            facturacionTotal: 70,
            descuentoPersistido: {
                importe_original: 90,
                importe_descuento: 20,
                importe_final: 70
            }
        });
        const html = renderBoletaHtml(dataBase({ resumenComercial: resumen }));

        assert.match(html, /RESUMEN COMERCIAL \(IMPORTES CON IGV\)/);
        assert.match(html, /- S\/ 20\.00/);
        assert.match(html, /S\/ 90\.00 - S\/ 20\.00 = S\/ 70\.00/);
    });

    it('soporta varios ítems sin redistribuir ni duplicar el descuento', () => {
        const resumen = construirResumenComercial({
            facturacionTotal: 130,
            descuentoPersistido: {
                importe_original: 150,
                importe_descuento: 20,
                importe_final: 130
            }
        });
        const html = renderFacturaHtml(dataBase({
            resumenComercial: resumen,
            items: [
                { cantidad: 1, unidad: 'ZZ', descripcion: 'SERVICIO A', valorReferencial: 90, precioUnitario: 90, valorUnitario: 76.27, total: 90 },
                { cantidad: 1, unidad: 'ZZ', descripcion: 'SERVICIO B', valorReferencial: 60, precioUnitario: 60, valorUnitario: 50.85, total: 60 }
            ],
            totales: { gravada: 110.17, descuento: 16.95, igv: 19.83, total: 130 }
        }));

        assert.equal((html.match(/Descuento comercial/g) || []).length, 1);
        assert.match(html, /S\/ 150\.00 - S\/ 20\.00 = S\/ 130\.00/);
    });

    it('no presenta una cortesía como descuento comercial ordinario', () => {
        const resumen = construirResumenComercial({
            facturacionTotal: 0,
            descuentoPersistido: {
                importe_original: 350,
                importe_descuento: 350,
                importe_final: 0
            },
            esOperacionGratuita: true
        });

        assert.equal(resumen, null);
    });

    it('bloquea un resumen comercial inconsistente', () => {
        assert.throws(() => construirResumenComercial({
            facturacionTotal: 70,
            descuentoPersistido: {
                importe_original: 90,
                importe_descuento: 20.5,
                importe_final: 70
            }
        }), /INCONSISTENCIA_COMERCIAL/);
    });
});
