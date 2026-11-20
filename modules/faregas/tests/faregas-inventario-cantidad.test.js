const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../services/faregas-inventario-cantidad.service');
const chipsService = require('../services/faregas-chips.service');
const authService = require('../services/faregas-auth.service');
const clientesService = require('../services/faregas-clientes.service');
const ventaCanonicaService = require('../services/faregas-venta-directa-canonica.service');
const db = require('../../../config/database');

const productoFiscal = (overrides = {}) => ({
    id: 35,
    codigo: 'HOJA_GLP',
    nombre: 'Hojas GLP',
    tipo: 'CANTIDAD',
    control_stock: true,
    activo: true,
    sede_activa: true,
    stock_permitido: true,
    venta_habilitada: true,
    producto_facturacion_id: 227,
    codigo_sku: '0130',
    descripcion: 'HOJAS GLP',
    unidad: 'NIU',
    tipo_afectacion_igv: '10',
    codigo_clasificacion_sunat: null,
    fiscal_activo: true,
    es_para_venta: true,
    precio_referencia: 12.6,
    sujeto_detraccion: false,
    detraccion_codigo: null,
    detraccion_porcentaje: null,
    ...overrides
});

test('los productos por cantidad usan la sede activa y no una sede fija', () => {
    for (const plantaKey of ['13', '98', '160', '201']) {
        assert.equal(service.validarSedeProductoCantidad(plantaKey), plantaKey);
    }
    assert.throws(() => service.validarSedeProductoCantidad(''), /PLANTA_REQUERIDA/);
});

test('cantidad debe ser entera y positiva', () => {
    assert.equal(service.normalizarCantidad('1'), 1);
    assert.equal(service.normalizarCantidad(100), 100);
    for (const value of [0, -1, 1.5, '']) {
        assert.throws(() => service.normalizarCantidad(value), /CANTIDAD_INVALIDA/);
    }
});

test('el total usa la cantidad por el precio fiscal vigente para 1 y 100 unidades', () => {
    const config = productoFiscal();
    config.precio = 12.6;
    const una = service.construirDetalleCantidad(config, 1);
    const cien = service.construirDetalleCantidad(config, 100);

    assert.equal(una.importeTotal, 12.6);
    assert.equal(cien.importeTotal, 1260);
    assert.equal(cien.baseImponible + cien.igv, 1260);
    assert.equal(cien.cantidad, 100);
});

test('no inventa SPOT para bienes con clasificación no sujeta y código/tasa nulos', () => {
    const config = productoFiscal();
    config.precio = 12.6;
    const detalle = service.construirDetalleCantidad(config, 100);
    assert.deepEqual(detalle.productoSpot, {
        sujeto_detraccion: false,
        detraccion_codigo: null,
        detraccion_porcentaje: null
    });
});

test('rechaza una cantidad mayor que el stock y expone disponible/solicitado', () => {
    assert.throws(() => service.validarStockDisponible(99, 100), (error) => {
        assert.equal(error.message, 'STOCK_INSUFICIENTE');
        assert.deepEqual(error.detalles, { disponible: 99, solicitado: 100 });
        return true;
    });
    assert.equal(service.validarStockDisponible(100, 100), true);
});

test('la preparación valida configuración por sede, bloquea esa fila y consulta el stock de esa sede', async () => {
    const consultas = [];
    const fake = {
        async query(sql, params) {
            consultas.push({ sql, params });
            if (sql.includes('FROM fg_producto_inventariable pi')) {
                return { rowCount: 1, rows: [productoFiscal()] };
            }
            return { rowCount: 1, rows: [{ stock: 150, ingresos: 150, vendidos: 0 }] };
        }
    };
    const venta = await service.prepararVentaEnTransaccion(fake, {
        productoInventariableId: 35,
        cantidad: 100,
        plantaKey: '160'
    });

    assert.equal(venta.stockAntes, 150);
    assert.equal(venta.detalle.importeTotal, 1260);
    assert.equal(consultas[0].params[1], '160');
    assert.match(consultas[0].sql, /pis\.planta_key = \$2/);
    assert.match(consultas[0].sql, /FOR UPDATE OF pis/);
    assert.match(consultas[0].sql, /p\.empresa_key = 'FAREGAS'/);
    assert.equal(consultas[1].params[1], '160');
});

