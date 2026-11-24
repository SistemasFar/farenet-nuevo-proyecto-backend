const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    validarFechaDocumentoOriginal,
    normalizarSnapshotFiscal,
    obtenerSnapshotFiscalOriginal,
    derivarDatosNotaCredito
} = require('../services/faregas-notas-credito-fiscal.service');
const {
    construirPayloadNota,
    formatearFechaReferencia,
    yaContieneReferencia,
    combinarObservacionesNota
} = require('../integrations/nubefact-faregas.adapter');

describe('Notas de Crédito FAREGAS - Fecha de emisión del documento original', () => {

    const snapshotBase = {
        tipo_de_comprobante: 1,
        serie: 'FFF1',
        numero: 101,
        cliente_tipo_de_documento: 6,
        cliente_numero_de_documento: '20600444531',
        cliente_denominacion: 'EMPRESA CLIENTE SAC',
        cliente_direccion: 'AV. PRINCIPAL 123',
        moneda: 1,
        total: 100,
        total_gravada: 84.75,
        total_igv: 15.25,
        items: [{
            codigo: 'GLP-001',
            descripcion: 'CERTIFICACION ANUAL GLP',
            unidad_de_medida: 'ZZ',
            cantidad: 1,
            valor_unitario: 84.75,
            precio_unitario: 100,
            subtotal: 84.75,
            tipo_de_igv: 1,
            igv: 15.25,
            total: 100
        }]
    };

    it('1. Valida y formatea correctamente fechas válidas en ISO y formato peruano', () => {
        assert.strictEqual(validarFechaDocumentoOriginal('2026-11-10'), '2026-11-10');
        assert.strictEqual(validarFechaDocumentoOriginal('10-11-2026'), '10-11-2026');
        assert.strictEqual(validarFechaDocumentoOriginal(new Date('2026-11-10T00:00:00Z')), '2026-11-10');
    });

    it('2. Bloquea si la fecha de emisión del comprobante original está vacía o es nula', () => {
        assert.throws(
            () => validarFechaDocumentoOriginal(null),
            (err) => err.code === 'COMPROBANTE_ORIGINAL_SIN_FECHA_EMISION' && err.statusCode === 409
        );
        assert.throws(
            () => validarFechaDocumentoOriginal(''),
            (err) => err.code === 'COMPROBANTE_ORIGINAL_SIN_FECHA_EMISION' && err.statusCode === 409
        );
    });

    it('3. Bloquea si la fecha es inválida o futura', () => {
        assert.throws(
            () => validarFechaDocumentoOriginal('fecha-invalida'),
            (err) => err.code === 'FECHA_EMISION_ORIGINAL_INVALIDA' && err.statusCode === 409
        );
        assert.throws(
            () => validarFechaDocumentoOriginal('2099-01-01'),
            (err) => err.code === 'FECHA_EMISION_ORIGINAL_INVALIDA' && err.statusCode === 409
        );
    });

    it('4. Recupera la fecha estrictamente del comprobante original en PostgreSQL (fecha_documento)', () => {
        const facturacion = {
            id: 501,
            tipo_comprobante: 'FACTURA',
            serie: 'FFF1',
            numero: 101,
            fecha_documento: '2026-11-05',
            fecha_documento_fiscal_dia: '2026-11-05'
        };

        // Aunque el snapshot del intento tuviera otra fecha o ninguna, prevalece fecha_documento de PostgreSQL
        const snapshotConFechaIntento = {
            ...snapshotBase,
            fecha_de_emision: '24-11-2026'
        };

        const normalizado = normalizarSnapshotFiscal(snapshotConFechaIntento, facturacion);
        assert.strictEqual(normalizado.fecha_de_emision, '2026-11-05');
    });

    it('5. Impide la emisión si el comprobante original en PostgreSQL carece de fecha_documento', () => {
        const facturacionSinFecha = {
            id: 502,
            tipo_comprobante: 'FACTURA',
            serie: 'FFF1',
            numero: 101,
            fecha_documento: null,
            fecha_documento_fiscal_dia: null
        };

        assert.throws(
            () => normalizarSnapshotFiscal(snapshotBase, facturacionSinFecha),
            (err) => err.code === 'COMPROBANTE_ORIGINAL_SIN_FECHA_EMISION' && err.statusCode === 409
        );
    });

    it('6. Conserva la fecha original del documento al derivar los datos de la nota de crédito', () => {
        const facturacion = {
            id: 503,
            tipo_comprobante: 'FACTURA',
            serie: 'FFF1',
            numero: 101,
            fecha_documento: '2026-11-08',
            fecha_documento_fiscal_dia: '2026-11-08'
        };

        const snapshot = normalizarSnapshotFiscal(snapshotBase, facturacion);
        const datos = derivarDatosNotaCredito({
            snapshot,
            motivoCodigo: '01',
            sustento: 'Anulación de la operación por error administrativo'
        });

        assert.strictEqual(datos.snapshotFiscal.fecha_de_emision, '2026-11-08');
        assert.strictEqual(datos.motivoCodigo, '01');
    });

    it('7. En el worker/consulta de snapshot original, completa fecha_documento desde base de datos si falta', async () => {
        const executorMock = {
            query: async (sql, params) => {
                if (sql.includes('fg_facturacion_intento')) {
                    return {
                        rowCount: 1,
                        rows: [{
                            solicitud: snapshotBase,
                            estado: 'ACEPTADO',
                            numero_intento: 1
                        }]
                    };
                }
                if (sql.includes('FROM fg_facturacion ')) {
                    return {
                        rowCount: 1,
                        rows: [{
                            id: params[0],
                            tipo_comprobante: 'FACTURA',
                            serie: 'FFF1',
                            numero: 101,
                            fecha_documento: '2026-11-09',
                            fecha_documento_fiscal_dia: '2026-11-09'
                        }]
                    };
                }
                return { rowCount: 0, rows: [] };
            }
        };

        const res = await obtenerSnapshotFiscalOriginal(executorMock, { id: 777 });
        assert.strictEqual(res.fecha_de_emision, '2026-11-09');
    });

    it('8. NubeFact payload para nota de crédito consigna los datos del documento que se modifica y mantiene su propia fecha de emisión', () => {
        const nota = {
            id: 99,
            serie: 'FC01',
            numero: 12,
            codigo_unico: 'FGNC-99',
            motivo_codigo: '01',
            sustento: 'Anulación de la operación'
        };
        const facturacion = {
            id: 501,
            tipo_comprobante: 'FACTURA',
            serie: 'FFF1',
            numero: 101,
            fecha_documento: '2026-11-05'
        };
        const snapshotFiscal = {
            ...snapshotBase,
            fecha_de_emision: '2026-11-05'
        };
        const datosFiscales = {
            items: snapshotBase.items
        };

        const payload = construirPayloadNota({
            nota,
            facturacion,
            tipoNota: 'CREDITO',
            snapshotFiscal,
            datosFiscales
        });

        assert.strictEqual(payload.operacion, 'generar_comprobante');
        assert.strictEqual(payload.tipo_de_comprobante, 3);
        assert.strictEqual(payload.serie, 'FC01');
        assert.strictEqual(payload.numero, 12);
        assert.strictEqual(payload.documento_que_se_modifica_tipo, 1);
        assert.strictEqual(payload.documento_que_se_modifica_serie, 'FFF1');
        assert.strictEqual(payload.documento_que_se_modifica_numero, 101);
        assert.strictEqual(payload.tipo_de_nota_de_credito, 1);
        // La fecha_de_emision del payload pertenece a la nota de crédito y debe ser la fecha actual de Lima
        assert.match(payload.fecha_de_emision, /^(\d{2})-(\d{2})-(\d{4})$/);
        // Observaciones incluye la referencia al documento modificado y su fecha original
        assert.strictEqual(payload.observaciones, 'Anulación de la operación | DOC. MODIFICA: FACTURA FFF1-101 DEL 05/11/2026');
    });

    it('9. Nota de crédito de FACTURA incluye referencia legible con fecha original en observaciones', () => {
        const payload = construirPayloadNota({
            nota: {
                id: 1,
                serie: 'FC01',
                numero: 50,
                codigo_unico: 'FGNC-1',
                motivo_codigo: '01',
                sustento: 'Error en RUC'
            },
            facturacion: {
                id: 500,
                tipo_comprobante: 'FACTURA',
                serie: 'FFF1',
                numero: 67,
                fecha_documento: '2026-11-05'
            },
            tipoNota: 'CREDITO',
            snapshotFiscal: {
                ...snapshotBase,
                serie: 'FFF1',
                numero: 67,
                tipo_de_comprobante: 1,
                fecha_de_emision: '2026-11-05'
            },
            datosFiscales: { items: snapshotBase.items }
        });

        assert.strictEqual(payload.observaciones, 'Error en RUC | DOC. MODIFICA: FACTURA FFF1-67 DEL 05/11/2026');
    });

    it('10. Nota de crédito de BOLETA incluye referencia legible con fecha original en observaciones', () => {
        const payload = construirPayloadNota({
            nota: {
                id: 2,
                serie: 'BC01',
                numero: 25,
                codigo_unico: 'FGNC-2',
                motivo_codigo: '01',
                sustento: 'Devolución total'
            },
            facturacion: {
                id: 600,
                tipo_comprobante: 'BOLETA',
                serie: 'BBB1',
                numero: 102,
                fecha_documento: '2026-11-12'
            },
            tipoNota: 'CREDITO',
            snapshotFiscal: {
                ...snapshotBase,
                serie: 'BBB1',
                numero: 102,
                tipo_de_comprobante: 2,
                fecha_de_emision: '2026-11-12'
            },
            datosFiscales: { items: snapshotBase.items }
        });

        assert.strictEqual(payload.observaciones, 'Devolución total | DOC. MODIFICA: BOLETA BBB1-102 DEL 12/11/2026');
    });

    it('11. Comprobante original de mes anterior mantiene su fecha real en observaciones mientras la NC tiene fecha actual', () => {
        const payload = construirPayloadNota({
            nota: {
                id: 3,
                serie: 'FC01',
                numero: 30,
                codigo_unico: 'FGNC-3',
                motivo_codigo: '01',
                sustento: 'Anulación por cambio de razón social'
            },
            facturacion: {
                id: 400,
                tipo_comprobante: 'FACTURA',
                serie: 'FFF1',
                numero: 45,
                fecha_documento: '2026-10-18'
            },
            tipoNota: 'CREDITO',
            snapshotFiscal: {
                ...snapshotBase,
                serie: 'FFF1',
                numero: 45,
                tipo_de_comprobante: 1,
                fecha_de_emision: '2026-10-18'
            },
            datosFiscales: { items: snapshotBase.items }
        });

        // La fecha en observaciones es la fecha de octubre del documento original
        assert.match(payload.observaciones, /DEL 18\/10\/2026$/);
        // La fecha de emisión de la NC es la de hoy (noviembre)
        assert.notStrictEqual(payload.fecha_de_emision, '18-10-2026');
        assert.match(payload.fecha_de_emision, /^(\d{2})-(\d{2})-(\d{4})$/);
    });

    it('12. Preserva sustento previo y respeta límite SUNAT de 250 caracteres asegurando la referencia del comprobante', () => {
        const sustentoLargo = 'A'.repeat(240); // 240 caracteres de sustento
        const payload = construirPayloadNota({
            nota: {
                id: 4,
                serie: 'FC01',
                numero: 40,
                codigo_unico: 'FGNC-4',
                motivo_codigo: '01',
                sustento: sustentoLargo
            },
            facturacion: {
                id: 401,
                tipo_comprobante: 'FACTURA',
                serie: 'FFF1',
                numero: 67,
                fecha_documento: '2026-11-05'
            },
            tipoNota: 'CREDITO',
            snapshotFiscal: {
                ...snapshotBase,
                serie: 'FFF1',
                numero: 67,
                tipo_de_comprobante: 1,
                fecha_de_emision: '2026-11-05'
            },
            datosFiscales: { items: snapshotBase.items }
        });

        assert.ok(payload.observaciones.length <= 250, `Longitud ${payload.observaciones.length} supera 250`);
        assert.ok(payload.observaciones.endsWith('DOC. MODIFICA: FACTURA FFF1-67 DEL 05/11/2026'), 'La referencia no debe recortarse');
    });

    it('13. Reintento de emisión no duplica la referencia en observaciones si ya existe', () => {
        const sustentoConReferencia = 'Anulación previa | DOC. MODIFICA: FACTURA FFF1-67 DEL 05/11/2026';
        const payload = construirPayloadNota({
            nota: {
                id: 5,
                serie: 'FC01',
                numero: 50,
                codigo_unico: 'FGNC-5',
                motivo_codigo: '01',
                sustento: sustentoConReferencia
            },
            facturacion: {
                id: 500,
                tipo_comprobante: 'FACTURA',
                serie: 'FFF1',
                numero: 67,
                fecha_documento: '2026-11-05'
            },
            tipoNota: 'CREDITO',
            snapshotFiscal: {
                ...snapshotBase,
                serie: 'FFF1',
                numero: 67,
                tipo_de_comprobante: 1,
                fecha_de_emision: '2026-11-05'
            },
            datosFiscales: { items: snapshotBase.items }
        });

        assert.strictEqual(payload.observaciones, sustentoConReferencia);
        // Verificar que no se repita "DOC. MODIFICA"
        const count = (payload.observaciones.match(/DOC\. MODIFICA/g) || []).length;
        assert.strictEqual(count, 1, 'No debe duplicar la referencia');
    });

    it('14. Bloquea la construcción del payload de nota de crédito si falta la fecha original', () => {
        assert.throws(
            () => construirPayloadNota({
                nota: { id: 6, serie: 'FC01', numero: 60, motivo_codigo: '01' },
                facturacion: { id: 600, tipo_comprobante: 'FACTURA', serie: 'FFF1', numero: 67, fecha_documento: null },
                tipoNota: 'CREDITO',
                snapshotFiscal: { ...snapshotBase, fecha_de_emision: null, fecha_documento: null },
                datosFiscales: { items: snapshotBase.items }
            }),
            (err) => err.code === 'COMPROBANTE_ORIGINAL_SIN_FECHA_EMISION' && err.statusCode === 409
        );
    });

    it('15. Bloquea la construcción del payload de nota de crédito si la fecha original es inválida o futura', () => {
        assert.throws(
            () => construirPayloadNota({
                nota: { id: 7, serie: 'FC01', numero: 70, motivo_codigo: '01' },
                facturacion: { id: 700, tipo_comprobante: 'FACTURA', serie: 'FFF1', numero: 67, fecha_documento: '2099-12-31' },
                tipoNota: 'CREDITO',
                snapshotFiscal: { ...snapshotBase, fecha_de_emision: '2099-12-31' },
                datosFiscales: { items: snapshotBase.items }
            }),
            (err) => err.code === 'FECHA_EMISION_ORIGINAL_INVALIDA' && err.statusCode === 409
        );
    });

    it('16. Funciones auxiliares formatearFechaReferencia y yaContieneReferencia funcionan de manera determinista', () => {
        assert.strictEqual(formatearFechaReferencia('2026-11-05'), '05/11/2026');
        assert.strictEqual(formatearFechaReferencia('05-11-2026'), '05/11/2026');
        assert.strictEqual(formatearFechaReferencia('05/11/2026'), '05/11/2026');
        assert.strictEqual(formatearFechaReferencia(null), null);
        assert.strictEqual(formatearFechaReferencia('invalida'), null);

        assert.strictEqual(yaContieneReferencia('Sustento | DOC. MODIFICA: FACTURA FFF1-67 DEL 05/11/2026', 'FFF1', 67), true);
        assert.strictEqual(yaContieneReferencia('Sustento | DOC. MODIFICA: FACTURA FFF1-00000067 DEL 05/11/2026', 'FFF1', 67), true);
        assert.strictEqual(yaContieneReferencia('Sustento simple', 'FFF1', 67), false);
    });

});
