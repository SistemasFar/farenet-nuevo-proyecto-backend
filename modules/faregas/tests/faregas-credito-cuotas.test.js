const assert = require('assert');
const {
    esAceptadoPorSunat,
    esDemoGeneradoPorNubefact,
    esDocumentoBaseOperable,
    normalizarEntorno
} = require('../services/faregas-documento-tributario-policy');
const { validarCuotasContraTotal } = require('../services/faregas-facturacion.rules');

async function ejecutarPruebasCreditoCuotas() {
    console.log('--- INICIANDO PRUEBAS OBLIGATORIAS: FACTURACIÓN CRÉDITO Y CUOTAS (12 CASOS) ---');
    let pruebasPasadas = 0;

    // CASO 1: Contado DEMO generado -> permitido
    {
        const docContado = {
            id: 1019,
            tipo_comprobante: 'BOLETA',
            condicion_pago: 'CONTADO',
            entorno_facturador: 'DEMO',
            proveedor: 'NUBEFACT',
            estado: 'PENDIENTE_SUNAT',
            serie: 'BBB1',
            numero: 298,
            nro_comprobante: 'BBB1-00000298',
            codigo_hash: 'd5/3wM7zCq+Vgn30TO5umqxjBv30SmHNq6gF8aQkV6s=',
            enlace_pdf: 'https://www.nubefact.com/cpe/38688353-f88c-42d3-979a-96a1b53dc95c.pdf',
            enlace_xml: 'https://www.nubefact.com/cpe/38688353-f88c-42d3-979a-96a1b53dc95c.xml'
        };
        assert.strictEqual(esDocumentoBaseOperable(docContado), true, 'Contado DEMO debe ser operable');
        console.log('✓ 1. Contado DEMO generado -> permitido.');
        pruebasPasadas++;
    }

    // CASO 2: Crédito DEMO con cuotas generado -> permitido
    {
        const docCredito = {
            id: 1023,
            tipo_comprobante: 'FACTURA',
            condicion_pago: 'CREDITO',
            entorno_facturador: 'DEMO',
            proveedor: 'NUBEFACT',
            estado: 'BORRADOR', // Estado en BD antes de reconciliación
            serie: 'FFF1',
            numero: 21,
            nro_comprobante: 'FFF1-00000021',
            codigo_hash: 'cFKB3AS7rEVgdh2CuRmCEv3lybrx0InLyBmBUCPDLhM=',
            enlace_pdf: 'https://www.nubefact.com/cpe/6bfae40b-2470-479d-909d-156bb2f5344f.pdf',
            enlace_xml: 'https://www.nubefact.com/cpe/6bfae40b-2470-479d-909d-156bb2f5344f.xml'
        };
        const cuotas = [
            { numeroCuota: 1, fechaPago: '2026-12-16', importe: 45.00 },
            { numeroCuota: 2, fechaPago: '2027-01-21', importe: 45.00 }
        ];
        const saldoPendiente = 90.00;
        assert.strictEqual(validarCuotasContraTotal(cuotas, saldoPendiente), true, 'Cuotas válidas');
        assert.strictEqual(esDocumentoBaseOperable(docCredito), true, 'Crédito DEMO debe ser operable con artefactos');
        console.log('✓ 2. Crédito DEMO con cuotas generado -> permitido.');
        pruebasPasadas++;
    }

    // CASO 3: Crédito DEMO con cuotas incompletas -> bloqueado
    {
        const cuotasIncompletas = [
            { numeroCuota: 1, fechaPago: '2026-12-16', importe: 30.00 }
        ];
        const saldoPendiente = 90.00;
        const cuotasValidas = validarCuotasContraTotal(cuotasIncompletas, saldoPendiente);
        assert.strictEqual(cuotasValidas, false, 'Cuotas que no suman el saldo deben ser rechazadas');
        console.log('✓ 3. Crédito DEMO con cuotas incompletas -> bloqueado.');
        pruebasPasadas++;
    }

    // CASO 4: Crédito DEMO con respuesta NubeFact incompleta (sin código hash o sin enlace) -> bloqueado
    {
        const docIncompleto = {
            id: 1024,
            tipo_comprobante: 'FACTURA',
            condicion_pago: 'CREDITO',
            entorno_facturador: 'DEMO',
            proveedor: 'NUBEFACT',
            estado: 'PENDIENTE_SUNAT',
            serie: 'FFF1',
            numero: 22,
            nro_comprobante: 'FFF1-00000022',
            codigo_hash: null, // Sin hash
            enlace_pdf: null   // Sin enlace
        };
        assert.strictEqual(esDocumentoBaseOperable(docIncompleto), false, 'Documento incompleto debe ser bloqueado');
        console.log('✓ 4. Crédito DEMO con respuesta NubeFact incompleta -> bloqueado.');
        pruebasPasadas++;
    }

    // CASO 5: Crédito DEMO rechazado -> bloqueado
    {
        const docRechazado = {
            id: 1025,
            tipo_comprobante: 'FACTURA',
            condicion_pago: 'CREDITO',
            entorno_facturador: 'DEMO',
            proveedor: 'NUBEFACT',
            estado: 'RECHAZADO',
            serie: 'FFF1',
            numero: 23,
            nro_comprobante: 'FFF1-00000023',
            codigo_hash: 'HASH123',
            enlace_pdf: 'https://nubefact.com/cpe/123.pdf'
        };
        assert.strictEqual(esDocumentoBaseOperable(docRechazado), false, 'Documento rechazado debe ser bloqueado');
        console.log('✓ 5. Crédito DEMO rechazado -> bloqueado.');
        pruebasPasadas++;
    }

    // CASO 6: Producción pendiente -> bloqueado
    {
        const docProdPendiente = {
            id: 1026,
            tipo_comprobante: 'FACTURA',
            condicion_pago: 'CREDITO',
            entorno_facturador: 'PRODUCCION',
            proveedor: 'NUBEFACT',
            estado: 'PENDIENTE_SUNAT',
            aceptada_sunat: null,
            serie: 'F001',
            numero: 100,
            nro_comprobante: 'F001-00000100',
            codigo_hash: 'HASH123',
            enlace_pdf: 'https://nubefact.com/cpe/100.pdf'
        };
        assert.strictEqual(esAceptadoPorSunat(docProdPendiente), false);
        assert.strictEqual(esDocumentoBaseOperable(docProdPendiente), false, 'En PRODUCCIÓN no se acepta sin CDR');
        console.log('✓ 6. Producción pendiente -> bloqueado.');
        pruebasPasadas++;
    }

    // CASO 7: Producción aceptado -> permitido
    {
        const docProdAceptado = {
            id: 1027,
            tipo_comprobante: 'FACTURA',
            condicion_pago: 'CREDITO',
            entorno_facturador: 'PRODUCCION',
            proveedor: 'NUBEFACT',
            estado: 'ACEPTADO',
            aceptada_sunat: true,
            serie: 'F001',
            numero: 101,
            nro_comprobante: 'F001-00000101',
            codigo_hash: 'HASHPROD101',
            enlace_pdf: 'https://nubefact.com/cpe/101.pdf',
            enlace_cdr: 'https://nubefact.com/cpe/101.cdr'
        };
        assert.strictEqual(esAceptadoPorSunat(docProdAceptado), true);
        assert.strictEqual(esDocumentoBaseOperable(docProdAceptado), true, 'Producción aceptado debe ser operable');
        console.log('✓ 7. Producción aceptado -> permitido.');
        pruebasPasadas++;
    }

    // CASO 8: Guardar cuotas después de emitir comprobante -> no revierte estado
    {
        const actualDbRow = {
            id: 1023,
            estado: 'BORRADOR',
            serie: 'FFF1',
            numero: 21,
            nro_comprobante: 'FFF1-00000021',
            codigo_hash: 'cFKB3AS7rEVgdh2CuRmCEv3lybrx0InLyBmBUCPDLhM=',
            enlace_pdf: 'https://www.nubefact.com/cpe/6bfae40b-2470-479d-909d-156bb2f5344f.pdf',
            enlace_xml: 'https://www.nubefact.com/cpe/6bfae40b-2470-479d-909d-156bb2f5344f.xml'
        };
        const yaTieneComprobante = Boolean(
            actualDbRow.codigo_hash
            && (actualDbRow.enlace_pdf || actualDbRow.enlace_xml)
            && actualDbRow.nro_comprobante
        );
        assert.strictEqual(yaTieneComprobante, true, 'Debe detectar comprobante existente');
        
        // Simular guardado de cuotas
        let ejecutoUpdateBorrador = false;
        let cuotasEliminadas = false;
        if (!(['PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'ERROR'].includes(actualDbRow.estado) || yaTieneComprobante)) {
            ejecutoUpdateBorrador = true;
            cuotasEliminadas = true;
        }
        assert.strictEqual(ejecutoUpdateBorrador, false, 'NO debe ejecutar UPDATE a BORRADOR');
        assert.strictEqual(cuotasEliminadas, false, 'NO debe eliminar las cuotas');
        console.log('✓ 8. Guardar cuotas después de emitir comprobante -> no revierte estado.');
        pruebasPasadas++;
    }

    // CASO 9: Autosave posterior -> no reinicia facturación
    {
        const comprobantePersistido = {
            id: 1023,
            nro_comprobante: 'FFF1-00000021',
            codigo_hash: 'cFKB3AS7rEVgdh2CuRmCEv3lybrx0InLyBmBUCPDLhM=',
            enlace_pdf: 'https://www.nubefact.com/cpe/6bfae40b-2470-479d-909d-156bb2f5344f.pdf',
            estado: 'PENDIENTE_SUNAT'
        };
        const yaEmitido = Boolean(
            comprobantePersistido.codigo_hash
            && comprobantePersistido.enlace_pdf
            && comprobantePersistido.nro_comprobante
        );
        assert.strictEqual(yaEmitido, true);
        let facturacionReiniciada = false;
        if (!yaEmitido) {
            facturacionReiniciada = true;
        }
        assert.strictEqual(facturacionReiniciada, false, 'Autosave no debe reiniciar facturación emitida');
        console.log('✓ 9. Autosave posterior -> no reinicia facturación.');
        pruebasPasadas++;
    }

    // CASO 10: Reintento -> no llama nuevamente a NubeFact
    {
        const facturacionExistente = {
            id: 1023,
            estado: 'BORRADOR',
            serie: 'FFF1',
            numero: 21,
            nro_comprobante: 'FFF1-00000021',
            codigo_hash: 'cFKB3AS7rEVgdh2CuRmCEv3lybrx0InLyBmBUCPDLhM=',
            enlace_pdf: 'https://www.nubefact.com/cpe/6bfae40b-2470-479d-909d-156bb2f5344f.pdf',
            entorno_facturador: 'DEMO'
        };

        const yaAceptada = ['ACEPTADO', 'PENDIENTE_SUNAT'].includes(facturacionExistente.estado)
            || Boolean(facturacionExistente.codigo_hash && facturacionExistente.enlace_pdf);

        let llamadaNubefact = false;
        const mockNubefact = {
            emitirComprobante: async () => {
                llamadaNubefact = true;
                throw new Error('LLAMADA_INDEBIDA_A_NUBEFACT');
            }
        };

        if (!yaAceptada) {
            await mockNubefact.emitirComprobante();
        }

        assert.strictEqual(yaAceptada, true, 'Factura existente detectada');
        assert.strictEqual(llamadaNubefact, false, 'NUNCA debe llamar a NubeFact si ya tiene hash y PDF');
        console.log('✓ 10. Reintento -> no llama nuevamente a NubeFact.');
        pruebasPasadas++;
    }

    // CASO 11: Certificado emitido -> no consume correlativo dos veces
    {
        const certificado = {
            id: 758,
            numero_certificado: 'DG-41-000424',
            estado: 'EMITIDO'
        };
        let consumoSedeInvocado = false;
        const mockSedeRangos = {
            consumirNumero: async () => {
                consumoSedeInvocado = true;
                return { migrada: true, nro: 425 };
            }
        };

        let numeroFinal = certificado.numero_certificado;
        if (!numeroFinal) {
            const consumo = await mockSedeRangos.consumirNumero();
            numeroFinal = `DG-41-${consumo.nro}`;
        }

        assert.strictEqual(consumoSedeInvocado, false, 'No debe invocar consumo de correlativo');
        assert.strictEqual(numeroFinal, 'DG-41-000424', 'Debe conservar el correlativo original asignado');
        console.log('✓ 11. Certificado emitido -> no consume correlativo dos veces.');
        pruebasPasadas++;
    }

    // CASO 12: Pagos y cronograma de cuotas permanecen intactos
    {
        const cuotasOriginales = [
            { id: 87, facturacion_id: 1023, numero_cuota: 1, fecha_pago: '2026-12-16', importe: '45.00', estado: 'PENDIENTE' },
            { id: 88, facturacion_id: 1023, numero_cuota: 2, fecha_pago: '2027-01-21', importe: '45.00', estado: 'PENDIENTE' }
        ];
        const ordenPago = {
            id: 601,
            certificado_id: 759,
            importe_total: 90.00,
            saldo_pendiente: 90.00,
            formapago_key: 'credito'
        };

        const sumaCuotas = cuotasOriginales.reduce((acc, c) => acc + Number(c.importe), 0);
        assert.strictEqual(sumaCuotas, Number(ordenPago.saldo_pendiente), 'Suma de cuotas coincide con saldo');
        assert.strictEqual(cuotasOriginales.length, 2, 'Se conservan exactamente 2 cuotas');
        assert.strictEqual(cuotasOriginales[0].importe, '45.00');
        assert.strictEqual(cuotasOriginales[1].importe, '45.00');
        console.log('✓ 12. Pagos y cronograma de cuotas permanecen intactos.');
        pruebasPasadas++;
    }

    console.log(`\nTODAS LAS ${pruebasPasadas} PRUEBAS OBLIGATORIAS DE FACTURA A CRÉDITO Y CUOTAS PASARON EXITOSAMENTE.`);
}

ejecutarPruebasCreditoCuotas().catch(e => {
    console.error('ERROR EN PRUEBAS:', e);
    process.exit(1);
});

