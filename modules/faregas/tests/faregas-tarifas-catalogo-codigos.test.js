const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { construirCatalogo } = require('../services/faregas-tarifas.service');

test('construirCatalogo expone el código comercial del producto de facturación en codigo y codigoServicio', () => {
    const sede = { key: '98', nombre: 'SURCO' };
    const rows = [
        {
            categoria_codigo: 'GNV',
            categoria_nombre: 'GNV',
            categoria_orden: 2,
            servicio_id: 331,
            servicio_codigo: '0423',
            servicio_nombre: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GNV',
            servicio_orden: 1,
            tipo_flujo: 'TALLER_INSPECCION',
            requiere_certificado: true,
            requiere_vehiculo: true,
            tipo_certificado_clave: 'GNV_ANUAL',
            modalidad: 'ANUAL',
            tarifa_id: 209,
            tarifa_codigo: '0423',
            precio_tarifa: 350,
            producto_facturacion_id: 45,
            producto_sku: '0423',
            producto_precio_referencia: '350.00',
            producto_precio_unitario: '296.61',
            requiere_chip: false,
        },
        {
            categoria_codigo: 'GNV',
            categoria_nombre: 'GNV',
            categoria_orden: 2,
            servicio_id: 4,
            servicio_codigo: 'GNV_ANUAL',
            servicio_nombre: 'Certificado Anual',
            servicio_orden: 2,
            tipo_flujo: 'CERTIFICACION',
            requiere_certificado: true,
            requiere_vehiculo: true,
            tipo_certificado_clave: 'GNV_ANUAL',
            modalidad: 'ANUAL',
            tarifa_id: 4,
            tarifa_codigo: 'GNV_ANUAL',
            precio_tarifa: 80,
            producto_facturacion_id: 2233,
            producto_sku: 'GNV-ANUAL-201',
            producto_precio_referencia: null,
            producto_precio_unitario: '80.00',
            requiere_chip: false,
        },
        {
            categoria_codigo: 'GLP',
            categoria_nombre: 'GLP',
            categoria_orden: 1,
            servicio_id: 1,
            servicio_codigo: 'GLP_ANUAL',
            servicio_nombre: 'Certificado Anual',
            servicio_orden: 1,
            tipo_flujo: 'CERTIFICACION',
            requiere_certificado: true,
            requiere_vehiculo: true,
            tipo_certificado_clave: 'GLP_ANUAL',
            modalidad: 'ANUAL',
            tarifa_id: 1,
            tarifa_codigo: 'GLP_ANUAL',
            precio_tarifa: 60,
            producto_facturacion_id: 190,
            producto_sku: '0221',
            producto_precio_referencia: '60.00',
            producto_precio_unitario: '50.85',
            requiere_chip: false,
        }
    ];

    const catalogo = construirCatalogo(sede, rows);

    assert.equal(catalogo.sede.key, '98');
    assert.equal(catalogo.categorias.length, 2);

    const gnvCat = catalogo.categorias.find(c => c.codigo === 'GNV');
    assert.ok(gnvCat);

    // 1. Taller GNV: conserva 0423
    const tallerGnv = gnvCat.servicios.find(s => s.id === 331);
    assert.ok(tallerGnv);
    assert.equal(tallerGnv.codigo, '0423');
    assert.equal(tallerGnv.codigoServicio, '0423');
    assert.equal(tallerGnv.codigoComercial, '0423');
    assert.equal(tallerGnv.servicio_codigo_interno, '0423');

    // 2. Base GNV_ANUAL: ahora muestra su código comercial GNV-ANUAL-201
    const baseGnv = gnvCat.servicios.find(s => s.id === 4);
    assert.ok(baseGnv);
    assert.equal(baseGnv.codigo, 'GNV-ANUAL-201');
    assert.equal(baseGnv.codigoServicio, 'GNV-ANUAL-201');
    assert.equal(baseGnv.codigoComercial, 'GNV-ANUAL-201');
    assert.equal(baseGnv.servicio_codigo_interno, 'GNV_ANUAL');
    assert.equal(baseGnv.tarifa.codigoSku, 'GNV-ANUAL-201');

    // 3. Base GLP_ANUAL: ahora muestra su código comercial 0221
    const glpCat = catalogo.categorias.find(c => c.codigo === 'GLP');
    assert.ok(glpCat);
    const baseGlp = glpCat.servicios.find(s => s.id === 1);
    assert.ok(baseGlp);
    assert.equal(baseGlp.codigo, '0221');
    assert.equal(baseGlp.codigoServicio, '0221');
    assert.equal(baseGlp.codigoComercial, '0221');
    assert.equal(baseGlp.servicio_codigo_interno, 'GLP_ANUAL');
    assert.equal(baseGlp.tarifa.codigoSku, '0221');
});
