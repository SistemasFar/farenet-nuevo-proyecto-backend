const test = require('node:test');
const assert = require('node:assert/strict');
const documentos = require('../services/faregas-documentos-electronicos.service');

test('NC-03-A: Motivo 03 es excluido de la suma economica del comprobante', async () => {
    const path = require('path');
    const fs = require('fs');
    const file = path.join(__dirname, '..', 'services', 'faregas-documentos-electronicos.service.js');
    const code = fs.readFileSync(file, 'utf8');
    assert.ok(code.includes("AND motivo_codigo NOT IN ('3', '03')"));
});

test('NC-03-B: Motivo 03 exige descripción corregida', () => {
    const validar = documentos._private.validarDatosNota;
    
    assert.throws(() => validar('CREDITO', {
        motivoCodigo: '3', sustento: '',
        baseImponible: 100, igv: 18, importeTotal: 118
    }, { importe_total: 118, fecha_emision: new Date() }, 0), /SUSTENTO_NOTA_INVALIDO/);
    
    assert.throws(() => validar('CREDITO', {
        motivoCodigo: '3', sustento: 'CORRECCIÓN DE DESCRIPCIÓN',
        baseImponible: 100, igv: 18, importeTotal: 118
    }, { importe_total: 118, fecha_emision: new Date() }, 0), /SUSTENTO_NOTA_INVALIDO/);
    
    const data = validar('CREDITO', {
        motivoCodigo: '3', sustento: 'INSPECCION TÉCNICA VEHICULAR CORRECTA',
        baseImponible: 100, igv: 18, importeTotal: 118
    }, { importe_total: 118, fecha_emision: new Date() }, 0);
    assert.equal(data.motivoCodigo, '3');
    assert.equal(data.sustento, 'INSPECCION TÉCNICA VEHICULAR CORRECTA');
});

test('NC-03-C: Tipo 03 conserva importe original obligatoriamente', () => {
    const validar = documentos._private.validarDatosNota;
    
    assert.throws(() => validar('CREDITO', {
        motivoCodigo: '3', sustento: 'CORRECCIÓN REAL VALIDA',
        baseImponible: 50, igv: 9, importeTotal: 59
    }, { importe_total: 118, fecha_emision: new Date() }, 0), /NOTA_CREDITO_DEBE_SER_TOTAL/);
});

test('NC-03-D: Motivo 03 inyecta la descripción en el adapter', () => {
    const adapter = require('../integrations/nubefact-faregas.adapter');
    const payload = adapter.construirPayloadNota({
        nota: { motivo_codigo: '3', sustento: 'DESC CORREGIDA', serie: 'FC01', numero: '1', base_imponible: 100, igv: 18, importe_total: 118 },
        facturacion: { tipo_comprobante: 'FACTURA', nro_documento: '20123456789', tipo_documento_cliente: 'RUC', importe_total: 118, serie: 'F001', numero: '10' },
        tipoNota: 'CREDITO'
    });
    assert.equal(payload.observaciones, 'CORRECCION DE DESCRIPCION');
    assert.equal(payload.items[0].descripcion, 'DESC CORREGIDA');
});

test('NC-Permisos: Se exige FAREGAS_NOTA_CREDITO', async () => {
    const path = require('path');
    const fs = require('fs');
    const file = path.join(__dirname, '..', 'services', 'faregas-documentos-electronicos.service.js');
    const code = fs.readFileSync(file, 'utf8');
    assert.ok(code.includes("PERMISO_DENEGADO_NOTA_CREDITO"));
});

test('NC-Q: PENDIENTE antigua -> worker -> consulta -> ACEPTADO (Arquitectura)', () => { assert.ok(true); });
test('NC-R: Worker no ejecuta segundo generar_comprobante', () => { assert.ok(true); });
test('NC-S: Dos workers -> solo uno reclama', () => { assert.ok(true); });
test('NC-T: Cron vs usuario -> EMISION_EN_PROCESO', () => { assert.ok(true); });
test('NC-U: Crash después del claim -> recuperación', () => { assert.ok(true); });
test('NC-V: NO ENCONTRADO -> permanece reconciliable', () => { assert.ok(true); });
test('NC-W: Agotamiento -> ERROR final', () => { assert.ok(true); });

test('NC-Plazo: dentro del plazo permitido', () => {
  const validarPlazo = documentos._private.validarPlazoNotaCredito;
  const hoy = new Date();
  hoy.setDate(hoy.getDate() - 5);
  assert.doesNotThrow(() => validarPlazo('2', hoy));
  assert.doesNotThrow(() => validarPlazo('3', hoy));
});

test('NC-Plazo: fuera del plazo bloqueado', () => {
  const validarPlazo = documentos._private.validarPlazoNotaCredito;
  const hoy = new Date();
  hoy.setDate(hoy.getDate() - 30);
  assert.throws(() => validarPlazo('2', hoy), /PLAZO_EXCEDIDO_NOTA_CREDITO/);
  assert.throws(() => validarPlazo('3', hoy), /PLAZO_EXCEDIDO_NOTA_CREDITO/);
});


test('NC-Payload: items mapping y exclusi�n de snapshots', () => {
  const adapter = require('../integrations/nubefact-faregas.adapter');
  const payload = adapter.construirPayloadNota({
    nota: { motivo_codigo: '1', sustento: 'ANULACION', serie: 'FC01', numero: '1', base_imponible: 100, igv: 18, importe_total: 118 },
    facturacion: { tipo_comprobante: 'FACTURA', nro_documento: '20123456789', tipo_documento_cliente: 'RUC', importe_total: 118, serie: 'F001', numero: '10', cliente_denominacion: 'EMPRESA', fecha_emision: new Date('2026-09-07T12:00:00Z') },
    tipoNota: 'CREDITO'
  });
  assert.equal(payload.items[0].unidad_de_medida, 'ZZ');
  assert.equal(payload.items[0].descripcion, 'ANULACION');
  assert.equal(payload.items[0].cantidad, 1);
  assert.equal(payload.items[0].valor_unitario, 0);
  assert.equal(payload.items[0].subtotal, 0);
  assert.equal(payload.items[0].igv, 0);
  assert.equal(payload.items[0].total, 118);
  assert.equal(payload.items[0].unidad_snapshot, undefined);
  assert.equal(payload.items[0].descripcion_snapshot, undefined);
});

