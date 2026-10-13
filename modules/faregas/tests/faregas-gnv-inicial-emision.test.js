const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const certificadosService = require('../services/faregas-certificados.service');

test('GNV INICIAL: validarEmision no arroja ReferenceError y valida modalidad INICIAL correctamente', async (t) => {
    // Si la base de datos está conectada, probamos directamente
    const db = require('../../../config/database');
    t.after(async () => {
        await db.pool?.end?.().catch(() => {});
    });

    try {
        const rCheck = await db.query('SELECT 1');
        assert.ok(rCheck);
    } catch {
        t.skip('Requiere base de datos activa');
        return;
    }

    const targetId = 556;
    const rCert = await db.query('SELECT id, planta_key FROM fg_certificado WHERE id = $1', [targetId]);
    if (rCert.rowCount === 0) {
        t.skip('Certificado 556 no encontrado');
        return;
    }

    const userContext = { username: 'mquijano', perfil_id: 'AMINISTRADOR', planta_key: rCert.rows[0].planta_key };
    const res = await certificadosService.validarEmision(targetId, userContext);

    assert.equal(typeof res, 'object');
    assert.equal(res.valido, true, 'El certificado 556 debe ser válido para emisión');
    assert.equal(res.errores.length, 0, 'No debe tener errores de validación');
});
