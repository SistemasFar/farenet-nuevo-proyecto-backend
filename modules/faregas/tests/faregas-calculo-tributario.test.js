const test = require('node:test');
const assert = require('node:assert/strict');

const calculoTributario = require('../services/faregas-calculo-tributario.service');
const {
    MAX_NUMERIC_12_2,
    MIN_NUMERIC_12_2,
    validarRangoNumeric12_2,
    aCentavosExacto,
    deCentavosExacto,
    redondearComercial,
    redondearEnteroHalfUp,
    redondear,
    aCentavos,
    deCentavos,
    calcularDesgloseGravado,
    calcularDesgloseGratuito,
    calcularDetraccion,
    distribuirCuotasExactas,
    validarCuotasContraNeto,
    esAfectacionGratuita,
    esAfectacionOnerosa,
    mapearTipoIgvNubefact,
    esCuentaBancoNacionValida,
    CATALOGO_AFECTACION_IGV,
    CATALOGO_DETRACCION_SPOT
} = calculoTributario;

const {
    normalizarFacturacion,
    validarFacturacion,
    validarCuotasContraTotal
} = require('../services/faregas-facturacion.rules');

test('1. Precisión monetaria: eliminación de errores de coma flotante y redondeo HALF_UP exacto', () => {
    // Caso clásico de IEEE 754: 0.1 + 0.2 === 0.30000000000000004
    assert.equal(0.1 + 0.2 === 0.3, false); // JavaScript nativo falla
    assert.equal(deCentavosExacto(aCentavosExacto(0.1) + aCentavosExacto(0.2)), 0.30); // Motor BigInt exacto

    // Redondeo comercial exacto en puntos medios .005 y límites
    assert.equal(redondearComercial(1.005), 1.01);
    assert.equal(redondearComercial(1.004), 1.00);
    assert.equal(redondearComercial(2.555), 2.56);
    assert.equal(redondearComercial(2.554), 2.55);
    assert.equal(redondearComercial(-1.005), -1.01);
    assert.equal(redondearComercial(-2.555), -2.56);
});

test('2. Precisión con importes grandes, valores con más de 2 decimales y límites NUMERIC(12,2)', () => {
    // Valores con más de 2 decimales
    assert.equal(redondearComercial(123.456, 2), 123.46);
    assert.equal(redondearComercial(1.0055, 3), 1.006);
    assert.equal(redondearComercial(1.0049, 2), 1.00);
    assert.equal(redondearComercial(0.12345, 2), 0.12);
    assert.equal(redondearComercial(0.12500, 2), 0.13);

    // Importes grandes dentro de límites de negocio
    const sumaGrande = deCentavosExacto(aCentavosExacto('123456789.99') + aCentavosExacto('0.01'));
    assert.equal(sumaGrande, 123456790.00);

    // Valores límite de NUMERIC(12,2) de PostgreSQL
    assert.equal(validarRangoNumeric12_2(MAX_NUMERIC_12_2), true);
    assert.equal(validarRangoNumeric12_2(MIN_NUMERIC_12_2), true);
    assert.equal(validarRangoNumeric12_2(10000000000.00), false); // Excede 12 dígitos
    assert.equal(validarRangoNumeric12_2(-10000000000.00), false);

    // Aritmética de centavos en el límite máximo
    const centavosMax = aCentavosExacto(MAX_NUMERIC_12_2);
    assert.equal(centavosMax, 999999999999n);
    assert.equal(deCentavosExacto(centavosMax), MAX_NUMERIC_12_2);
});

