const test = require('node:test');
const assert = require('node:assert/strict');

const { _private } = require('../services/faregas-certificados.service');

test('un formato SISTEMA protegido usa su plantilla base sin exigir variante', () => {
    assert.equal(_private.usaFormatoDinamico({
        servicio_tipo_flujo: 'TALLER_INSPECCION',
        formato_es_protegido: true,
        formato_motor: 'SISTEMA',
        formato_version_resuelta_id: null
    }), false);
});

test('un formato personalizable de taller todavía exige su versión dinámica', () => {
    assert.equal(_private.usaFormatoDinamico({
        servicio_tipo_flujo: 'TALLER_INSPECCION',
        formato_es_protegido: false,
        formato_motor: 'HTML_DINAMICO',
        formato_version_resuelta_id: null
    }), true);
});

