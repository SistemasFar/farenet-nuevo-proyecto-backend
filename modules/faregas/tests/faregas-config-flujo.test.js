const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const service = require('../services/faregas-config.service');

test.after(() => db.end());

const certificado = (cambios = {}) => ({
    tipo_flujo: 'CERTIFICACION',
    requiere_certificado: true,
    tipo_certificado_clave: 'GLP_ANUAL',
    modalidad: 'ANUAL',
    ...cambios
});

test('acepta los cinco certificados base mediante sus combinaciones vigentes', async () => {
    const client = { query: async () => ({ rowCount: 1, rows: [{ activo: true }] }) };
    await service.validarConfiguracionServicio(client, certificado());
    await service.validarConfiguracionServicio(client, certificado({ modalidad: 'INICIAL' }));
    await service.validarConfiguracionServicio(client, certificado({ tipo_certificado_clave: 'GNV_ANUAL' }));
    await service.validarConfiguracionServicio(client, certificado({ tipo_certificado_clave: 'CONFORMIDAD', modalidad: null }));
});

test('rechaza certificaciones sin documento o con base incompatible', async () => {
    const client = { query: async () => ({ rowCount: 1, rows: [{}] }) };
    await assert.rejects(
        service.validarConfiguracionServicio(client, certificado({ requiere_certificado: false })),
        /CERTIFICACION_REQUIERE_CERTIFICADO/
    );
    await assert.rejects(
        service.validarConfiguracionServicio(client, certificado({ tipo_certificado_clave: 'CONFORMIDAD', modalidad: 'ANUAL' })),
        /CERTIFICADO_BASE_INCOMPATIBLE/
    );
});

test('acepta servicio complementario sin certificado y rechaza valores libres', async () => {
    const client = { query: async () => ({ rowCount: 0, rows: [] }) };
    await service.validarConfiguracionServicio(client, certificado({
        tipo_flujo: 'SERVICIO_COMPLEMENTARIO',
        requiere_certificado: false,
        tipo_certificado_clave: null,
        modalidad: null
    }));
    await assert.rejects(
        service.validarConfiguracionServicio(client, certificado({ tipo_flujo: 'OTRO' })),
        /TIPO_FLUJO_INVALIDO/
    );
});
