const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.NODE_ENV = 'test';

const {
    MOTIVOS_NOTA_CREDITO,
    normalizarMotivoNotaCredito,
    requiereSolicitudNotaCredito
} = require('../services/faregas-notas-credito.constants');
const {
    normalizarSnapshotFiscal,
    derivarDatosNotaCredito,
    validarFechaDocumentoOriginal
} = require('../services/faregas-notas-credito-fiscal.service');
const documentosService = require('../services/faregas-documentos-electronicos.service');
const { construirPayloadNota } = require('../integrations/nubefact-faregas.adapter');
const { crearReconciliadorNotas } = require('../services/faregas-nubefact-notas-cron.service')._private;

const snapshotBase = () => ({
    operacion: 'generar_comprobante',
    tipo_de_comprobante: 2,
    serie: 'BBB1',
    numero: 249,
    cliente_tipo_de_documento: 1,
    cliente_numero_de_documento: '74045612',
    cliente_denominacion: 'GRACE',
    cliente_direccion: 'LIMA',
    cliente_email: 'cliente@example.test',
    fecha_de_emision: '10-01-2020',
    moneda: 1,
    porcentaje_de_igv: 18,
    total_descuento: 0,
    total_anticipo: 0,
    total_gravada: 100,
    total_inafecta: 0,
    total_exonerada: 0,
    total_igv: 18,
    total_gratuita: 0,
    total_otros_cargos: 0,
    total: 118,
    items: [
        {
            unidad_de_medida: 'NIU', codigo: '0391', descripcion: 'CERTIFICADO A', cantidad: 1,
            valor_unitario: 60, precio_unitario: 70.8, descuento: 0, subtotal: 60,
            tipo_de_igv: 1, igv: 10.8, total: 70.8
        },
        {
            unidad_de_medida: 'ZZ', codigo: '0392', descripcion: 'CERTIFICADO B', cantidad: 1,
            valor_unitario: 40, precio_unitario: 47.2, descuento: 0, subtotal: 40,
            tipo_de_igv: 1, igv: 7.2, total: 47.2
        }
    ]
});

const facturacionBase = () => ({
    id: 90,
    tipo_comprobante: 'BOLETA',
    serie: 'BBB1',
    numero: 249,
    fecha_documento: '2020-01-10',
    importe_total: 118,
    moneda_key: 'sol'
});

const notaBase = (motivo = '01') => ({
    id: 7,
    serie: 'BBC1',
    numero: 2,
    codigo_unico: 'FGNC-7',
    motivo_codigo: motivo,
    sustento: motivo === '03' ? 'DESCRIPCION CORREGIDA' : 'ANULACION AUTORIZADA',
    base_imponible: 100,
    igv: 18,
    importe_total: 118
});

test('catálogo central habilita únicamente 01, 02 y 03', () => {
    assert.deepEqual(Object.keys(MOTIVOS_NOTA_CREDITO), ['01', '02', '03']);
    assert.equal(normalizarMotivoNotaCredito('1'), '01');
    assert.equal(normalizarMotivoNotaCredito('06'), null);
    assert.equal(requiereSolicitudNotaCredito('01'), true);
    assert.equal(requiereSolicitudNotaCredito('02'), true);
    assert.equal(requiereSolicitudNotaCredito('03'), false);
});

test('snapshot antiguo válido no es rechazado por un plazo legal inventado', () => {
    assert.equal(validarFechaDocumentoOriginal('10-01-2020'), '10-01-2020');
    assert.equal(validarFechaDocumentoOriginal(new Date('2020-01-10T05:00:00Z')), '2020-01-10');
    assert.throws(
        () => validarFechaDocumentoOriginal('31-02-2020'),
        (error) => error.code === 'FECHA_EMISION_ORIGINAL_INVALIDA'
    );
    const snapshot = normalizarSnapshotFiscal(snapshotBase(), facturacionBase());
    assert.equal(snapshot.total, 118);
    assert.equal(snapshot.items.length, 2);
});