test('la salida por venta descuenta cantidad una vez y la enlaza al detalle comercial', async () => {
    let consulta = '';
    let parametros = [];
    await service.registrarSalidaVenta({
        async query(sql, values) {
            consulta = sql;
            parametros = values;
            return { rowCount: 1, rows: [] };
        }
    }, {
        detalle: { productoInventariableId: 35, cantidad: 100, precioUnitario: 12.6, importeTotal: 1260 },
        detalleId: 501,
        plantaKey: '160',
        operacionId: 88,
        username: 'emisor'
    });
    assert.match(consulta, /INSERT INTO fg_inventario_cantidad_movimiento/);
    assert.match(consulta, /'VENTA', 'SALIDA'/);
    assert.doesNotMatch(consulta, /fg_chip|fg_operacion_detalle_chip/);
    assert.deepEqual(parametros.slice(0, 5), [35, '160', 100, 501, 'emisor']);
});

test('la venta canónica por cantidad persiste operación, detalle y pago en una transacción aislada', async () => {
    const connectAnterior = db.connect;
    const accesoAnterior = authService.validarAccesoPlanta;
    const clienteAnterior = clientesService.asegurarCliente;
    const prepararAnterior = service.prepararVentaEnTransaccion;
    const salidaAnterior = service.registrarSalidaVenta;
    const consultas = [];
    const salidasInventario = [];
    const client = {
        async query(sql, values = []) {
            consultas.push({ sql, values });
            if (sql.includes('INSERT INTO fg_operacion_comercial')) return { rowCount: 1, rows: [{ id: '88' }] };
            if (sql.includes('INSERT INTO fg_operacion_detalle (')) return { rowCount: 1, rows: [{ id: '501' }] };
            if (sql.includes('INSERT INTO fg_orden_pago')) return { rowCount: 1, rows: [{ id: '999' }] };
            return { rowCount: 1, rows: [] };
        },
        release() { this.released = true; }
    };
    try {
        db.connect = async () => client;
        authService.validarAccesoPlanta = async () => ({ key: '160', nombre: 'SURQUILLO' });
        clientesService.asegurarCliente = async () => ({ id: 400 });
        service.prepararVentaEnTransaccion = async (_client, { cantidad, productoInventariableId, plantaKey }) => {
            const config = productoFiscal({ id: productoInventariableId });
            config.precio = 12.6;
            return { detalle: service.construirDetalleCantidad(config, cantidad), config, stockAntes: 150, plantaKey };
        };
        service.registrarSalidaVenta = async (_client, data) => { salidasInventario.push(data); };

        const result = await ventaCanonicaService.crearVentaDirecta({
            productoInventariableId: 35,
            cantidad: 100,
            tipoComprobante: 'BOLETA',
            condicionPago: 'CONTADO',
            tipoDocumentoCliente: 'DNI',
            nroDocumento: '12345678',
            nombreRazonSocial: 'Cliente de prueba aislada',
            telefono: '912345678',
            pagosAgregados: [{ tipo: 'EFECTIVO', importe: 1260 }]
        }, { username: 'emisor', perfil_id: 'EMISOR', planta_key: '160' });

        assert.equal(result.operacionId, 88);
        assert.equal(result.total, 1260);
        assert.equal(result.detalles[0].cantidad, 100);
        assert.equal(result.totalPagado, 1260);
        assert.equal(client.released, true);
        assert.ok(consultas.some(({ sql }) => sql === 'BEGIN'));
        assert.ok(consultas.some(({ sql }) => sql.includes('INSERT INTO fg_operacion_comercial')));
        const detalle = consultas.find(({ sql }) => sql.includes('INSERT INTO fg_operacion_detalle ('));
        assert.equal(detalle.values[2], 100);
        const pago = consultas.find(({ sql }) => sql.includes('INSERT INTO fg_pago'));
        assert.equal(pago.values[4], 1260);
        assert.equal(salidasInventario.length, 1);
        assert.equal(salidasInventario[0].detalle.cantidad, 100);
        assert.ok(consultas.some(({ sql }) => sql === 'COMMIT'));

        consultas.length = 0;
        const credito = await ventaCanonicaService.crearVentaDirecta({
            productoInventariableId: 35,
            cantidad: 1,
            tipoComprobante: 'FACTURA',
            condicionPago: 'CREDITO',
            tipoDocumentoCliente: 'RUC',
            nroDocumento: '20000000001',
            nombreRazonSocial: 'Cliente de prueba aislada',
            telefono: '912345678',
            fechaInicioCredito: '2026-11-21',
            fechaVencimiento: '2027-03-19',
            cuotas: [{ numeroCuota: 1, fechaPago: '2027-03-19', importe: 12.60 }],
            pagosAgregados: []
        }, { username: 'emisor', perfil_id: 'EMISOR', planta_key: '160' });
        assert.equal(credito.estado, 'PENDIENTE_PAGO');
        const operacionCredito = consultas.find(({ sql }) => sql.includes('INSERT INTO fg_operacion_comercial'));
        const ordenCredito = consultas.find(({ sql }) => sql.includes('INSERT INTO fg_orden_pago'));
        assert.equal(operacionCredito.values[9], 'PENDIENTE_PAGO');
        assert.deepEqual(ordenCredito.values.slice(4, 10), [0, 12.6, 'credito', 'PENDIENTE', '2026-11-21', '2027-03-19']);
        assert.ok(!consultas.some(({ sql }) => sql.includes('INSERT INTO fg_pago')));
    } finally {
        db.connect = connectAnterior;
        authService.validarAccesoPlanta = accesoAnterior;
        clientesService.asegurarCliente = clienteAnterior;
        service.prepararVentaEnTransaccion = prepararAnterior;
        service.registrarSalidaVenta = salidaAnterior;
    }
});