test('3. Desglose Gravado (18%): Base Imponible + IGV === Total exacto sin descuadre', () => {
    // Caso 1: S/ 90.00 (Servicio GLP estándar)
    const d90 = calcularDesgloseGravado(90.00);
    assert.equal(d90.total, 90.00);
    assert.equal(d90.baseImponible, 76.27);
    assert.equal(d90.igv, 13.73);
    assert.equal(redondearComercial(d90.baseImponible + d90.igv), 90.00);

    // Caso 2: S/ 508.00 (Referencia FFF1-000011)
    const d508 = calcularDesgloseGravado(508.00);
    assert.equal(d508.total, 508.00);
    assert.equal(d508.baseImponible, 430.51);
    assert.equal(d508.igv, 77.49);
    assert.equal(redondearComercial(d508.baseImponible + d508.igv), 508.00);

    // Caso 3: S/ 1,524.00 (Referencia FFF1-000010)
    const d1524 = calcularDesgloseGravado(1524.00);
    assert.equal(d1524.total, 1524.00);
    assert.equal(d1524.baseImponible, 1291.53);
    assert.equal(d1524.igv, 232.47);
    assert.equal(redondearComercial(d1524.baseImponible + d1524.igv), 1524.00);

    // Caso 4: Desglose gravado con importe límite NUMERIC(12,2)
    const dMax = calcularDesgloseGravado(MAX_NUMERIC_12_2);
    assert.equal(dMax.total, MAX_NUMERIC_12_2);
    assert.equal(dMax.baseImponible, 8474576271.18);
    assert.equal(dMax.igv, 1525423728.81);
    assert.equal(deCentavosExacto(aCentavosExacto(dMax.baseImponible) + aCentavosExacto(dMax.igv)), MAX_NUMERIC_12_2);
});

test('4. Distinción de reglas de redondeo fiscal: Comercial, IGV y SPOT (R.S. 183-2004/SUNAT)', () => {
    // Redondeo comercial: conserva 2 decimales estándar
    assert.equal(redondearComercial(60.96, 2), 60.96);
    assert.equal(redondearComercial(182.88, 2), 182.88);

    // Redondeo SPOT en Soles: según R.S. 183-2004 art. 8, se redondea a número ENTERO (0 decimales HALF_UP)
    // Caso de referencia FFF1-000012: detracción 12% sobre S/ 508.00
    // 508 * 0.12 = 60.96 -> redondeado a entero = S/ 61.00
    assert.equal(redondearEnteroHalfUp(60.96), 61);
    assert.equal(redondearEnteroHalfUp(60.49), 60);
    assert.equal(redondearEnteroHalfUp(60.50), 61);

    // Caso FFF1-000010: S/ 1,524.00 al 12%
    // 1524 * 0.12 = 182.88 -> redondeado a entero = S/ 183.00
    assert.equal(redondearEnteroHalfUp(182.88), 183);
});

