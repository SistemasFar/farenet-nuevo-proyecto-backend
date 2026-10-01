const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-series-dms.service');

const fila = (overrides = {}) => ({
    Nombre: 'FE',
    Autogenerada: 'Si',
    'Último Número Generado': '10',
    Activo: 'Si',
    'Tipo de Documento': '01',
    Número: 'E30',
    'Tipo de Documento de Referencia': '',
    'Código del Local': '0020',
    'Nombre del Local': 'FAREGAS - SANTA ANITA',
    'Teléfono del Local': '',
    'Correo del Local': 'cert_ayllon@faregas.pe',
    'Dirección Comercial': 'AV. CARRETERA CENTRAL',
    'Serie para POS': 'No',
    'Serie de Contingencia': 'Si',
    ...overrides
});

test('homologa Santa Anita y conserva la representación DMS separada de la serie interna', () => {
    const result = service._private.normalizarFila(fila(), 0);
    assert.equal(result.estado, null);
    assert.equal(result.planta_key, '292');
    assert.equal(result.tipo_comprobante, 'FACTURA');
    assert.equal(result.numero_dms, 'E30');
    assert.equal(result.serie, 'F030');
    assert.equal(result.codigo_local_dms, '0020');
    assert.equal(result.contingencia, true);
});

test('aplica únicamente los aliases explícitos LA VICTORIA y SJL', () => {
    const victoria = service._private.normalizarFila(fila({ 'Nombre del Local': 'FAREGAS - LA VICTORIA' }), 0);
    const sjl = service._private.normalizarFila(fila({ 'Nombre del Local': 'FAREGAS - SJL' }), 0);
    assert.equal(victoria.planta_key, '103');
    assert.equal(sjl.planta_key, '138');
    assert.equal(service._private.MAPA_LOCAL_PLANTA['FAREGAS - VICTORIA'], undefined);
});

test('clasifica DASSO como no homologada y la fila 7 - BE08 como manual', () => {
    const dasso = service._private.normalizarFila(fila({ 'Nombre del Local': 'FAREGAS -DASSO' }), 0);
    const manual = service._private.normalizarFila(fila({
        Nombre: '7 - BE08',
        'Nombre del Local': '',
        'Código del Local': ''
    }), 0);
    assert.equal(dasso.estado, 'SEDE_NO_HOMOLOGADA');
    assert.equal(manual.estado, 'REVISAR_MANUAL');
});

test('convierte crédito y débito a la identidad interna sin perder el Número DMS', () => {
    const credito = service._private.normalizarFila(fila({
        Nombre: 'NCB', 'Tipo de Documento': '07', Número: 'C30',
        'Tipo de Documento de Referencia': '03'
    }), 0);
    const debito = service._private.normalizarFila(fila({
        Nombre: 'NDF', 'Tipo de Documento': '08', Número: 'D30',
        'Tipo de Documento de Referencia': '01'
    }), 0);
    assert.deepEqual(
        [credito.tipo_comprobante, credito.serie, credito.numero_dms],
        ['NOTA_CREDITO_BOLETA', 'BC30', 'C30']
    );
    assert.deepEqual(
        [debito.tipo_comprobante, debito.serie, debito.numero_dms],
        ['NOTA_DEBITO_FACTURA', 'FD30', 'D30']
    );
});

test('rechaza documentos que no respetan nombre, tipo, referencia y prefijo DMS', () => {
    const result = service._private.normalizarFila(fila({ Nombre: 'BE' }), 0);
    assert.equal(result.estado, 'REVISAR_MANUAL');
    assert.match(result.motivo, /IDENTIDAD_DOCUMENTAL_INVALIDA/);
});