test('importes fiscales se derivan del snapshot e ignoran importes manipulados del navegador', () => {
    const snapshot = normalizarSnapshotFiscal(snapshotBase(), facturacionBase());
    const datos = derivarDatosNotaCredito({
        snapshot,
        motivoCodigo: '01',
        sustento: 'ANULACION AUTORIZADA',
        baseImponible: 1,
        igv: 1,
        importeTotal: 2
    });
    assert.equal(datos.baseImponible, 100);
    assert.equal(datos.igv, 18);
    assert.equal(datos.importeTotal, 118);
});

test('payload 01 conserva cliente, referencia, líneas, unidades, afectaciones e impuestos originales', () => {
    const snapshot = normalizarSnapshotFiscal(snapshotBase(), facturacionBase());
    const datos = derivarDatosNotaCredito({ snapshot, motivoCodigo: '01', sustento: 'ANULACION AUTORIZADA' });
    const payload = construirPayloadNota({
        nota: notaBase('01'),
        facturacion: facturacionBase(),
        tipoNota: 'CREDITO',
        snapshotFiscal: snapshot,
        datosFiscales: datos
    });
    assert.equal(payload.tipo_de_comprobante, 3);
    assert.equal(payload.tipo_de_nota_de_credito, 1);
    assert.equal(payload.documento_que_se_modifica_serie, 'BBB1');
    assert.equal(payload.documento_que_se_modifica_numero, 249);
    assert.equal(payload.cliente_numero_de_documento, '74045612');
    assert.deepEqual(payload.items, snapshot.items);
    assert.equal(payload.total_gravada, 100);
    assert.equal(payload.total_igv, 18);
    assert.equal(payload.total, 118);
});

test('payload 03 modifica sólo la descripción de la línea seleccionada', () => {
    const snapshot = normalizarSnapshotFiscal(snapshotBase(), facturacionBase());
    const datos = derivarDatosNotaCredito({
        snapshot,
        motivoCodigo: '03',
        sustento: 'Se corrige la descripción del servicio',
        descripcionCorregida: 'CERTIFICADO ANUAL GLP CORREGIDO',
        itemIndice: 1
    });
    assert.equal(datos.sustento, 'CERTIFICADO ANUAL GLP CORREGIDO');
    const payload = construirPayloadNota({
        nota: { ...notaBase('03'), sustento: datos.sustento },
        facturacion: facturacionBase(),
        tipoNota: 'CREDITO',
        snapshotFiscal: snapshot,
        datosFiscales: datos
    });
    assert.equal(payload.items[0].descripcion, 'CERTIFICADO A');
    assert.equal(payload.items[1].descripcion, 'CERTIFICADO ANUAL GLP CORREGIDO');
    assert.equal(payload.items[1].total, snapshot.items[1].total);
    assert.equal(payload.total, snapshot.total);
});

test('snapshot inafecto conserva su afectación y no se fuerza a base gravada más IGV', () => {
    const snapshotInafecto = {
        ...snapshotBase(),
        total_gravada: 0,
        total_inafecta: 118,
        total_igv: 0,
        items: snapshotBase().items.map(item => ({ ...item, tipo_de_igv: 9, igv: 0 }))
    };
    const snapshot = normalizarSnapshotFiscal(snapshotInafecto, facturacionBase());
    const datos = derivarDatosNotaCredito({
        snapshot,
        motivoCodigo: '01',
        sustento: 'ANULACION AUTORIZADA'
    });
    const payload = construirPayloadNota({
        nota: { ...notaBase('01'), base_imponible: 0, igv: 0 },
        facturacion: facturacionBase(),
        tipoNota: 'CREDITO',
        snapshotFiscal: snapshot,
        datosFiscales: datos
    });
    assert.equal(payload.total_gravada, 0);
    assert.equal(payload.total_inafecta, 118);
    assert.equal(payload.total_igv, 0);
    assert.equal(payload.items[0].tipo_de_igv, 9);
    assert.equal(payload.total, 118);
});

test('snapshot de otro comprobante se rechaza antes de reservar una nota', () => {
    assert.throws(
        () => normalizarSnapshotFiscal({ ...snapshotBase(), numero: 250 }, facturacionBase()),
        (error) => error.code === 'SNAPSHOT_FISCAL_NO_CORRESPONDE'
    );
});