test('5. Operaciones gratuitas: Catálogo 07 SUNAT, mapeo NubeFact y obligaciones tributarias', () => {
    // Referencia FFF1-000009: Operación gratuita con valor referencial S/ 27.00
    // Caso A: Bonificación gravada (SUNAT 15 -> NubeFact 6)
    const gratBonif = calcularDesgloseGratuito({ valorReferencialUnitario: 27.00, cantidad: 1, afectacion: '15' });
    assert.equal(gratBonif.esGratuito, true);
    assert.equal(gratBonif.totalExigible, 0.00); // Cliente no paga nada
    assert.equal(gratBonif.total, 0.00);
    assert.equal(gratBonif.valorReferencialTotal, 27.00);
    assert.equal(gratBonif.totalGratuito, 27.00);
    assert.equal(gratBonif.igv, 0.00); // Comprobante emitido sin cobro de IGV
    assert.equal(gratBonif.tipoIgvNubefact, 6); // NubeFact 6 = Bonificaciones
    assert.equal(gratBonif.generaDebitoEmisor, true); // El emisor asume el IGV del retiro
    assert.equal(gratBonif.igvDebitoEmisor, 4.86); // 27 * 0.18 = 4.86 asumido por el emisor

    // Caso B: Retiro por Donación (SUNAT 12 -> NubeFact 3)
    const gratDonacion = calcularDesgloseGratuito({ valorReferencialUnitario: 100.00, cantidad: 2, afectacion: '12' });
    assert.equal(gratDonacion.tipoIgvNubefact, 3);
    assert.equal(gratDonacion.valorReferencialTotal, 200.00);
    assert.equal(gratDonacion.total, 0.00);
    assert.equal(gratDonacion.igvDebitoEmisor, 36.00); // 200 * 0.18

    // Caso C: Retiro por Publicidad / Muestras (SUNAT 14 -> NubeFact 5)
    const gratPub = calcularDesgloseGratuito({ valorReferencialUnitario: 50.00, cantidad: 1, afectacion: '14' });
    assert.equal(gratPub.tipoIgvNubefact, 5);
    assert.equal(gratPub.generaDebitoEmisor, true);

    // Caso D: Exonerada - Transferencia Gratuita (SUNAT 21 -> NubeFact 21)
    const gratExon = calcularDesgloseGratuito({ valorReferencialUnitario: 150.00, cantidad: 1, afectacion: '21' });
    assert.equal(gratExon.tipoIgvNubefact, 21);
    assert.equal(gratExon.generaDebitoEmisor, false); // No genera débito fiscal
    assert.equal(gratExon.igvDebitoEmisor, 0.00);

    // Caso E: Inafecta - Retiro por Bonificación (SUNAT 31 -> NubeFact 10)
    const gratInaf = calcularDesgloseGratuito({ valorReferencialUnitario: 80.00, cantidad: 1, afectacion: '31' });
    assert.equal(gratInaf.tipoIgvNubefact, 10);
    assert.equal(gratInaf.generaDebitoEmisor, false);
    assert.equal(gratInaf.igvDebitoEmisor, 0.00);

    // Caso F. Ajuste de seguridad: Bonificación comercial vinculada a venta gravada no genera débito fiscal duplicado
    const gratBonifVinculada = calcularDesgloseGratuito({
        valorReferencialUnitario: 50.00,
        cantidad: 1,
        afectacion: '15',
        esBonificacionComercialVinculada: true
    });
    assert.equal(gratBonifVinculada.generaDebitoEmisor, false);
    assert.equal(gratBonifVinculada.igvDebitoEmisor, 0.00);

    // Caso G. Ajuste de seguridad: Rechazo de supuestos gratuitos inválidos o no catalogados
    assert.throws(() => {
        calcularDesgloseGratuito({ valorReferencialUnitario: 50.00, afectacion: '10' }); // 10 es onerosa, no gratuita
    }, /SUPUESTO_GRATUITO_INVALIDO/);
    assert.throws(() => {
        calcularDesgloseGratuito({ valorReferencialUnitario: 50.00, afectacion: '99' });
    }, /SUPUESTO_GRATUITO_INVALIDO/);

    // Verificación de mapeo universal SUNAT -> NubeFact
    assert.equal(mapearTipoIgvNubefact('10'), 1); // Gravado oneroso
    assert.equal(mapearTipoIgvNubefact('11'), 2); // Retiro premio
    assert.equal(mapearTipoIgvNubefact('12'), 3); // Retiro donacion
    assert.equal(mapearTipoIgvNubefact('13'), 4); // Retiro propio
    assert.equal(mapearTipoIgvNubefact('14'), 5); // Retiro publicidad
    assert.equal(mapearTipoIgvNubefact('15'), 6); // Bonificacion
    assert.equal(mapearTipoIgvNubefact('16'), 7); // Entrega trabajadores
    assert.equal(mapearTipoIgvNubefact('20'), 8); // Exonerado oneroso
    assert.equal(mapearTipoIgvNubefact('30'), 9); // Inafecto oneroso
    assert.equal(mapearTipoIgvNubefact('21'), 21); // Exonerado gratuito
});

