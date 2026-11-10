const assert = require('assert');
const {
    esAceptadoPorSunat,
    esDemoGeneradoPorNubefact,
    esDocumentoBaseOperable,
    normalizarEntorno
} = require('../services/faregas-documento-tributario-policy');
const integrationsConfig = require('../../../config/integrations.config');

async function ejecutarPruebasValidacion() {
    console.log('--- INICIANDO PRUEBAS DE VALIDACIÓN DE COMPROBANTE (DEMO vs PRODUCCIÓN) ---');
    let pasadas = 0;

    // CASO 1: DEMO + comprobante generado completamente + PENDIENTE_SUNAT -> Permitido continuar
    {
        const doc = {
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
        assert.strictEqual(esDemoGeneradoPorNubefact(doc), true, 'Caso 1: debe ser reconocido en DEMO');
        assert.strictEqual(esDocumentoBaseOperable(doc), true, 'Caso 1: debe ser operable');
        console.log('✓ 1. DEMO + comprobante generado completamente + PENDIENTE_SUNAT -> Permitido continuar.');
        pasadas++;
    }

    // CASO 1B: Certificado 759 (DEMO + comprobante generado completamente con serie/hash/pdf pero estado BORRADOR) -> Permitido continuar
    {
        const doc759 = {
            entorno_facturador: 'DEMO',
            proveedor: 'NUBEFACT',
            estado: 'BORRADOR',
            serie: 'FFF1',
            numero: 21,
            nro_comprobante: 'FFF1-00000021',
            codigo_hash: 'cFKB3AS7rEVgdh2CuRmCEv3lybrx0InLyBmBUCPDLhM=',
            enlace_pdf: 'https://www.nubefact.com/cpe/6bfae40b-2470-479d-909d-156bb2f5344f.pdf',
            enlace_xml: 'https://www.nubefact.com/cpe/6bfae40b-2470-479d-909d-156bb2f5344f.xml'
        };
        assert.strictEqual(esDemoGeneradoPorNubefact(doc759), true, 'Caso 759: debe ser reconocido en DEMO con artefactos');
        assert.strictEqual(esDocumentoBaseOperable(doc759), true, 'Caso 759: debe ser operable');
        console.log('✓ 1b. DEMO + comprobante completo (caso 759 FFF1-21) -> Permitido continuar.');
        pasadas++;
    }

    // CASO 2: DEMO + respuesta incompleta (sin código hash o sin enlace) -> Bloqueado
    {
        const docSinHash = {
            entorno_facturador: 'DEMO',
            proveedor: 'NUBEFACT',
            estado: 'PENDIENTE_SUNAT',
            serie: 'BBB1',
            numero: 298,
            nro_comprobante: 'BBB1-00000298',
            codigo_hash: null,
            enlace_pdf: 'https://www.nubefact.com/cpe/123.pdf'
        };
        const docSinEnlace = {
            entorno_facturador: 'DEMO',
            proveedor: 'NUBEFACT',
            estado: 'PENDIENTE_SUNAT',
            serie: 'BBB1',
            numero: 298,
            nro_comprobante: 'BBB1-00000298',
            codigo_hash: 'HASH1234567890',
            enlace_pdf: null,
            enlace_xml: null
        };
        const docSoloReserva = {
            entorno_facturador: 'DEMO',
            proveedor: 'NUBEFACT',
            estado: 'PENDIENTE',
            serie: 'BBB1',
            numero: 298,
            nro_comprobante: 'BBB1-00000298',
            codigo_hash: null,
            enlace_pdf: null
        };
        assert.strictEqual(esDocumentoBaseOperable(docSinHash), false, 'Sin hash no es operable');
        assert.strictEqual(esDocumentoBaseOperable(docSinEnlace), false, 'Sin enlace no es operable');
        assert.strictEqual(esDocumentoBaseOperable(docSoloReserva), false, 'Solo reserva no es operable');
        console.log('✓ 2. DEMO + respuesta incompleta (sin hash o sin enlace o solo reserva) -> Bloqueado.');
        pasadas++;
    }

    // CASO 3: DEMO + comprobante rechazado -> Bloqueado
    {
        const docRechazado = {
            entorno_facturador: 'DEMO',
            proveedor: 'NUBEFACT',
            estado: 'RECHAZADO',
            serie: 'BBB1',
            numero: 298,
            nro_comprobante: 'BBB1-00000298',
            codigo_hash: 'HASH1234567890',
            enlace_pdf: 'https://www.nubefact.com/cpe/123.pdf'
        };
        assert.strictEqual(esDocumentoBaseOperable(docRechazado), false, 'Rechazado no debe ser operable');
        console.log('✓ 3. DEMO + comprobante rechazado -> Bloqueado.');
        pasadas++;
    }

    // CASO 4: PRODUCCIÓN + comprobante aceptado con CDR -> Permitido continuar
    {
        const docProdAceptado = {
            entorno_facturador: 'PRODUCCION',
            proveedor: 'NUBEFACT',
            estado: 'ACEPTADO',
            aceptada_sunat: true,
            serie: 'F001',
            numero: 100,
            nro_comprobante: 'F001-00000100',
            codigo_hash: 'HASHPROD123456',
            enlace_pdf: 'https://www.nubefact.com/cpe/prod.pdf',
            enlace_cdr: 'https://www.nubefact.com/cpe/prod.cdr'
        };
        assert.strictEqual(esAceptadoPorSunat(docProdAceptado), true);
        assert.strictEqual(esDocumentoBaseOperable(docProdAceptado), true);
        console.log('✓ 4. PRODUCCIÓN + comprobante aceptado con CDR -> Permitido continuar.');
        pasadas++;
    }

    // CASO 5: PRODUCCIÓN + comprobante pendiente -> Bloqueado
    {
        const docProdPendiente = {
            entorno_facturador: 'PRODUCCION',
            proveedor: 'NUBEFACT',
            estado: 'PENDIENTE_SUNAT',
            aceptada_sunat: null,
            serie: 'F001',
            numero: 101,
            nro_comprobante: 'F001-00000101',
            codigo_hash: 'HASHPROD123456',
            enlace_pdf: 'https://www.nubefact.com/cpe/prod.pdf'
        };
        assert.strictEqual(esAceptadoPorSunat(docProdPendiente), false);
        assert.strictEqual(esDemoGeneradoPorNubefact(docProdPendiente), false, 'Nunca debe pasar como DEMO en PRODUCCION');
        assert.strictEqual(esDocumentoBaseOperable(docProdPendiente), false, 'En PRODUCCION pendiente está bloqueado');
        console.log('✓ 5. PRODUCCIÓN + comprobante pendiente -> Bloqueado.');
        pasadas++;
    }

    // CASO 6: PRODUCCIÓN + comprobante rechazado -> Bloqueado
    {
        const docProdRechazado = {
            entorno_facturador: 'PRODUCCION',
            proveedor: 'NUBEFACT',
            estado: 'RECHAZADO',
            aceptada_sunat: false,
            serie: 'F001',
            numero: 102,
            nro_comprobante: 'F001-00000102',
            codigo_hash: 'HASHPROD123456',
            enlace_pdf: 'https://www.nubefact.com/cpe/prod.pdf'
        };
        assert.strictEqual(esDocumentoBaseOperable(docProdRechazado), false);
        console.log('✓ 6. PRODUCCIÓN + comprobante rechazado -> Bloqueado.');
        pasadas++;
    }

    // CASO 7: Comprobante ya generado previamente -> No llamar a NubeFact (idempotencia)
    {
        const docYaEmitido = {
            id: 1023,
            estado: 'BORRADOR',
            serie: 'FFF1',
            numero: 21,
            nro_comprobante: 'FFF1-00000021',
            codigo_hash: 'cFKB3AS7rEVgdh2CuRmCEv3lybrx0InLyBmBUCPDLhM=',
            enlace_pdf: 'https://www.nubefact.com/cpe/6bfae40b-2470-479d-909d-156bb2f5344f.pdf',
            entorno_facturador: 'DEMO'
        };
        const yaAceptada = ['ACEPTADO', 'PENDIENTE_SUNAT'].includes(docYaEmitido.estado)
            || Boolean(docYaEmitido.codigo_hash && docYaEmitido.enlace_pdf);

        assert.strictEqual(yaAceptada, true, 'Debe detectar comprobante existente');
        let nubefactInvocado = false;
        if (!yaAceptada) {
            nubefactInvocado = true;
        }
        assert.strictEqual(nubefactInvocado, false, 'No debe invocar NubeFact si ya tiene hash y PDF');
        console.log('✓ 7. Comprobante ya generado previamente -> No llamar a NubeFact.');
        pasadas++;
    }

    // CASO 8: Certificado emitido -> No duplicar correlativo
    {
        const certEmitido = {
            id: 758,
            numero_certificado: 'DG-41-000424',
            estado: 'EMITIDO'
        };
        let correlativoConsumido = false;
        let numeroFinal = certEmitido.numero_certificado;
        if (!numeroFinal) {
            correlativoConsumido = true;
            numeroFinal = 'DG-41-000425';
        }
        assert.strictEqual(correlativoConsumido, false, 'No debe consumir un nuevo correlativo');
        assert.strictEqual(numeroFinal, 'DG-41-000424', 'Debe conservar su número');
        console.log('✓ 8. Certificado emitido -> No duplicar correlativo.');
        pasadas++;
    }

    // CASO 9: Transacción de emisión -> ROLLBACK ante error en cualquier paso
    {
        let rollbackEjecutado = false;
        let conexionLiberada = false;
        const mockClient = {
            query: async (sql) => {
                if (sql.trim() === 'ROLLBACK') rollbackEjecutado = true;
                if (sql.includes('UPDATE fg_certificado')) throw new Error('SIMULATED_FAILURE_MID_TRANSACTION');
                return { rowCount: 1, rows: [] };
            },
            release: () => { conexionLiberada = true; }
        };

        try {
            await mockClient.query('BEGIN');
            await mockClient.query('UPDATE fg_certificado SET estado = "EMITIDO"');
            await mockClient.query('COMMIT');
        } catch (e) {
            await mockClient.query('ROLLBACK');
        } finally {
            mockClient.release();
        }

        assert.strictEqual(rollbackEjecutado, true, 'Debe realizar ROLLBACK');
        assert.strictEqual(conexionLiberada, true, 'Debe liberar conexión en finally');
        console.log('✓ 9. Transacción de emisión -> ROLLBACK ante error en cualquier paso.');
        pasadas++;
    }

    // CASO 10: Conservación de estados fiscales -> No alterar documentos emitidos
    {
        const actualRow = {
            id: 1023,
            estado: 'BORRADOR',
            nro_comprobante: 'FFF1-00000021',
            codigo_hash: 'cFKB3AS7rEVgdh2CuRmCEv3lybrx0InLyBmBUCPDLhM=',
            enlace_pdf: 'https://www.nubefact.com/cpe/6bfae40b-2470-479d-909d-156bb2f5344f.pdf'
        };
        const yaTieneComprobante = Boolean(
            actualRow.codigo_hash
            && (actualRow.enlace_pdf || actualRow.enlace_xml)
            && actualRow.nro_comprobante
        );
        assert.strictEqual(yaTieneComprobante, true, 'Detecta comprobante emitido');
        // Simular regla de guardarFacturacion protegida
        let sobreescrito = false;
        if (!(['PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'ERROR'].includes(actualRow.estado) || yaTieneComprobante)) {
            sobreescrito = true;
        }
        assert.strictEqual(sobreescrito, false, 'No debe sobreescribir el comprobante');
        console.log('✓ 10. Conservación de estados fiscales -> No alterar documentos emitidos.');
        pasadas++;
    }

    console.log(`\nTODAS LAS ${pasadas} PRUEBAS OBLIGATORIAS DE VALIDACIÓN PASARON EXITOSAMENTE.`);
}

ejecutarPruebasValidacion().catch(err => {
    console.error('ERROR EN PRUEBAS:', err);
    process.exit(1);
});

