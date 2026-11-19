const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { evaluarDetraccion } = require('../services/faregas-detracciones.service');
const { esCuentaBancoNacionValida } = require('../services/faregas-calculo-tributario.service');
const { construirPayloadNubefact } = require('../integrations/nubefact-faregas.adapter');
const { _private } = require('../services/faregas-facturacion.service');
const { validarCuentaDetraccionEmisor } = _private;

// Definición de catálogo para pruebas
const SERVICIO_SPOT_037 = Object.freeze({
    sujeto_detraccion: true,
    detraccion_codigo: '037',
    detraccion_porcentaje: 12.00,
    naturaleza_spot: 'SERVICIO'
});

const BIEN_CHIP_FISICO = Object.freeze({
    sujeto_detraccion: false,
    detraccion_codigo: null,
    detraccion_porcentaje: null,
    naturaleza_spot: 'BIEN'
});

describe('AUDITORÍA SPOT FAREGAS — 11 CASOS AISLADOS (SIN POSTGRESQL NI NUBEFACT EXTERNO)', () => {

    // Caso 1: Factura S/ 700.00 exacta -> NO sujeta a SPOT
    it('Caso 1: Factura por S/ 700.00 exactos no debe estar sujeta a SPOT (umbral legal estricto > S/ 700)', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 700.00,
            servicio: SERVICIO_SPOT_037
        });
        assert.equal(resultado.sujeto, false);
        assert.equal(resultado.monto, 0);
        assert.equal(resultado.neto, 700.00);
        assert.equal(resultado.motivoExclusion, 'IMPORTE_MENOR_O_IGUAL_A_700');
        assert.equal(resultado.estadoEvaluacionSpot, 'CLASIFICADA_SIN_UMBRAL_LEGAL');
    });

    // Caso 2: Factura S/ 700.01 -> Sujeta a SPOT (base 700.01, monto 84, neto 616.01)
    it('Caso 2: Factura por S/ 700.01 debe estar sujeta a SPOT (base 700.01, detracción 84, neto 616.01)', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 700.01,
            servicio: SERVICIO_SPOT_037
        });
        assert.equal(resultado.sujeto, true);
        assert.equal(resultado.codigo, '037');
        assert.equal(resultado.porcentaje, 12);
        assert.equal(resultado.base, 700.01);
        // 700.01 * 0.12 = 84.0012 -> redondeo entero SUNAT = 84
        assert.equal(resultado.monto, 84);
        assert.equal(resultado.neto, 616.01);
        assert.equal(resultado.nubefactTipo, 35);
        assert.equal(resultado.estadoEvaluacionSpot, 'SUJETA');
    });

    // Caso 3: Factura S/ 1,000.00 -> Sujeta a SPOT (monto 120, neto 880)
    it('Caso 3: Factura por S/ 1,000.00 debe aplicar detracción 12% (S/ 120.00) y neto a pagar S/ 880.00', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 1000.00,
            servicio: SERVICIO_SPOT_037
        });
        assert.equal(resultado.sujeto, true);
        assert.equal(resultado.codigo, '037');
        assert.equal(resultado.porcentaje, 12);
        assert.equal(resultado.base, 1000.00);
        assert.equal(resultado.monto, 120);
        assert.equal(resultado.neto, 880.00);
        assert.equal(resultado.nubefactTipo, 35);
    });

    // Caso 4: Factura S/ 1,260.00 -> Sujeta a SPOT (monto 151, neto 1109)
    it('Caso 4: Factura por S/ 1,260.00 aplica detracción 12% redondeada (S/ 151.00) y neto S/ 1,109.00', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 1260.00,
            servicio: SERVICIO_SPOT_037
        });
        assert.equal(resultado.sujeto, true);
        assert.equal(resultado.codigo, '037');
        assert.equal(resultado.porcentaje, 12);
        assert.equal(resultado.base, 1260.00);
        // 1260.00 * 0.12 = 151.20 -> redondeo entero SUNAT = 151
        assert.equal(resultado.monto, 151);
        assert.equal(resultado.neto, 1109.00);
        assert.equal(resultado.nubefactTipo, 35);
    });

    // Caso 5: Factura con descuento comercial
    it('Caso 5a: Factura S/ 800 - Descuento S/ 150 = S/ 650 (debajo de umbral) -> NO SPOT', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 650.00, // Importe neto tras descuento comercial
            servicio: SERVICIO_SPOT_037
        });
        assert.equal(resultado.sujeto, false);
        assert.equal(resultado.monto, 0);
        assert.equal(resultado.neto, 650.00);
        assert.equal(resultado.motivoExclusion, 'BAJO_UMBRAL_COMERCIAL');
    });

    it('Caso 5b: Factura S/ 1,000 - Descuento S/ 200 = S/ 800 (supera umbral) -> SPOT sobre base S/ 800, monto 96, neto 704', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 800.00, // Importe neto tras descuento comercial
            servicio: SERVICIO_SPOT_037
        });
        assert.equal(resultado.sujeto, true);
        assert.equal(resultado.base, 800.00);
        // 800 * 0.12 = 96
        assert.equal(resultado.monto, 96);
        assert.equal(resultado.neto, 704.00);
    });

    // Caso 6: Factura sin descuento (S/ 1,000 -> monto 120)
    it('Caso 6: Factura sin descuento por S/ 1,000.00 aplica SPOT íntegro de S/ 120.00', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 1000.00,
            servicio: SERVICIO_SPOT_037
        });
        assert.equal(resultado.sujeto, true);
        assert.equal(resultado.base, 1000.00);
        assert.equal(resultado.monto, 120);
        assert.equal(resultado.neto, 880.00);
    });

    // Caso 7: Boleta ordinaria (cualquier monto) -> NO SPOT
    it('Caso 7: Boleta de venta a consumidor final por S/ 1,260.00 está excluida de SPOT', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'BOLETA',
            importeTotal: 1260.00,
            servicio: SERVICIO_SPOT_037
        });
        assert.equal(resultado.sujeto, false);
        assert.equal(resultado.monto, 0);
        assert.equal(resultado.neto, 1260.00);
        assert.equal(resultado.motivoExclusion, 'BOLETA_VENTA_CONSUMIDOR_FINAL_NO_SUJETA');
    });

    // Caso 8: Venta pura de chips/bienes -> NO SPOT
    it('Caso 8: Venta pura de chips físicos por S/ 1,000.00 no está sujeta a SPOT', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 1000.00,
            items: [
                { tipo_item: 'PRODUCTO', productoSpot: BIEN_CHIP_FISICO, total: 1000.00 }
            ]
        });
        assert.equal(resultado.sujeto, false);
        assert.equal(resultado.monto, 0);
        assert.equal(resultado.neto, 1000.00);
        assert.equal(resultado.motivoExclusion, 'BIEN_MUEBLE_NO_SUJETO_A_SPOT');
    });

    // Caso 9: Cuenta bancaria inválida -> rechazo controlado
    it('Caso 9: Cuenta bancaria inválida (con letras, vacía o con longitud incorrecta) produce rechazo controlado', () => {
        assert.equal(esCuentaBancoNacionValida('00-ABC-123456'), false);
        assert.equal(esCuentaBancoNacionValida('12345'), false);
        assert.equal(esCuentaBancoNacionValida(''), false);
        assert.equal(esCuentaBancoNacionValida(null), false);

        const evaluacionSujeta = { sujeto: true, base: 1000, monto: 120 };
        assert.throws(
            () => validarCuentaDetraccionEmisor(evaluacionSujeta, { cuentaBancoNacion: '' }),
            (error) => error.code === 'CUENTA_BANCO_NACION_DETRACCION_FALTANTE' && error.statusCode === 409
        );
        assert.throws(
            () => validarCuentaDetraccionEmisor(evaluacionSujeta, { cuentaBancoNacion: '00-ABC-123456' }),
            (error) => error.code === 'CUENTA_BANCO_NACION_DETRACCION_INVALIDA' && error.statusCode === 409
        );
    });

    // Caso 10: Cuenta real válida de CAMBRIDGE (00-012-046588) -> aceptada y normalizada
    it('Caso 10: Cuenta oficial del Banco de la Nación de CAMBRIDGE (00-012-046588) es aceptada y validada', () => {
        const cuentaCambridge = '00-012-046588';
        assert.equal(esCuentaBancoNacionValida(cuentaCambridge), true);

        const limpia = cuentaCambridge.replace(/\s+|-/g, '');
        assert.equal(limpia, '00012046588');
        assert.equal(limpia.length, 11);
        assert.equal(limpia.startsWith('00'), true);

        const evaluacionSujeta = { sujeto: true, base: 1000, monto: 120 };
        assert.doesNotThrow(() => {
            validarCuentaDetraccionEmisor(evaluacionSujeta, { cuentaBancoNacion: cuentaCambridge });
        });
    });

    // Caso 11: Integridad XML/payload NubeFact: total tributario S/ 1,000 no disminuido y neto de pago S/ 880
    it('Caso 11: Payload NubeFact mantiene total tributario íntegro (S/ 1,000), añade tags SPOT y no confunde detracción con descuento', () => {
        const facturacion = {
            id: 1001,
            tipo_comprobante: 'FACTURA',
            serie: 'FFF1',
            numero: 59,
            nro_documento: '20600444531',
            nombre_razon_social: 'EMPRESA CLIENTE S.A.C.',
            direccion: 'AV. PRINCIPAL 123',
            email: 'cliente@ejemplo.com',
            fecha_documento: '2026-11-19',
            moneda_key: 'PEN',
            base_imponible: 847.46,
            igv: 152.54,
            importe_total: 1000.00,
            sujeto_detraccion: true,
            detraccion_codigo: '037',
            detraccion_descripcion: 'Demás servicios gravados con el IGV',
            detraccion_porcentaje: 12.00,
            detraccion_base: 1000.00,
            detraccion_monto: 120.00,
            detraccion_neto: 880.00,
            detraccion_estado_deposito: 'PENDIENTE'
        };

        const payload = construirPayloadNubefact({
            facturacion,
            certificado: { id: 100, placa: 'ABC-123' },
            vehiculo: { placa: 'ABC-123' },
            detalles: [{
                tipo_item: 'SERVICIO',
                descripcion: 'CERTIFICACION GNV',
                unidad_de_medida: 'ZZ',
                cantidad: 1,
                valor_unitario: 847.46,
                precio_unitario: 1000.00,
                subtotal: 847.46,
                tipo_de_igv: 1,
                igv: 152.54,
                total: 1000.00,
                descuento: 0
            }]
        });

        // 1. Integridad de los totales fiscales del comprobante
        assert.equal(payload.total, 1000.00, 'El total de la factura no debe verse reducido por la detracción');
        assert.equal(payload.total_gravada, 847.46, 'La base imponible debe permanecer íntegra');
        assert.equal(payload.total_igv, 152.54, 'El débito fiscal IGV no debe alterarse');
        assert.equal(payload.total_descuento, 0, 'La detracción NO debe figurar como descuento');

        // 2. Parámetros SPOT para NubeFact / SUNAT
        assert.equal(payload.sunat_transaction, 30, 'sunat_transaction debe ser 30 (operación sujeta a detracción)');
        assert.equal(payload.detraccion, true, 'detraccion debe ser true');
        assert.equal(payload.detraccion_tipo, 35, 'detraccion_tipo debe ser 35 (mapeo NubeFact para código SUNAT 037)');
        assert.equal(payload.detraccion_porcentaje, 12.00, 'detraccion_porcentaje debe ser 12');
        assert.equal(payload.detraccion_total, 120.00, 'detraccion_total debe ser 120');
        assert.equal(payload.medio_de_pago_detraccion, '001', 'medio_de_pago_detraccion debe ser 001 (depósito en cuenta)');

        // 3. Neto pendiente de cobro en backend
        assert.equal(facturacion.detraccion_neto, 880.00, 'El neto por cobrar al cliente debe ser exactamente 880.00');
    });
});