test('el endpoint de venta exige permiso de ventas y no el submódulo de configuración', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/faregas-chips.routes.js'), 'utf8');
    assert.match(routes, /router\.get\('\/productos\/venta',\s*\.\.\.ventas\('CHIPS_VER'\),\s*controller\.listarProductosVendibles\)/);
    assert.match(routes, /router\.get\('\/productos',\s*permiso\('MENU_CHIPS_TIPOS', 'MENU_CHIPS_INVENTARIO'\)/);
    const catalogo = fs.readFileSync(path.join(__dirname, '../services/faregas-chips.service.js'), 'utf8');
    assert.match(catalogo, /visible\.stock_permitido = TRUE/);
    assert.match(catalogo, /visible\.venta_habilitada = TRUE/);
    assert.match(catalogo, /pi\.control_stock = TRUE/);
    assert.match(catalogo, /planta_venta\.empresa_key = 'FAREGAS'/);
    assert.match(catalogo, /soloVendibles \? \[String\(plantaKey\)\]/);
});

test('el selector vendible limita catálogo y stock a la sede activa', async () => {
    const queryAnterior = db.query;
    const validarAccesoAnterior = authService.validarAccesoPlanta;
    let sqlEjecutado = '';
    let parametros = [];
    try {
        authService.validarAccesoPlanta = async (_username, _perfilId, plantaKey) => ({ key: plantaKey, nombre: 'SURQUILLO' });
        db.query = async (sql, values) => {
            sqlEjecutado = sql;
            parametros = values;
            return { rows: [{
                id: '35', codigo: 'HOJA_GLP', nombre: 'Hojas GLP', tipo: 'CANTIDAD', control_stock: true, activo: true,
                codigo_autogenerable: false, producto_facturacion_id: '227', sedes: [{ plantaKey: '160', ventaHabilitada: true }],
                stock_total: '999', stock_sede: '150', disponibles_sede: '150', reservados_sede: '0', vendidos_sede: '20', bajas_sede: '0'
            }] };
        };
        const productos = await chipsService.listarProductosVendibles('160', { username: 'emisor', perfil_id: 'EMISOR' });
        assert.equal(productos.length, 1);
        assert.equal(productos[0].stockTotal, 150);
        assert.equal(productos[0].disponiblesSede, 150);
        assert.deepEqual(parametros, ['160', ['160']]);
        assert.match(sqlEjecutado, /visible\.stock_permitido = TRUE/);
        assert.match(sqlEjecutado, /visible\.venta_habilitada = TRUE/);
        assert.match(sqlEjecutado, /planta_venta\.empresa_key = 'FAREGAS'/);
    } finally {
        db.query = queryAnterior;
        authService.validarAccesoPlanta = validarAccesoAnterior;
    }
});