test('reintento pendiente o incierto consulta; sólo un rechazo confirmado permite emitir', () => {
    const { resolverAccionReintentoNota } = documentosService._private;
    assert.equal(resolverAccionReintentoNota('PENDIENTE'), 'CONSULTAR');
    assert.equal(resolverAccionReintentoNota('ERROR'), 'CONSULTAR');
    assert.equal(resolverAccionReintentoNota('RECHAZADO'), 'EMITIR');
    assert.throws(() => resolverAccionReintentoNota('ACEPTADO'), /NOTA_NO_REINTENTABLE/);
});

test('respuesta incierta consulta NubeFact simulado una vez y no vuelve a emitir', async () => {
    let consultas = 0;
    const resultado = await documentosService._private.recuperarResultadoIncierto({
        resultado: { status: 'ERROR', reason: 'TIMEOUT' },
        consultar: async () => {
            consultas++;
            return { status: 'PENDING_SUNAT', reason: 'PENDING_SUNAT', data: {} };
        },
        payload: { tipoDeComprobante: 3, serie: 'BBC1', numero: 2 },
        credentials: { apiUrl: 'https://example.test', token: 'test' }
    });
    assert.equal(consultas, 1);
    assert.equal(resultado.status, 'PENDING_SUNAT');
});

test('reconciliador usa columnas reales y sólo invoca consulta segura', async () => {
    const consultasSql = [];
    let liberado = false;
    const client = {
        query: async (sql) => {
            const texto = String(sql);
            consultasSql.push(texto);
            if (texto.includes('SELECT n.id AS nota_id')) {
                return { rowCount: 2, rows: [{ nota_id: 10 }, { nota_id: 11 }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => { liberado = true; }
    };
    const llamadas = [];
    const reconciliar = crearReconciliadorNotas({
        database: { connect: async () => client },
        documentos: {
            reconciliarNotaPendiente: async (id) => {
                llamadas.push(id);
                return { id, estado: id === 10 ? 'ACEPTADO' : 'PENDIENTE' };
            }
        },
        config: { nubefact: { environment: 'DEMO' } },
        logger: { error: () => undefined }
    });
    const resumen = await reconciliar();
    assert.deepEqual(llamadas, [10, 11]);
    assert.equal(resumen.aceptados, 1);
    assert.equal(resumen.pendientes, 1);
    assert.equal(liberado, true);
    const sql = consultasSql.join('\n');
    assert.match(sql, /JOIN fg_facturacion f ON f\.id = n\.facturacion_id/);
    assert.match(sql, /n\.estado = 'PENDIENTE'/);
    assert.doesNotMatch(sql, /n\.certificado_id|PENDIENTE_SUNAT|sunat_ticket_numero/);
});

test('existe endpoint de consulta de nota separado del endpoint de reenvío', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/faregas-certificados.routes.js'), 'utf8');
    assert.match(routes, /notas\/:tipo\/:notaId\/consultar/);
    assert.match(routes, /notas\/:tipo\/:notaId\/emitir/);
});

test('el formulario obtiene el contexto fiscal desde un endpoint de solo lectura', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/faregas-certificados.routes.js'), 'utf8');
    const service = fs.readFileSync(path.join(__dirname, '../services/faregas-documentos-electronicos.service.js'), 'utf8');
    assert.match(routes, /borradores\/:id\/facturacion\/notas\/contexto/);
    assert.match(service, /exports\.obtenerContextoNotaCredito = async/);
    assert.match(service, /obtenerSnapshotFiscalOriginal\(db, facturacion\)/);
    assert.match(service, /items: snapshot\.items\.map/);
});

test('la idempotencia 01 y 02 usa el sustento autorizado, no el texto del navegador', () => {
    const service = fs.readFileSync(path.join(__dirname, '../services/faregas-documentos-electronicos.service.js'), 'utf8');
    assert.match(service, /const sustentoFiscal = autorizacion\?\.motivo \|\| data\.sustento/);
    assert.match(service, /buscarNotaIdempotente\([\s\S]*?facturacion\.id,[\s\S]*?motivoCodigo,[\s\S]*?sustentoFiscal/);
    assert.match(service, /derivarDatosNotaCredito\([\s\S]*?sustento: sustentoFiscal/);
});