test('6. Detracciones SPOT: umbrales específicos, validación de cuenta BN, moneda y excepciones', () => {
    const cuentaBNValida = '00000123456';

    // A. Umbral específico de Servicios Generales (Código 022, umbral S/ 700.00)
    // S/ 508.00 no supera el umbral de S/ 700 por defecto y no aplica
    const det508Normal = calcularDetraccion({
        total: 508.00,
        codigoSpot: '022',
        cuentaBancoNacion: cuentaBNValida
    });
    assert.equal(det508Normal.aplica, false);
    assert.equal(det508Normal.montoDetraccion, 0.00);
    assert.equal(det508Normal.montoNetoPendiente, 508.00);

    // B. Comprobante de referencia FFF1-000012: S/ 508.00 con excepción legal justificada
    // (ej. contrato de suministro periódico o acumulación de operaciones según Art. 4 R.S. 183-2004)
    // 508 * 0.12 = 60.96 -> redondeado a entero SUNAT SPOT = S/ 61.00
    const det508Justificado = calcularDetraccion({
        total: 508.00,
        codigoSpot: '022',
        porcentaje: 12.00,
        cuentaBancoNacion: cuentaBNValida,
        motivoExcepcion: 'EXCEPCION_CONTRATO_SUMINISTRO_PERIODICO'
    });
    assert.equal(det508Justificado.aplica, true);
    assert.equal(det508Justificado.montoDetraccionSoles, 61); // Entero exacto como en FFF1-000012
    assert.equal(det508Justificado.montoDetraccion, 61.00);
    assert.equal(det508Justificado.montoNetoPendiente, 447.00); // 508 - 61 = 447 exacto
    assert.equal(det508Justificado.montoDetraccion + det508Justificado.montoNetoPendiente, 508.00);

    // Rechazo de excepciones no justificadas o arbitrarias
    assert.throws(() => {
        calcularDetraccion({
            total: 508.00,
            codigoSpot: '022',
            cuentaBancoNacion: cuentaBNValida,
            motivoExcepcion: 'MOTIVO_INVENTADO'
        });
    }, /EXCEPCION_DETRACCION_NO_JUSTIFICADA/);

    // C. Transporte de Carga (027 según R.S. 073-2006, umbral S/ 400.00, tasa 4%)
    // Exige comparar importe con Valor Referencial del MTC y bloquea si no existe información suficiente
    assert.throws(() => {
        calcularDetraccion({
            total: 500.00,
            codigoSpot: '027',
            cuentaBancoNacion: cuentaBNValida
            // Falta valorReferencialMtc
        });
    }, /exige consignar el valor referencial preliminar del MTC/);

    // S/ 500.00 con valor referencial MTC de S/ 450.00 -> Base = 500.00 (> 400.00), tasa 4% = S/ 20.00
    const detCarga1 = calcularDetraccion({
        total: 500.00,
        codigoSpot: '027',
        cuentaBancoNacion: cuentaBNValida,
        valorReferencialMtc: 450.00
    });
    assert.equal(detCarga1.aplica, true);
    assert.equal(detCarga1.porcentaje, 4.00);
    assert.equal(detCarga1.umbral, 400.00);
    assert.equal(detCarga1.montoDetraccion, 20.00); // 500 * 0.04 = 20.00
    assert.equal(detCarga1.montoNetoPendiente, 480.00);
    assert.equal(detCarga1.sunatTransactionNubefact, 31);

    // Operación S/ 500.00 con valor referencial MTC de S/ 600.00 -> Toma el mayor (S/ 600.00), tasa 4% = S/ 24.00
    const detCargaMayorMtc = calcularDetraccion({
        total: 500.00,
        codigoSpot: '027',
        cuentaBancoNacion: cuentaBNValida,
        valorReferencialMtc: 600.00
    });
    assert.equal(detCargaMayorMtc.baseCalculoDetraccionSoles, 600.00);
    assert.equal(detCargaMayorMtc.montoDetraccion, 24.00); // 600 * 0.04 = 24.00
    assert.equal(detCargaMayorMtc.montoNetoPendiente, 476.00); // 500 - 24 = 476.00

    // D. Exclusión legal: Boleta de venta no admite detracción
    const detBoleta = calcularDetraccion({
        total: 1000.00,
        codigoSpot: '022',
        tipoComprobante: 'BOLETA'
    });
    assert.equal(detBoleta.aplica, false);
    assert.equal(detBoleta.motivoNoAplica, 'COMPROBANTE_NO_SUJETO_A_DETRACCION');

    // E. Bloqueo por código SPOT inválido o no vigente
    assert.throws(() => {
        calcularDetraccion({
            total: 1000.00,
            codigoSpot: '999_INVALIDO',
            cuentaBancoNacion: cuentaBNValida
        });
    }, /El codigo SPOT '999_INVALIDO' no existe o no esta vigente/);

    // F. Validación de formato de cuenta corriente Banco de la Nación (11 dígitos)
    assert.equal(esCuentaBancoNacionValida('00000123456'), true);
    assert.equal(esCuentaBancoNacionValida('00-000-123456'), true);
    assert.equal(esCuentaBancoNacionValida('12345'), false); // Cuenta corta
    assert.equal(esCuentaBancoNacionValida('ABCDEFGHIJK'), false);

    assert.throws(() => {
        calcularDetraccion({
            total: 1000.00,
            codigoSpot: '022',
            cuentaBancoNacion: '12345'
        });
    }, /CUENTA_BANCO_NACION_INVALIDA/);

    // G. Factura en USD con conversión mediante Tipo de Cambio oficial
    const detUSD = calcularDetraccion({
        total: 1000.00,
        moneda: 'USD',
        tipoCambio: 3.75,
        codigoSpot: '022',
        porcentaje: 12.00,
        cuentaBancoNacion: cuentaBNValida
    });
    // Base en Soles = 1000 * 3.75 = S/ 3,750.00 (> S/ 700)
    // Detracción en Soles = 3750 * 0.12 = S/ 450.00
    // Detracción en USD = 450 / 3.75 = $ 120.00
    // Saldo neto en USD = 1000 - 120 = $ 880.00
    assert.equal(detUSD.aplica, true);
    assert.equal(detUSD.totalEnSoles, 3750.00);
    assert.equal(detUSD.montoDetraccionSoles, 450);
    assert.equal(detUSD.montoDetraccion, 120.00);
    assert.equal(detUSD.montoNetoPendiente, 880.00);
});

