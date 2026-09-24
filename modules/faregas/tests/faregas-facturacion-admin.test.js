const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-facturacion-admin.service');

test('construye filtros administrativos parametrizados y limitados a sedes autorizadas', () => {
    const filtros = service._construirFiltros({
        texto: 'F001', estado: 'aceptado', plantaKey: '201',
        fechaDesde: '2026-08-01', fechaHasta: '2026-08-31'
    }, ['201', '202']);
    assert.match(filtros.where, /COALESCE\(f\.planta_key, oc\.planta_key\) = ANY\(\$1/);
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

test('permite filtrar documentos pendientes de respuesta SUNAT', () => {
    const filtros = service._construirFiltros({ estado: 'pendiente_sunat' }, ['201']);
    assert.deepEqual(filtros.valores, [['201'], 'PENDIENTE_SUNAT']);
});

test('permite filtrar comprobantes con anulación pendiente sin confundir el estado del comprobante', () => {
    const filtros = service._construirFiltros({ estado: 'pendiente_anulacion' }, ['201']);
    assert.match(filtros.where, /anulacion\.estado IN \('BORRADOR', 'PENDIENTE'\)/);
    assert.deepEqual(filtros.valores, [['201']]);
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
                id: 7, certificado_id: 9, operacion_id: null, es_venta_chip: false,
                planta_key: '201', planta_nombre: 'INDEPENDENCIA',
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
    assert.equal(resultado.documentos[0].origen, 'CERTIFICADO');
    assert.equal('respuesta' in resultado.documentos[0], false);
    assert.match(consultas[0], /LEFT JOIN fg_certificado/);
    assert.match(consultas[0], /LEFT JOIN fg_operacion_comercial/);
    assert.match(consultas[0], /LEFT JOIN LATERAL/);
    assert.equal(consultas.length, 3);
});

test('incluye una factura de venta de chip por operacion_id', async () => {
    const fakeDb = {
        async query(sql) {
            if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: 1 }] };
            if (/FROM fg_planta p/.test(sql) && !/FROM fg_facturacion/.test(sql)) {
                return { rows: [{ planta_key: '201', planta_nombre: 'INDEPENDENCIA', empresa_key: 'FAREGAS', empresa_nombre: 'FAREGAS' }] };
            }
            return { rows: [{
                id: 255, certificado_id: null, operacion_id: 214, es_venta_chip: true,
                planta_key: '201', planta_nombre: 'INDEPENDENCIA',
                empresa_key: 'FAREGAS', empresa_nombre: 'FAREGAS', tipo_comprobante: 'BOLETA',
                nro_comprobante: null, nro_documento: '12345678', nombre_razon_social: 'CLIENTE PRUEBA',
                placa: null, importe_total: 180, estado: 'BORRADOR', intentos: 0
            }] };
        }
    };

    const resultado = await service.listar({}, { username: 'user', perfil_id: 'SISTEMAS' }, {
        db: fakeDb,
        getPlantasPorUsuario: async () => [{ key: '201' }]
    });

    assert.equal(resultado.documentos[0].certificadoId, null);
    assert.equal(resultado.documentos[0].operacionId, 214);
    assert.equal(resultado.documentos[0].origen, 'VENTA_CHIP');
    assert.equal(resultado.documentos[0].estado, 'BORRADOR');
});

test('consulta el detalle de una venta de chip usando la sede de la operacion', async () => {
    const consultas = [];
    const fakeDb = {
        async query(sql) {
            consultas.push(sql);
            if (sql.includes('WHERE f.id = $1')) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: 255, certificado_id: null, operacion_id: 214, es_venta_chip: true,
                        planta_key: '201', planta_nombre: 'INDEPENDENCIA',
                        empresa_key: 'FAREGAS', empresa_nombre: 'FAREGAS', tipo_comprobante: 'BOLETA',
                        nro_documento: '12345678', nombre_razon_social: 'CLIENTE PRUEBA',
                        importe_total: 180, estado: 'BORRADOR', intentos: 0
                    }]
                };
            }
            if (sql.includes('FROM fg_facturacion_intento')) return { rows: [] };
            if (sql.includes('FROM fg_documento_electronico_operacion')) return { rows: [] };
            throw new Error(`Consulta inesperada: ${sql}`);
        }
    };

    const resultado = await service.obtenerDetalle(255, { username: 'user', perfil_id: 'SISTEMAS' }, {
        db: fakeDb,
        getPlantasPorUsuario: async () => [{ key: '201' }]
    });

    assert.equal(resultado.documento.origen, 'VENTA_CHIP');
    assert.equal(resultado.documento.operacionId, 214);
    assert.match(consultas[0], /COALESCE\(f\.planta_key, oc\.planta_key\) = ANY/);
});
