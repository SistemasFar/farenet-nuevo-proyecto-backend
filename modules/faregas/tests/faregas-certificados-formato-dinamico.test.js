const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-certificados.service');
const db = require('../../../config/database');

test.after(() => db.end());

const validar = (certificado) => {
    const errores = [];
    service._private.validarVariablesFormatoDinamico(certificado, (...error) => errores.push(error));
    return errores;
};

test('TALLER_INSPECCION con clave técnica GLP_ANUAL sólo exige variables del formato', () => {
    const errores = validar({
        tipo_clave: 'GLP_ANUAL', formato_version_resuelta_id: 33, formato_version_estado: 'VIGENTE',
        formato_version_configuracion: { variables_usadas: ['inspeccion.codigo', 'vehiculo.vin'] },
        formato_datos_snapshot: { inspeccion: { codigo: 'OK' } }
    });
    assert.deepEqual(errores, [['formato', 'vehiculo.vin', 'CAMPO_REQUERIDO', 'Complete vehiculo.vin']]);
});

test('exige las variables requeridas y rechaza una versión de formato no VIGENTE', () => {
    const errores = validar({
        formato_version_resuelta_id: 33, formato_version_estado: 'BORRADOR', formato_version_motor: 'HTML_DINAMICO',
        formato_version_configuracion: { html: '{{inspeccion.resultado}}' }, formato_datos_snapshot: {}
    });
    assert.deepEqual(errores.map(error => error[2]), ['FORMATO_VERSION_NO_VIGENTE', 'CAMPO_REQUERIDO']);
});