test('7. Distribución de cuotas de crédito con residuos y cuadre exacto (R.S. 193-2020)', () => {
    // Caso 1: Residuo de centavos en 3 cuotas sobre S/ 100.00 -> 33.33, 33.33, 33.34
    const cuotas100 = distribuirCuotasExactas({ montoTotal: 100.00, numeroCuotas: 3 });
    assert.equal(cuotas100.length, 3);
    assert.equal(cuotas100[0].importe, 33.33);
    assert.equal(cuotas100[1].importe, 33.33);
    assert.equal(cuotas100[2].importe, 33.34); // Absorbe el residuo
    assert.equal(deCentavosExacto(cuotas100.reduce((acc, c) => acc + aCentavosExacto(c.importe), 0n)), 100.00);

    // Caso 2: Referencia FFF1-000010: S/ 1,524.00 en 3 cuotas exactas de S/ 508.00
    const cuotas1524 = distribuirCuotasExactas({ montoTotal: 1524.00, numeroCuotas: 3 });
    assert.equal(cuotas1524.length, 3);
    assert.equal(cuotas1524[0].importe, 508.00);
    assert.equal(cuotas1524[1].importe, 508.00);
    assert.equal(cuotas1524[2].importe, 508.00);
    assert.equal(deCentavosExacto(cuotas1524.reduce((acc, c) => acc + aCentavosExacto(c.importe), 0n)), 1524.00);

    // Caso 3: S/ 700.01 en 3 cuotas
    const cuotas700 = distribuirCuotasExactas({ montoTotal: 700.01, numeroCuotas: 3 });
    assert.equal(cuotas700[0].importe, 233.33);
    assert.equal(cuotas700[1].importe, 233.33);
    assert.equal(cuotas700[2].importe, 233.35); // 233.33 + 233.33 + 233.35 === 700.01
    assert.equal(deCentavosExacto(cuotas700.reduce((acc, c) => acc + aCentavosExacto(c.importe), 0n)), 700.01);

    // Caso 4: Cuotas en operación sujeta a detracción (R.S. 193-2020/SUNAT)
    // Comprobante FFF1-000012: S/ 508.00, detracción S/ 61.00 -> Neto pendiente = S/ 447.00
    const det508 = calcularDetraccion({
        total: 508.00,
        codigoSpot: '022',
        cuentaBancoNacion: '00000123456',
        motivoExcepcion: 'EXCEPCION_CONTRATO_SUMINISTRO_PERIODICO'
    });
    const cuotasCreditoNeto = [{ numeroCuota: 1, importe: 447.00 }];
    const validacionNeto = validarCuotasContraNeto({ cuotas: cuotasCreditoNeto, total: 508.00, detraccion: det508 });
    assert.equal(validacionNeto.valido, true);
    assert.equal(validacionNeto.montoEsperado, 447.00);

    // Si se intentara cuadrar contra el total bruto de S/ 508.00, debe fallar por no descontar la detracción
    const cuotasBrutas = [{ numeroCuota: 1, importe: 508.00 }];
    const validacionBruto = validarCuotasContraNeto({ cuotas: cuotasBrutas, total: 508.00, detraccion: det508 });
    assert.equal(validacionBruto.valido, false);
});

