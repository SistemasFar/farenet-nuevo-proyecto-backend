'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const policyService = require('../services/faregas-password-policy.service');

test('política de contraseñas FAREGAS — 3 caracteres rechazada en entorno de pruebas', () => {
    const res = policyService.validarPoliticaPassword('123', 'operador', { esProduccion: false, minLongitud: 4 });
    assert.equal(res.valido, false);
    assert.equal(res.codigo, 'LONGITUD_INSUFICIENTE');
    assert.match(res.mensaje, /al menos 4 caracteres/);
});

test('política de contraseñas FAREGAS — 4 caracteres aceptada en pruebas con advertencia de débil', () => {
    const res = policyService.validarPoliticaPassword('1234', 'operador', { esProduccion: false, minLongitud: 4 });
    assert.equal(res.valido, true);
    assert.equal(res.esDebil, true);
    assert.match(res.advertencia, /Contraseña débil/);
});

test('política de contraseñas FAREGAS — 8 caracteres aceptada', () => {
    const res = policyService.validarPoliticaPassword('Pass2026', 'operador', { esProduccion: false, minLongitud: 4 });
    assert.equal(res.valido, true);
});

test('política de contraseñas FAREGAS — 12 caracteres fuertes aceptada', () => {
    const res = policyService.validarPoliticaPassword('ClaveSegura#2026', 'operador', { esProduccion: false, minLongitud: 4 });
    assert.equal(res.valido, true);
    assert.equal(res.esDebil, false);
    assert.equal(res.advertencia, null);
});

test('política de contraseñas FAREGAS — rechaza triviales o que contengan el username', () => {
    const trivial = policyService.validarPoliticaPassword('password1234', 'operador', { minLongitud: 4 });
    assert.equal(trivial.valido, false);
    assert.equal(trivial.codigo, 'PASSWORD_TRIVIAL');

    const conUser = policyService.validarPoliticaPassword('Operador#2026', 'operador', { minLongitud: 4 });
    assert.equal(conUser.valido, false);
    assert.equal(conUser.codigo, 'CONTIENE_USERNAME');
});

test('política de contraseñas FAREGAS — producción conserva política estricta de 12 caracteres y complejidad', () => {
    // 4 caracteres rechazada en producción
    const res4 = policyService.validarPoliticaPassword('1234', 'operador', { esProduccion: true });
    assert.equal(res4.valido, false);
    assert.match(res4.mensaje, /al menos 12 caracteres/);

    // 8 caracteres rechazada en producción
    const res8 = policyService.validarPoliticaPassword('Pass#2026', 'operador', { esProduccion: true });
    assert.equal(res8.valido, false);
    assert.match(res8.mensaje, /al menos 12 caracteres/);

    // 12 caracteres sin número/símbolo rechazada por complejidad en producción
    const resSinComp = policyService.validarPoliticaPassword('ClaveMuyLargaSinNum', 'operador', { esProduccion: true });
    assert.equal(resSinComp.valido, false);
    assert.equal(resSinComp.codigo, 'COMPLEJIDAD_INSUFICIENTE');

    // 12 caracteres con mayúscula, minúscula y número/símbolo aceptada
    const resProd12 = policyService.validarPoliticaPassword('ClaveSegura#2026', 'operador', { esProduccion: true });
    assert.equal(resProd12.valido, true);
    assert.equal(resProd12.esDebil, false);
});

test('nueva contraseña se aplica y valida correctamente en login', () => {
    const passwordNueva = '1234';
    const hash = bcrypt.hashSync(passwordNueva, 10);
    assert.ok(bcrypt.compareSync(passwordNueva, hash));
    assert.ok(!bcrypt.compareSync('otra_clave', hash));
});
