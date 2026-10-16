const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const dashboardService = require('../services/faregas-dashboard.service');

test('FAREGAS Dashboard - Filtrado por Producto (producto_facturacion_id)', async (t) => {
    const plantasRes = await db.query('SELECT key FROM fg_planta');
    const plantas = plantasRes.rows.map(r => r.key);
    const desde = '2026-10-01';
    const hasta = '2026-10-15';

    await t.test('1. Resumen general sin filtro incluye distribucionProductos y métricas globales', async () => {
        const resumenGlobal = await dashboardService.obtenerResumenDashboard({
            plantasAutorizadas: plantas,
            desde,
            hasta
        });

        assert.ok(resumenGlobal, 'Debe devolver un resumen válido');
        assert.ok(Array.isArray(resumenGlobal.distribucionProductos), 'distribucionProductos debe ser un array');
        assert.ok(resumenGlobal.distribucionProductos.length > 0, 'Debe haber productos en la distribución');

        // Verificar que cada producto tiene su id numérico real
        for (const prod of resumenGlobal.distribucionProductos) {
            assert.ok(typeof prod.id === 'number', `El producto ${prod.descripcion} debe tener un id numérico`);
            assert.ok(prod.sku, 'Debe tener SKU');
            assert.ok(prod.descripcion, 'Debe tener descripción');
        }

        // Verificar que existen productos con el mismo nombre y diferente ID
        const chipSurco = resumenGlobal.distribucionProductos.find(p => p.id === 25);
        const chipColina = resumenGlobal.distribucionProductos.find(p => p.id === 2335);
        assert.ok(chipSurco, 'Debe existir CHIP + PORTA CHIP - SURCO (ID 25)');
        assert.ok(chipColina, 'Debe existir CHIP + PORTA CHIP - COLINA (ID 2335)');
        assert.equal(chipSurco.descripcion, 'CHIP + PORTA CHIP');
        assert.equal(chipColina.descripcion, 'CHIP + PORTA CHIP');
        assert.notEqual(chipSurco.id, chipColina.id, 'Los IDs deben ser distintos');
        assert.notEqual(chipSurco.sku, chipColina.sku, 'Los SKUs deben ser distintos');
    });

    await t.test('2. Filtrar por producto ID 25 actualiza kpis exclusivamente para ese producto', async () => {
        const resumenGlobal = await dashboardService.obtenerResumenDashboard({
            plantasAutorizadas: plantas,
            desde,
            hasta
        });

        const resumenProd25 = await dashboardService.obtenerResumenDashboard({
            plantasAutorizadas: plantas,
            desde,
            hasta,
            productoId: 25
        });

        const prod25Item = resumenGlobal.distribucionProductos.find(p => p.id === 25);
        assert.ok(prod25Item, 'Debe existir producto 25 en la distribución');

        // Unidades vendidas en KPI deben coincidir exactamente con las unidades del producto 25
        assert.equal(resumenProd25.kpis.productosVendidos.actual, prod25Item.unidadesVendidas);

        // Venta bruta y neta deben coincidir con las ventas del producto 25 (en este caso sin notas/descuentos: 1080)
        assert.equal(resumenProd25.kpis.ventaBruta.actual, prod25Item.totalSoles);
        assert.equal(resumenProd25.kpis.ventaNeta.actual, prod25Item.totalSoles);

        // Ticket promedio debe ser totalSoles / operaciones
        const ticketEsperado = Number((prod25Item.totalSoles / prod25Item.operaciones).toFixed(2));
        assert.equal(resumenProd25.kpis.ticketPromedio.actual, ticketEsperado);

        // La distribución de productos en el resumen filtrado sigue conteniendo el catálogo para poder cambiar de producto
        assert.ok(resumenProd25.distribucionProductos.length > 1, 'Conserva el catálogo completo de productos');
    });

    await t.test('3. Filtrar por producto ID 2335 es independiente de ID 25 aunque compartan nombre', async () => {
        const resumenProd2335 = await dashboardService.obtenerResumenDashboard({
            plantasAutorizadas: plantas,
            desde,
            hasta,
            productoId: 2335
        });

        // ID 2335 solo tiene 1 unidad vendida de S/ 180.00
        assert.equal(resumenProd2335.kpis.productosVendidos.actual, 1);
        assert.equal(resumenProd2335.kpis.ventaBruta.actual, 180);
        assert.equal(resumenProd2335.kpis.ventaNeta.actual, 180);
        assert.equal(resumenProd2335.kpis.ticketPromedio.actual, 180);
    });

    await t.test('4. Serie diaria se filtra exclusivamente para el producto seleccionado', async () => {
        const resumenProd25 = await dashboardService.obtenerResumenDashboard({
            plantasAutorizadas: plantas,
            desde,
            hasta,
            productoId: 25
        });

        // La suma de las ventas de la serie diaria debe ser exactamente igual a la venta bruta del producto
        const sumaSerie = resumenProd25.serieDiaria.reduce((acc, d) => acc + d.venta, 0);
        assert.equal(Number(sumaSerie.toFixed(2)), resumenProd25.kpis.ventaBruta.actual);
    });

    await t.test('5. Tablas de detalle (productos, sedes, usuarios) se filtran con productoId', async () => {
        // Detalle productos
        const prods = await dashboardService.obtenerDetalleProductos({
            plantasAutorizadas: plantas,
            desde,
            hasta,
            productoId: 25
        });
        assert.equal(prods.items.length, 1, 'Debe devolver exactamente 1 fila para el producto seleccionado');
        assert.equal(prods.items[0].id, 25);

        // Detalle sedes
        const sedes = await dashboardService.obtenerDetalleSedes({
            plantasAutorizadas: plantas,
            desde,
            hasta,
            productoId: 25
        });
        const sedesConVenta = sedes.filter(s => s.ventaOperativa > 0);
        const totalVentaSedes = sedesConVenta.reduce((acc, s) => acc + s.ventaOperativa, 0);
        assert.equal(Number(totalVentaSedes.toFixed(2)), 1080);

        // Detalle usuarios
        const usuarios = await dashboardService.obtenerDetalleUsuarios({
            plantasAutorizadas: plantas,
            desde,
            hasta,
            productoId: 25
        });
        const usuariosConVenta = usuarios.filter(u => u.totalVendido > 0);
        const totalVentaUsuarios = usuariosConVenta.reduce((acc, u) => acc + u.totalVendido, 0);
        assert.equal(Number(totalVentaUsuarios.toFixed(2)), 1080);
    });

    await t.test('6. Restauración: Al no enviar productoId se recuperan exactamente los totales originales', async () => {
        const resumenGlobal1 = await dashboardService.obtenerResumenDashboard({
            plantasAutorizadas: plantas,
            desde,
            hasta
        });

        const resumenProd25 = await dashboardService.obtenerResumenDashboard({
            plantasAutorizadas: plantas,
            desde,
            hasta,
            productoId: 25
        });

        const resumenGlobal2 = await dashboardService.obtenerResumenDashboard({
            plantasAutorizadas: plantas,
            desde,
            hasta,
            productoId: undefined
        });

        assert.equal(resumenGlobal1.kpis.ventaBruta.actual, resumenGlobal2.kpis.ventaBruta.actual);
        assert.equal(resumenGlobal1.kpis.ventaNeta.actual, resumenGlobal2.kpis.ventaNeta.actual);
        assert.equal(resumenGlobal1.kpis.productosVendidos.actual, resumenGlobal2.kpis.productosVendidos.actual);
        assert.equal(resumenGlobal1.kpis.ticketPromedio.actual, resumenGlobal2.kpis.ticketPromedio.actual);
        assert.notEqual(resumenProd25.kpis.ventaBruta.actual, resumenGlobal1.kpis.ventaBruta.actual);
    });
});