test('8. Validación de Facturación en faregas-facturacion.rules.js con detracción y gratuidad', () => {
    // Detracción válida
    const factValidaDet = normalizarFacturacion({
        tipoComprobante: 'FACTURA',
        tipoDocumentoCliente: 'RUC',
        nroDocumento: '20600444531',
        nombreRazonSocial: 'EMPRESA CLIENTE SAC',
        direccion: 'AV. PRINCIPAL 123',
        condicionPago: 'CONTADO',
        esDetraccion: true,
        detraccionTipo: '022',
        detraccionPorcentaje: 12.00,
        detraccionCuentaBanco: '00000123456'
    });
    const errsValida = validarFacturacion(factValidaDet);
    assert.equal(errsValida.length, 0);

    // Detracción en Boleta debe ser rechazada
    const factBoletaDet = normalizarFacturacion({
        tipoComprobante: 'BOLETA',
        tipoDocumentoCliente: 'DNI',
        nroDocumento: '12345678',
        nombreRazonSocial: 'JUAN PEREZ',
        direccion: 'CALLE 1',
        condicionPago: 'CONTADO',
        esDetraccion: true,
        detraccionTipo: '022'
    });
    const errsBoletaDet = validarFacturacion(factBoletaDet);
    assert.equal(errsBoletaDet.includes('Las operaciones sujetas a detraccion SPOT solo aplican a FACTURA.'), true);

    // Falta código SPOT
    const factSinCodigo = normalizarFacturacion({
        tipoComprobante: 'FACTURA',
        tipoDocumentoCliente: 'RUC',
        nroDocumento: '20600444531',
        nombreRazonSocial: 'EMPRESA SAC',
        direccion: 'AV. 1',
        condicionPago: 'CONTADO',
        esDetraccion: true,
        detraccionTipo: ''
    });
    const errsSinCodigo = validarFacturacion(factSinCodigo);
    assert.equal(errsSinCodigo.includes('Una operacion con detraccion requiere el codigo de bien o servicio SPOT SUNAT (Catalogo 54).'), true);

    // Operación gratuita no permite crédito ni cuotas
    const factGratCredito = normalizarFacturacion({
        tipoComprobante: 'FACTURA',
        tipoDocumentoCliente: 'RUC',
        nroDocumento: '20600444531',
        nombreRazonSocial: 'EMPRESA SAC',
        direccion: 'AV. 1',
        condicionPago: 'CREDITO',
        esGratuito: true,
        cuotas: [{ numeroCuota: 1, importe: 50.00 }]
    });
    const errsGrat = validarFacturacion(factGratCredito);
    assert.equal(errsGrat.includes('Una operacion a titulo gratuito solo admite condicion de pago CONTADO.'), true);
    assert.equal(errsGrat.includes('Una operacion a titulo gratuito no admite cuotas de credito.'), true);
});

test('9. Compatibilidad retroactiva: comprobantes al contado y crédito existentes sin detracción', () => {
    // Comprobante estándar al contado no se altera
    const factContado = normalizarFacturacion({
        tipoComprobante: 'BOLETA',
        tipoDocumentoCliente: 'DNI',
        nroDocumento: '12345678',
        nombreRazonSocial: 'JUAN PEREZ',
        direccion: 'CALLE 123',
        condicionPago: 'CONTADO'
    });
    assert.equal(factContado.esDetraccion, false);
    assert.equal(factContado.esGratuito, false);
    assert.equal(validarFacturacion(factContado).length, 0);

    // Comprobante estándar a crédito sin detracción cuadra cuotas exactamente contra total bruto
    const cuotasNormales = [{ numeroCuota: 1, importe: 100.00 }];
    assert.equal(validarCuotasContraTotal(cuotasNormales, 100.00), true);
    assert.equal(validarCuotasContraTotal(cuotasNormales, 99.99), false);
});
