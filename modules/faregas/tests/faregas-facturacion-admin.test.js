const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-facturacion-admin.service');

test('construye filtros administrativos parametrizados y limitados a sedes autorizadas', () => {
    const filtros = service._construirFiltros({
        texto: 'F001', estado: 'aceptado', plantaKey: '201',
        fechaDesde: '2026-08-01', fechaHasta: '2026-08-31'
    }, ['201', '202']);
    assert.match(filtros.where, /f\.planta_key = ANY\(\$1/);
    assert.match(filtros.where, /f\.estado = \$4/);
    assert.deepEqual(filtros.valores, [['201', '202'], 'F001', '201', 'ACEPTADO', '2026-08-01', '2026-08-31']);
    assert.equal(filtros.where.includes('F001'), false);
});

test('rechaza una sede fuera del alcance del usuario', () => {
    assert.throws(
        () => service._construirFiltros({ plantaKey: '999' }, ['201']),
        error => error.message === 'PLANTA_NO_AUTORIZADA' && error.statusCode === 403
    );
});

test('lista documentos sin exponer solicitudes ni respuestas del proveedor', async () => {
    const consultas = [];
    const fakeDb = {
        async query(sql) {
            consultas.push(sql);
            if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: 1 }] };
            if (/FROM fg_planta p/.test(sql) && !/FROM fg_facturacion/.test(sql)) {
                return { rows: [{ planta_key: '201', planta_nombre: 'INDEPENDENCIA', empresa_key: 'FG', empresa_nombre: 'FAREGAS' }] };
            }
            return { rows: [{
                id: 7, certificado_id: 9, planta_key: '201', planta_nombre: 'INDEPENDENCIA',
                empresa_key: 'FG', empresa_nombre: 'FAREGAS', tipo_comprobante: 'BOLETA',
                nro_comprobante: 'B001-1', nro_documento: '12345678', nombre_razon_social: 'CLIENTE',
                placa: 'ABC123', importe_total: 50, estado: 'ACEPTADO', intentos: 1
            }] };
        }
    };
    const resultado = await service.listar({}, { username: 'user', perfil_id: 'SISTEMAS' }, {
        db: fakeDb,
        getPlantasPorUsuario: async () => [{ key: '201' }]
    });
    assert.equal(resultado.documentos[0].nroComprobante, 'B001-1');
    assert.equal('respuesta' in resultado.documentos[0], false);
    assert.equal(consultas.length, 3);
});
