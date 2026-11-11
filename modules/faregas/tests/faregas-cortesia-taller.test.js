const test = require('node:test');
const assert = require('node:assert/strict');
const {
    esFlujoTaller,
    esCodigoCortesia,
    esCortesiaAutorizada,
    esCodigoGratuidadTaller,
    esGratuidadTallerAutorizada,
    obtenerCodigoAutorizacion,
    CODIGO_AUTORIZACION_GRATUIDAD_TALLER,
    CODIGO_AUTORIZACION_CORTESIA
} = require('../services/faregas-gratuidad-taller.policy');
const { construirPayloadNubefact } = require('../integrations/nubefact-faregas.adapter');

test('FAREGAS — Suite completa de pruebas: Pagos normales y Modalidad Cortesía', async (t) => {
    // -------------------------------------------------------------
    // PRUEBAS DE ROBUSTEZ: datos de cortesía null / undefined
    // -------------------------------------------------------------
    await t.test('11. Datos de cortesía null no causan TypeError y devuelven false', () => {
        // Reproducción exacta del bug reportado:
        // TypeError: Cannot read properties of null (reading 'codigo_autorizacion')
        assert.doesNotThrow(() => {
            const codigo = obtenerCodigoAutorizacion(null);
            assert.equal(codigo, '');
        });

        assert.doesNotThrow(() => {
            const esCortesia = esGratuidadTallerAutorizada({
                reserva: null,
                tipoFlujo: 'CERTIFICACION'
            });
            assert.equal(esCortesia, false);
        });

        assert.doesNotThrow(() => {
            const esCortesiaTaller = esGratuidadTallerAutorizada({
                reserva: null,
                tipoFlujo: 'TALLER_INSPECCION'
            });
            assert.equal(esCortesiaTaller, false);
        });
    });

    await t.test('12. Datos de cortesía undefined no causan TypeError y devuelven false', () => {
        assert.doesNotThrow(() => {
            const codigo = obtenerCodigoAutorizacion(undefined);
            assert.equal(codigo, '');
        });

        assert.doesNotThrow(() => {
            const esCortesia = esGratuidadTallerAutorizada({
                reserva: undefined,
                tipoFlujo: undefined
            });
            assert.equal(esCortesia, false);
        });

        assert.doesNotThrow(() => {
            const esCortesiaVacio = esGratuidadTallerAutorizada({});
            assert.equal(esCortesiaVacio, false);
        });

        assert.doesNotThrow(() => {
            const esCortesiaSinArgs = esGratuidadTallerAutorizada();
            assert.equal(esCortesiaSinArgs, false);
        });
    });

    // -------------------------------------------------------------
    // SIMULADOR DE FLUJO DE PAGOS (LÓGICA DE BACKEND: guardarPagos)
    // -------------------------------------------------------------
    const procesarGuardarPagosBackend = ({
        tipoFlujo,
        reservaDescuento,
        importeSolicitado,
        condicionPago = 'CONTADO',
        pagos = []
    }) => {
        // Paso 1: Detección estricta y segura de cortesía
        const esCortesia = esGratuidadTallerAutorizada({
            reserva: reservaDescuento,
            tipoFlujo
        });

        // Paso 2: Validaciones de negocio
        if (esCortesia) {
            if (pagos.length > 0) throw new Error('CORTESIA_NO_ADMITE_PAGOS');
            if (condicionPago === 'CREDITO') throw new Error('CORTESIA_NO_ADMITE_CREDITO');
            if (importeSolicitado !== 0) throw new Error('CORTESIA_IMPORTE_DEBE_SER_CERO');
            return {
                estadoOrden: 'PAGADO',
                importeTotal: 0,
                importePagado: 0,
                saldoPendiente: 0,
                esCortesia: true
            };
        }

        // Si NO es cortesía pero intentan enviar importe cero sin autorización
        if (importeSolicitado === 0) {
            throw new Error('OPERACION_CERO_REQUIERE_AUTORIZACION_GRATUITA');
        }

        // Paso 3: Flujo ordinario de pagos normales
        const totalPagado = pagos.reduce((s, p) => s + Number(p.importe || 0), 0);
        if (totalPagado - importeSolicitado > 0.009) throw new Error('PAGO_EXCEDE_TOTAL');

        const saldo = Math.max(0, Math.round((importeSolicitado - totalPagado) * 100) / 100);
        const estado = (condicionPago === 'CONTADO' && saldo === 0) || (condicionPago === 'CREDITO')
            ? (saldo === 0 ? 'PAGADO' : 'PENDIENTE')
            : 'PENDIENTE';

        return {
            estadoOrden: estado,
            importeTotal: importeSolicitado,
            importePagado: totalPagado,
            saldoPendiente: saldo,
            esCortesia: false
        };
    };

    // -------------------------------------------------------------
    // CASOS DE PAGOS NORMALES
    // -------------------------------------------------------------
    await t.test('1. Pago normal en EFECTIVO de S/ 80.00 sin cortesía (caso real reportado)', () => {
        const resultado = procesarGuardarPagosBackend({
            tipoFlujo: 'CERTIFICACION',
            reservaDescuento: null, // Sin descuento registrado
            importeSolicitado: 80.00,
            condicionPago: 'CONTADO',
            pagos: [{ tipo: 'efectivo', importe: 80.00 }]
        });

        assert.equal(resultado.esCortesia, false);
        assert.equal(resultado.importeTotal, 80.00);
        assert.equal(resultado.importePagado, 80.00);
        assert.equal(resultado.saldoPendiente, 0.00);
        assert.equal(resultado.estadoOrden, 'PAGADO');
    });

    await t.test('2. Pago normal con TARJETA / VISA', () => {
        const resultado = procesarGuardarPagosBackend({
            tipoFlujo: 'CERTIFICACION',
            reservaDescuento: null,
            importeSolicitado: 100.00,
            condicionPago: 'CONTADO',
            pagos: [{ tipo: 'tarjeta', tarjetaKey: 'VISA', nroOperacion: '123456', importe: 100.00 }]
        });

        assert.equal(resultado.esCortesia, false);
        assert.equal(resultado.importeTotal, 100.00);
        assert.equal(resultado.importePagado, 100.00);
        assert.equal(resultado.saldoPendiente, 0.00);
        assert.equal(resultado.estadoOrden, 'PAGADO');
    });

    await t.test('3. Pago normal con TARJETA / PLIN', () => {
        const resultado = procesarGuardarPagosBackend({
            tipoFlujo: 'CERTIFICACION',
            reservaDescuento: null,
            importeSolicitado: 90.00,
            condicionPago: 'CONTADO',
            pagos: [{ tipo: 'tarjeta', tarjetaKey: '8', nroOperacion: '987654', importe: 90.00 }]
        });

        assert.equal(resultado.esCortesia, false);
        assert.equal(resultado.importePagado, 90.00);
        assert.equal(resultado.saldoPendiente, 0.00);
    });

    await t.test('4. Pago normal con BANCO (Depósito / Transferencia)', () => {
        const resultado = procesarGuardarPagosBackend({
            tipoFlujo: 'CERTIFICACION',
            reservaDescuento: null,
            importeSolicitado: 150.00,
            condicionPago: 'CONTADO',
            pagos: [{ tipo: 'banco', entidadFinancieraKey: 'BCP', nroOperacion: 'OP-5544', importe: 150.00 }]
        });

        assert.equal(resultado.esCortesia, false);
        assert.equal(resultado.importeTotal, 150.00);
        assert.equal(resultado.importePagado, 150.00);
        assert.equal(resultado.saldoPendiente, 0.00);
    });

    await t.test('5. Pago normal MIXTO (EFECTIVO + TARJETA)', () => {
        const resultado = procesarGuardarPagosBackend({
            tipoFlujo: 'CERTIFICACION',
            reservaDescuento: null,
            importeSolicitado: 120.00,
            condicionPago: 'CONTADO',
            pagos: [
                { tipo: 'efectivo', importe: 50.00 },
                { tipo: 'tarjeta', tarjetaKey: 'YAPE', nroOperacion: '8877', importe: 70.00 }
            ]
        });

        assert.equal(resultado.esCortesia, false);
        assert.equal(resultado.importePagado, 120.00);
        assert.equal(resultado.saldoPendiente, 0.00);
        assert.equal(resultado.estadoOrden, 'PAGADO');
    });

    await t.test('6. Facturación a CRÉDITO con cuotas (sin pago inicial)', () => {
        const resultado = procesarGuardarPagosBackend({
            tipoFlujo: 'CERTIFICACION',
            reservaDescuento: null,
            importeSolicitado: 180.00,
            condicionPago: 'CREDITO',
            pagos: [] // Venta financiada al 100%
        });

        assert.equal(resultado.esCortesia, false);
        assert.equal(resultado.importeTotal, 180.00);
        assert.equal(resultado.importePagado, 0.00);
        assert.equal(resultado.saldoPendiente, 180.00);
        assert.equal(resultado.estadoOrden, 'PENDIENTE');
    });

    await t.test('7. Servicio de TALLER con pago normal (importe > 0 sin cortesía)', () => {
        const resultado = procesarGuardarPagosBackend({
            tipoFlujo: 'TALLER_INSPECCION',
            reservaDescuento: null, // El cliente paga la tarifa completa
            importeSolicitado: 350.00,
            condicionPago: 'CONTADO',
            pagos: [{ tipo: 'efectivo', importe: 350.00 }]
        });

        assert.equal(resultado.esCortesia, false);
        assert.equal(resultado.importeTotal, 350.00);
        assert.equal(resultado.importePagado, 350.00);
        assert.equal(resultado.saldoPendiente, 0.00);
        assert.equal(resultado.estadoOrden, 'PAGADO');
    });

    // -------------------------------------------------------------
    // CASOS DE CORTESÍA Y SEGURIDAD
    // -------------------------------------------------------------
    await t.test('8. Servicio de TALLER con CORTESÍA autorizada', () => {
        const resultado = procesarGuardarPagosBackend({
            tipoFlujo: 'TALLER_INSPECCION',
            reservaDescuento: {
                codigo_autorizacion: 'DESCUENTO_TALLER',
                importe_original: 350.00,
                importe_descuento: 350.00
            },
            importeSolicitado: 0.00,
            condicionPago: 'CONTADO',
            pagos: []
        });

        assert.equal(resultado.esCortesia, true);
        assert.equal(resultado.importeTotal, 0.00);
        assert.equal(resultado.importePagado, 0.00);
        assert.equal(resultado.saldoPendiente, 0.00);
        assert.equal(resultado.estadoOrden, 'PAGADO');
    });

    await t.test('9. Servicio de TALLER con CORTESÍA sin autorización (intento de monto 0)', () => {
        assert.throws(() => {
            procesarGuardarPagosBackend({
                tipoFlujo: 'TALLER_INSPECCION',
                reservaDescuento: null, // Sin autorización de gratuidad
                importeSolicitado: 0.00,
                condicionPago: 'CONTADO',
                pagos: []
            });
        }, /OPERACION_CERO_REQUIERE_AUTORIZACION_GRATUITA/);

        // O con un código de descuento no autorizado
        assert.throws(() => {
            procesarGuardarPagosBackend({
                tipoFlujo: 'TALLER_INSPECCION',
                reservaDescuento: { codigo_autorizacion: 'DESCUENTO_GENERAL' },
                importeSolicitado: 0.00,
                condicionPago: 'CONTADO',
                pagos: []
            });
        }, /OPERACION_CERO_REQUIERE_AUTORIZACION_GRATUITA/);
    });

    await t.test('10. CORTESÍA autorizada aplica a GNV, GLP, Conformidad y Taller', () => {
        for (const tipo of ['GNV_ANUAL', 'GLP_INICIAL', 'CONFORMIDAD', 'TALLER_0423']) {
            const resultado = procesarGuardarPagosBackend({
                tipoFlujo: tipo === 'TALLER_0423' ? 'TALLER_INSPECCION' : 'CERTIFICACION',
                reservaDescuento: { codigo_autorizacion: CODIGO_AUTORIZACION_CORTESIA },
                importeSolicitado: 0.00,
                condicionPago: 'CONTADO',
                pagos: []
            });
            assert.equal(resultado.esCortesia, true, tipo);
            assert.equal(resultado.saldoPendiente, 0, tipo);
        }
        assert.equal(esCodigoCortesia('CORTESIA_FAREGAS'), true);
        assert.equal(esCortesiaAutorizada({ reserva: { codigo_autorizacion: 'CORTESIA_FAREGAS' } }), true);
    });

    await t.test('13. Cambio de CORTESÍA a pago normal restaura tarifa y validaciones de pago', () => {
        // Paso A: Inicialmente era cortesía
        const pasoCortesia = procesarGuardarPagosBackend({
            tipoFlujo: 'TALLER_INSPECCION',
            reservaDescuento: { codigo_autorizacion: 'DESCUENTO_TALLER' },
            importeSolicitado: 0.00,
            condicionPago: 'CONTADO',
            pagos: []
        });
        assert.equal(pasoCortesia.esCortesia, true);
        assert.equal(pasoCortesia.importeTotal, 0.00);

        // Paso B: Operador decide cambiar a pago normal (elimina la reserva de descuento)
        const pasoNormal = procesarGuardarPagosBackend({
            tipoFlujo: 'TALLER_INSPECCION',
            reservaDescuento: null,
            importeSolicitado: 350.00,
            condicionPago: 'CONTADO',
            pagos: [{ tipo: 'efectivo', importe: 350.00 }]
        });
        assert.equal(pasoNormal.esCortesia, false);
        assert.equal(pasoNormal.importeTotal, 350.00);
        assert.equal(pasoNormal.importePagado, 350.00);
        assert.equal(pasoNormal.saldoPendiente, 0.00);
        assert.equal(pasoNormal.estadoOrden, 'PAGADO');
    });

    await t.test('14. Guardado y recuperación de borrador: normal vs cortesía', () => {
        // Borrador 1: Normal con pago parcial pendiente
        const borradorNormal = procesarGuardarPagosBackend({
            tipoFlujo: 'CERTIFICACION',
            reservaDescuento: null,
            importeSolicitado: 100.00,
            condicionPago: 'CONTADO',
            pagos: [{ tipo: 'efectivo', importe: 40.00 }]
        });
        assert.equal(borradorNormal.estadoOrden, 'PENDIENTE');
        assert.equal(borradorNormal.saldoPendiente, 60.00);

        // Borrador 2: Cortesía recuperada
        const borradorCortesia = procesarGuardarPagosBackend({
            tipoFlujo: 'TALLER_INSPECCION',
            reservaDescuento: { codigo_autorizacion: 'DESCUENTO_TALLER' },
            importeSolicitado: 0.00,
            condicionPago: 'CONTADO',
            pagos: []
        });
        assert.equal(borradorCortesia.estadoOrden, 'PAGADO');
        assert.equal(borradorCortesia.saldoPendiente, 0.00);
    });

    // -------------------------------------------------------------
    // PRUEBAS DE PAYLOAD NUBEFACT FISCAL PARA CORTESÍA
    // -------------------------------------------------------------
    await t.test('Payload NubeFact de CORTESÍA: genera transferencia gratuita formal con SUNAT 1002', () => {
        const payload = construirPayloadNubefact({
            facturacion: {
                id: 9999,
                tipo_comprobante: 'FACTURA',
                serie: 'FFF1',
                numero: 888,
                nro_documento: '20123456789',
                nombre_razon_social: 'TALLER AUTORIZADO SAC',
                direccion: 'AV. PRINCIPAL 123',
                tipo_documento_cliente: 'RUC',
                fecha_documento: '2026-11-10',
                condicion_pago: 'CONTADO',
                importe_total: 0,
                base_imponible: 0,
                igv: 0
            },
            certificado: {
                id: 1234,
                tipo_certificado_clave: 'TALLER_0423',
                servicio_tipo_flujo: 'TALLER_INSPECCION',
                formato_datos_snapshot: { taller: { nombre: 'TALLER NORTE GNV' } }
            },
            reservaDescuento: {
                codigo_autorizacion: 'CORTESIA_FAREGAS',
                importe_original: 350.00,
                importe_descuento: 350.00,
                importe_final: 0.00
            },
            detalles: [
                {
                    unidad_snapshot: 'ZZ',
                    codigo_sku_snapshot: 'CERT-TALLER-GLP',
                    descripcion_snapshot: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GLP',
                    cantidad: 1,
                    valor_unitario: 296.61,
                    precio_unitario: 350.00,
                    descuento: 296.61,
                    base_imponible: 0.00,
                    subtotal: 0.00,
                    igv: 0.00,
                    total: 0.00,
                    importe_total: 0.00
                }
            ]
        });

        assert.equal(payload.total, 0.00, 'Total a pagar debe ser S/ 0.00');
        assert.equal(payload.total_gravada, 0.00, 'Total gravada debe ser 0');
        assert.equal(payload.total_igv, 0.00, 'Total IGV debe ser 0');
        assert.equal(payload.total_gratuita, 350.00, 'Total gratuita debe conservar el precio referencial (350.00)');
        assert.equal(payload.condiciones_de_pago, 'CONTADO');
        assert.equal(payload.forma_de_pago, 'Contado');
        assert.equal(payload.medio_de_pago, '', 'Medio de pago no debe consignar efectivo ni tarjetas');
        assert.equal(payload.cancelado, true);

        assert.equal(payload.items.length, 1);
        const item = payload.items[0];
        assert.equal(item.tipo_de_igv, 6, 'Afectación al IGV debe ser 6 (Gratuita)');
        assert.equal(item.valor_unitario, 350.00);
        assert.equal(item.precio_unitario, 350.00);
        assert.equal(item.igv, 0.00);

        assert.equal(payload.leyendas.length, 1);
        assert.equal(payload.leyendas[0].codigo, '1002');
        assert.match(payload.leyendas[0].valor, /TRANSFERENCIA GRATUITA/);
    });

    await t.test('15. Borradores 784/785 con descuento_id = 17 y descuento_cliente_id = null son reconocidos como cortesía autorizada', () => {
        // Caso exacto de certificados 784 y 785
        const reserva784 = {
            id: 43,
            descuento_id: 17,
            descuento_cliente_id: null,
            codigo_autorizacion: 'D_CONVENIO_a88137bb742f4157',
            descuento_nombre: 'DESCUENTO CERTIFICADO TALLER',
            importe_original: '350.00',
            importe_final: '0.00',
            estado: 'RESERVADO'
        };
        assert.equal(esCortesiaAutorizada({ reserva: reserva784 }), true);
        assert.equal(esGratuidadTallerAutorizada({ reserva: reserva784 }), true);

        const reserva785 = {
            id: 44,
            descuento_id: 17,
            descuento_cliente_id: null,
            codigo_autorizacion: 'D_CONVENIO_a88137bb742f4157',
            descuento_nombre: 'DESCUENTO CERTIFICADO TALLER',
            importe_original: '350.00',
            importe_final: '0.00',
            estado: 'APLICADO'
        };
        assert.equal(esCortesiaAutorizada({ reserva: reserva785 }), true);
        assert.equal(esGratuidadTallerAutorizada({ reserva: reserva785 }), true);
    });

    await t.test('16. Reconocimiento con hash de convenio maestro D_CONVENIO_a88137bb742f4157', () => {
        assert.equal(esCodigoCortesia('D_CONVENIO_a88137bb742f4157'), true);
        assert.equal(esCodigoCortesia('d_convenio_a88137bb742f4157'), true);
        assert.equal(esCodigoCortesia('CORTESIA_FAREGAS'), true);
        assert.equal(esCodigoCortesia('DESCUENTO_TALLER'), true);
        assert.equal(esCodigoCortesia('OTRO_CODIGO'), false);
    });

    await t.test('17. Emisión de cortesía soporta tanto FACTURA (RUC) como BOLETA (DNI)', () => {
        const payloadFactura = construirPayloadNubefact({
            facturacion: {
                id: 1081,
                tipo_comprobante: 'FACTURA',
                tipo_documento_cliente: 'RUC',
                nro_documento: '20600444531',
                nombre_razon_social: 'EMPRESA CLIENTE SAC',
                direccion: 'AV. PRINCIPAL 123',
                serie: 'FFF1',
                numero: 99,
                importe_total: 0,
                base_imponible: 0,
                igv: 0,
                fecha_documento: '2026-11-10'
            },
            reservaDescuento: {
                descuento_id: 17,
                codigo_autorizacion: 'CORTESIA_FAREGAS',
                importe_original: 350,
                importe_descuento: 350
            }
        });
        assert.equal(payloadFactura.tipo_de_comprobante, 1, 'Factura es tipo 1');
        assert.equal(payloadFactura.cliente_tipo_de_documento, 6, 'RUC es tipo 6');
        assert.equal(payloadFactura.total_gratuita, 350);

        const payloadBoleta = construirPayloadNubefact({
            facturacion: {
                id: 1082,
                tipo_comprobante: 'BOLETA',
                tipo_documento_cliente: 'DNI',
                nro_documento: '44556677',
                nombre_razon_social: 'JUAN PEREZ',
                direccion: 'CALLE 1 123',
                serie: 'BBB1',
                numero: 100,
                importe_total: 0,
                base_imponible: 0,
                igv: 0,
                fecha_documento: '2026-11-10'
            },
            reservaDescuento: {
                descuento_id: 17,
                codigo_autorizacion: 'CORTESIA_FAREGAS',
                importe_original: 350,
                importe_descuento: 350
            }
        });
        assert.equal(payloadBoleta.tipo_de_comprobante, 2, 'Boleta es tipo 2');
        assert.equal(payloadBoleta.cliente_tipo_de_documento, 1, 'DNI es tipo 1');
        assert.equal(payloadBoleta.total_gratuita, 350);
    });
});
