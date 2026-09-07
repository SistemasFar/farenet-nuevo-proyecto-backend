const test = require('node:test');
const assert = require('node:assert/strict');
const documentos = require('../services/faregas-documentos-electronicos.service');

test('NC-X: Motivo 03 intentando modificar monto -> BLOQUEADO', () => {
    const validar = documentos._private.validarDatosNota;
    assert.throws(() => validar('CREDITO', {
        motivoCodigo: '3', sustento: 'CORRECCION DE DESCRIPCION',
        baseImponible: 50, igv: 9, importeTotal: 59
    }, { importe_total: 118, fecha_emision: new Date() }, 0), /NOTA_CREDITO_DEBE_SER_TOTAL/);
});

test('NC-Y: Motivo valido monetario parcial -> permitido, SOLO si FAREGAS lo requiere', () => {
    const validar = documentos._private.validarDatosNota;
    assert.throws(() => validar('CREDITO', {
        motivoCodigo: '9', sustento: 'DESCUENTO POSTERIOR',
        baseImponible: 50, igv: 9, importeTotal: 59
    }, { importe_total: 118, fecha_emision: new Date() }, 0), /MOTIVO_NOTA_CREDITO_NO_PERMITIDO_O_INVALIDO/);
});

test('NC-Z: Motivo total intentando monto parcial cuando no corresponde -> BLOQUEADO', () => {
    const validar = documentos._private.validarDatosNota;
    assert.throws(() => validar('CREDITO', {
        motivoCodigo: '1', sustento: 'ANULACION',
        baseImponible: 50, igv: 9, importeTotal: 59
    }, { importe_total: 118, fecha_emision: new Date() }, 0), /NOTA_CREDITO_DEBE_SER_TOTAL/);
});

test('NC-A: NC total aceptada -> OK', () => {
    const validar = documentos._private.validarDatosNota;
    const data = validar('CREDITO', {
        motivoCodigo: '1', sustento: 'ANULACION DE OPERACION',
        baseImponible: 100, igv: 18, importeTotal: 118
    }, { importe_total: 118, fecha_emision: new Date() }, 0);
    assert.equal(data.motivoCodigo, '1');
});