test('el histórico y el Dashboard siguen usando la operación y el detalle comercial canónicos', () => {
    const canonical = fs.readFileSync(path.join(__dirname, '../services/faregas-venta-directa-canonica.service.js'), 'utf8');
    const dashboard = fs.readFileSync(path.join(__dirname, '../services/faregas-dashboard.service.js'), 'utf8');
    assert.match(canonical, /INSERT INTO fg_operacion_comercial/);
    assert.match(canonical, /INSERT INTO fg_operacion_detalle/);
    assert.match(canonical, /registrarSalidaVenta/);
    assert.match(dashboard, /JOIN fg_operacion_detalle od ON od\.operacion_id = oc\.id AND od\.tipo_item = 'PRODUCTO'/);
});

test('venta de inventario a crédito valida y conserva la fecha de inicio hasta emitir', async () => {
    const { crearVentaDirectaYEmitir } = require('../services/faregas-venta-directa-fase2.service');
    const { evaluarDatosFacturacion } = require('../services/faregas-facturacion.service');
    const payload = {
        tipoComprobante: 'FACTURA', tipoDocumentoCliente: 'RUC',
        nroDocumento: '20000000001', nombreRazonSocial: 'Cliente sintético',
        direccion: 'Dirección sintética', condicionPago: 'CREDITO',
        fechaInicioCredito: '2026-11-21', fechaVencimiento: '2027-03-19',
        cuotas: [
            { numeroCuota: 1, fechaPago: '2026-12-30', importe: 60 },
            { numeroCuota: 2, fechaPago: '2027-02-07', importe: 60 },
            { numeroCuota: 3, fechaPago: '2027-03-19', importe: 60 }
        ],
        pagosAgregados: []
    };
    const llamadas = [];
    const deps = {
        ventaDirectaService: {
            async crearVentaDirecta(datos) {
                llamadas.push('venta');
                assert.equal(datos.fechaInicioCredito, payload.fechaInicioCredito);
                return { operacionId: 88 };
            }
        },
        db: { async query() {
            return { rowCount: 1, rows: [{
                estado: 'PENDIENTE_PAGO',
                tipo_documento_cliente_snapshot: payload.tipoDocumentoCliente,
                documento_cliente_snapshot: payload.nroDocumento,
                nombre_cliente_snapshot: payload.nombreRazonSocial,
                direccion_cliente_snapshot: payload.direccion
            }] };
        } },
        facturacionService: {
            evaluarDatosFacturacion,
            async guardarFacturacionOperacion(operacionId, datos) {
                llamadas.push('guardar');
                assert.equal(operacionId, 88);
                assert.equal(datos.fechaInicioCredito, payload.fechaInicioCredito);
                assert.deepEqual(evaluarDatosFacturacion(datos).errores, []);
                assert.deepEqual(datos.cuotas, payload.cuotas);
            },
            async emitirFacturacionOperacion() {
                llamadas.push('emitir');
                return { estado: 'ACEPTADO', nroComprobante: 'FL99-0001' };
            }
        }
    };
    await assert.rejects(crearVentaDirectaYEmitir({ ...payload, fechaInicioCredito: '' }, {}, deps), {
        code: 'DATOS_FACTURACION_INVALIDOS'
    });
    assert.deepEqual(llamadas, []);

    const resultado = await crearVentaDirectaYEmitir(payload, {}, deps);
    assert.equal(resultado.success, true);
    assert.equal(resultado.operacionEstado, 'FACTURADO');
    assert.deepEqual(llamadas, ['venta', 'guardar', 'emitir']);
});
