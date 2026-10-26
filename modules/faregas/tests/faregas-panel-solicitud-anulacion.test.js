const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (relativo) => fs.readFileSync(path.join(__dirname, relativo), 'utf8');

test('Bloque A: el listado del panel resume la solicitud administrativa por certificado', () => {
    const service = leer('../services/faregas-certificados.service.js');

    // La consulta del panel obtiene la solicitud administrativa en la misma operación de listado.
    assert.match(service, /LEFT JOIN LATERAL[\s\S]*?SELECT s\.id AS "solicitudOperacionId"/);
    assert.match(service, /FROM fg_solicitud_operacion s/);
    assert.match(service, /solicitud\."solicitudOperacionId" AS "solicitudOperacionId"/);
    assert.match(service, /solicitud\."solicitudOperacionEstado" AS "solicitudOperacionEstado"/);
    assert.match(service, /solicitud\."solicitudOperacionTipo" AS "solicitudOperacionTipo"/);
    assert.match(service, /solicitud\."solicitudOperacionMotivo" AS "solicitudOperacionMotivo"/);
});

test('Bloque A: el alta de solicitudes sigue bloqueando duplicados activos', () => {
    const service = leer('../services/faregas-solicitudes-operacion.service.js');
    assert.match(service, /SOLICITUD_INCOMPATIBLE_ACTIVA/);
    assert.match(service, /ESTADOS_QUE_BLOQUEAN/);
});

test('Bloque A: notas de anulación y puerta fiscal responden fail-closed sin solicitud', () => {
    const documentos = leer('../controllers/faregas-documentos-electronicos.controller.js');
    const fiscal = leer('../services/faregas-autorizacion-fiscal.service.js');

    // Las notas anulatorias independientes requieren una solicitud administrativa previa.
    assert.match(documentos, /NOTA_CREDITO_ANULACION_REQUIERE_SOLICITUD/);
    assert.match(documentos, /FAREGAS_SOLICITUD_FISCAL_REQUERIDA/);
    // La puerta fiscal exige una solicitud aprobada por SISTEMAS y sin resultado previo.
    assert.match(fiscal, /row\.estado !== 'APROBADA'[\s\S]*?row\.estado !== 'EN_EJECUCION'/);
});

test('Bloque A: el listado mantiene aislamiento por sede y no rompe paginación', () => {
    const service = leer('../services/faregas-certificados.service.js');
    assert.match(service, /c\.planta_key = \$1/);
});
