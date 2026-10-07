const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../services/faregas-inventario-cantidad.service');

test('usa CANTIDAD sin reemplazar CHIP_SERIALIZADO', () => {
    assert.equal(service.TIPO_CONTROL_CANTIDAD, 'CANTIDAD');
});

test('un ingreso de 100 produce stock 100', () => {
    assert.equal(service._private.calcularStock([{ sentido: 'ENTRADA', cantidad: 100 }]), 100);
});

test('una venta de 3 después del ingreso deja stock 97', () => {
    assert.equal(service._private.calcularStock([
        { sentido: 'ENTRADA', cantidad: 100 },
        { sentido: 'SALIDA', cantidad: 3 }
    ]), 97);
});

test('rechaza venta superior al stock con mensaje funcional', () => {
    assert.throws(() => service.validarStockDisponible(3, 4), (error) => {
        assert.equal(error.message, 'STOCK_INSUFICIENTE');
        assert.deepEqual(error.detalles, { disponible: 3, solicitado: 4 });
        return true;
    });
});

test('cantidad debe ser entera y positiva', () => {
    assert.equal(service.normalizarCantidad('2'), 2);
    assert.throws(() => service.normalizarCantidad(0), /CANTIDAD_INVALIDA/);
    assert.throws(() => service.normalizarCantidad(1.5), /CANTIDAD_INVALIDA/);
});

test('las hojas están protegidas por backend y sólo permiten SURCO 98', () => {
    assert.equal(service.validarSedeHojas('98'), '98');
    for (const sede of ['13', '160', '201']) {
        assert.throws(() => service.validarSedeHojas(sede), /SEDE_PRODUCTO_CANTIDAD_NO_HABILITADA/);
    }
});

test('el detalle usa P. venta fiscal, cantidad y snapshot comercial', () => {
    const detalle = service.construirDetalleCantidad({
        id: 35,
        producto_facturacion_id: 227,
        codigo_sku: '0130',
        descripcion: 'CERTIFICADO GLP',
        unidad: 'NIU',
        tipo_afectacion_igv: '10',
        codigo_clasificacion_sunat: null,
        precio: 30
    }, 2);
    assert.equal(detalle.productoFacturacionId, 227);
    assert.equal(detalle.codigoSku, '0130');
    assert.equal(detalle.precioUnitario, 30);
    assert.equal(detalle.cantidad, 2);
    assert.equal(detalle.importeTotal, 60);
    assert.equal(detalle.baseImponible + detalle.igv, 60);
});

test('la resolución transaccional bloquea la configuración antes de leer stock', async () => {
    const consultas = [];
    const fake = {
        async query(sql) {
            consultas.push(sql);
            if (sql.includes('FROM fg_producto_inventariable pi')) {
                return { rowCount: 1, rows: [{
                    id: 35, codigo: 'HOJA_GLP', nombre: 'Certificado GLP - Hojas',
                    tipo: 'CANTIDAD', control_stock: true, activo: true,
                    sede_activa: true, stock_permitido: true, venta_habilitada: true,
                    producto_facturacion_id: 227, codigo_sku: '0130', descripcion: 'CERTIFICADO GLP',
                    unidad: 'NIU', tipo_afectacion_igv: '10', codigo_clasificacion_sunat: null,
                    fiscal_activo: true, es_para_venta: true, valor_unitario_fiscal: 25.42,
                    precio_referencia: 30
                }] };
            }
            return { rowCount: 1, rows: [{ stock: 10, ingresos: 10, vendidos: 0 }] };
        }
    };
    const venta = await service.prepararVentaEnTransaccion(fake, {
        productoInventariableId: 35,
        cantidad: 3,
        plantaKey: '98'
    });
    assert.equal(venta.stockAntes, 10);
    assert.match(consultas[0], /FOR UPDATE OF pis/);
    assert.match(consultas[1], /fg_inventario_cantidad_movimiento/);
});

test('la salida por venta se vincula al detalle y no inventa serial', async () => {
    let consulta = null;
    let parametros = null;
    await service.registrarSalidaVenta({
        async query(sql, values) { consulta = sql; parametros = values; return { rowCount: 1, rows: [] }; }
    }, {
        detalle: { productoInventariableId: 35, cantidad: 2, precioUnitario: 30, importeTotal: 60 },
        detalleId: 501,
        plantaKey: '98',
        operacionId: 88,
        username: 'tester'
    });
    assert.match(consulta, /fg_inventario_cantidad_movimiento/);
    assert.doesNotMatch(consulta, /fg_operacion_detalle_chip|fg_chip/);
    assert.deepEqual(parametros.slice(0, 5), [35, '98', 2, 501, 'tester']);
});

test('la migración no inventa stock inicial y vincula 0130/0132 sólo a SURCO', () => {
    const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/20261007_faregas_inventario_cantidad_hojas.sql'), 'utf8');
    assert.match(migration, /'HOJA_GLP'.*'CANTIDAD'/s);
    assert.match(migration, /codigo_sku = '0130'/);
    assert.match(migration, /codigo_sku = '0132'/);
    assert.match(migration, /planta_key <> '98'/);
    assert.doesNotMatch(migration, /INSERT INTO fg_inventario_cantidad_movimiento/);
});

test('la venta canónica mantiene el detalle-chip sólo para productos serializados', () => {
    const canonical = fs.readFileSync(path.join(__dirname, '../services/faregas-venta-directa-canonica.service.js'), 'utf8');
    assert.match(canonical, /if \(detalle\.chipId != null\)/);
    assert.match(canonical, /registrarSalidaVenta/);
    assert.match(canonical, /detalle\.cantidad \|\| 1/);
});
