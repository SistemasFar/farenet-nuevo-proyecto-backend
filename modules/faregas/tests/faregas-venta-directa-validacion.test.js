const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const servicio = require('../services/faregas-venta-directa-validacion.service');

const usuario = {
    username: 'USUARIO_PRUEBA',
    perfil_id: 'SISTEMAS',
    planta_key: '201'
};

const configuracionValida = {
    producto_activo: true,
    sede_activa: true,
    precio: '180.00',
    stock_permitido: true,
    venta_habilitada: true,
    producto_facturacion_id: 25,
    codigo_sku: 'CHIP + PORTA CHIP - SURCO',
    descripcion: 'CHIP + PORTA CHIP',
    unidad: 'NIU',
    tipo_afectacion_igv: '10',
    codigo_clasificacion_sunat: null,
    fiscal_activo: true,
    es_para_venta: true
};

const crearChip = (numeroChip = 'CHIP9', overrides = {}, config = {}) => ({
    id: 1,
    numero_chip: numeroChip,
    estado: 'DISPONIBLE',
    planta_actual_key: '201',
    planta_nombre: 'INDEPENDENCIA',
    producto_inventariable_id: 1,
    producto_codigo: 'CHIP',
    producto_nombre: 'Chip y porta chip',
    ...configuracionValida,
    ...config,
    ...overrides
});

class ConsultaSoloLectura {
    constructor(chips = []) {
        this.chips = chips;
        this.consultas = [];
    }

    async query(sql, valores = []) {
        const consulta = String(sql).replace(/\s+/g, ' ').trim();
        this.consultas.push({ sql: consulta, valores });

        if (!/^SELECT\s/i.test(consulta)) {
            throw new Error(`Consulta no permitida: ${consulta}`);
        }
        if (consulta.includes('FOR UPDATE')) {
            throw new Error('La validación no puede usar FOR UPDATE');
        }
        if (!consulta.includes('FROM fg_chip c')) {
            throw new Error(`Consulta no simulada: ${consulta}`);
        }

        const solicitados = valores[0] || [];
        const rows = solicitados
            .map((numeroChip) => this.chips.find((chip) => chip.numero_chip === numeroChip))
            .filter(Boolean)
            .map((chip) => ({ ...chip }));
        return { rowCount: rows.length, rows };
    }
}

const connectOriginal = db.connect;
const accesoOriginal = authService.validarAccesoPlanta;
let intentosDeConexion = 0;

test.beforeEach(() => {
    intentosDeConexion = 0;
    db.connect = async () => {
        intentosDeConexion += 1;
        throw new Error('La validación no debe abrir una conexión transaccional');
    };
    authService.validarAccesoPlanta = async () => ({ key: '201', nombre: 'INDEPENDENCIA' });
});

test.afterEach(() => {
    db.connect = connectOriginal;
    authService.validarAccesoPlanta = accesoOriginal;
});

const validar = (chips, queryable, body = {}) => servicio.validarVentaDirecta(
    { chips, ...body },
    usuario,
    queryable
);

test('un chip disponible de la misma sede es válido y usa el precio configurado', async () => {
    const queryable = new ConsultaSoloLectura([crearChip()]);
    const result = await validar(['CHIP9'], queryable, { precioUnitario: 9999 });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].numeroChip, 'CHIP9');
    assert.equal(result.items[0].existe, true);
    assert.equal(result.items[0].estado, 'DISPONIBLE');
    assert.equal(result.items[0].plantaKey, '201');
    assert.equal(result.items[0].productoNombre, 'Chip y porta chip');
    assert.equal(result.items[0].precio, 180);
    assert.equal(result.items[0].ventaHabilitada, true);
    assert.equal(result.items[0].validoParaVenta, true);
    assert.equal(result.items[0].motivo, null);
    assert.equal(result.totalEstimado, 180);
    assert.deepEqual(queryable.consultas[0].valores, [['CHIP9'], '201']);
});

test('un chip reservado o vendido se informa por estado y no suma al total', async () => {
    for (const [estado, codigo, motivo] of [
        ['RESERVADO', 'CHIP_RESERVADO', 'Reservado'],
        ['VENDIDO', 'CHIP_VENDIDO', 'Vendido']
    ]) {
        const result = await validar(
            ['CHIP9'],
            new ConsultaSoloLectura([crearChip('CHIP9', { estado })])
        );
        const [item] = result.items;

        assert.equal(item.estado, estado);
        assert.equal(item.codigo, codigo);
        assert.equal(item.motivo, motivo);
        assert.equal(item.validoParaVenta, false);
        assert.equal(result.totalEstimado, 0);
    }
});

test('un chip de otra sede se informa sin contarlo como válido', async () => {
    const result = await validar(
        ['CHIP9'],
        new ConsultaSoloLectura([crearChip('CHIP9', {
            planta_actual_key: '190',
            planta_nombre: 'MIRAFLORES'
        })])
    );
    const [item] = result.items;

    assert.equal(item.codigo, 'CHIP_OTRA_SEDE');
    assert.equal(item.motivo, 'El chip pertenece a otra sede');
    assert.equal(item.validoParaVenta, false);
    assert.equal(result.totalEstimado, 0);
});

test('un chip inexistente se informa como no encontrado sin ejecutar escrituras', async () => {
    const queryable = new ConsultaSoloLectura([]);
    const result = await validar(['NOEXISTE'], queryable);
    const [item] = result.items;

    assert.equal(item.existe, false);
    assert.equal(item.codigo, 'CHIP_NO_ENCONTRADO');
    assert.equal(item.motivo, 'No encontrado');
    assert.equal(item.validoParaVenta, false);
    assert.equal(result.totalEstimado, 0);
    assert.equal(intentosDeConexion, 0);
});

test('una venta no habilitada para la sede invalida el chip', async () => {
    const result = await validar(
        ['CHIP9'],
        new ConsultaSoloLectura([crearChip('CHIP9', { venta_habilitada: false })])
    );
    const [item] = result.items;

    assert.equal(item.ventaHabilitada, false);
    assert.equal(item.codigo, 'VENTA_CHIP_NO_HABILITADA');
    assert.equal(item.motivo, 'Venta no habilitada para INDEPENDENCIA');
    assert.equal(item.validoParaVenta, false);
    assert.equal(result.totalEstimado, 0);
});

test('un producto sin precio válido para la sede invalida el chip', async () => {
    for (const precio of [null, '0', '-5', 'NO_NUMERO']) {
        const result = await validar(
            ['CHIP9'],
            new ConsultaSoloLectura([crearChip('CHIP9', { precio })])
        );
        const [item] = result.items;

        assert.equal(item.precioConfigurado, false);
        assert.equal(item.precio, null);
        assert.equal(item.codigo, 'PRECIO_PRODUCTO_INVALIDO');
        assert.equal(item.motivo, 'Precio no configurado para esta sede');
        assert.equal(item.validoParaVenta, false);
        assert.equal(result.totalEstimado, 0);
    }
});

test('varios chips se devuelven en el orden solicitado y conservan sus resultados', async () => {
    const result = await validar(
        ['CHIP9', 'SUPERCHIPM', 'CHIPVENDIDO'],
        new ConsultaSoloLectura([
            crearChip('CHIP9'),
            crearChip('SUPERCHIPM', {}, { precio: '50.50' }),
            crearChip('CHIPVENDIDO', { estado: 'VENDIDO' })
        ])
    );

    assert.deepEqual(result.items.map((item) => item.numeroChip), ['CHIP9', 'SUPERCHIPM', 'CHIPVENDIDO']);
    assert.deepEqual(result.items.map((item) => item.validoParaVenta), [true, true, false]);
    assert.equal(result.cantidadSolicitados, 3);
    assert.equal(result.cantidadValidos, 2);
    assert.equal(result.totalEstimado, 230.5);
});

test('chips de productos distintos se valorizan con el precio de cada producto', async () => {
    const result = await validar(
        ['CHIP9', 'SUPERCHIPM'],
        new ConsultaSoloLectura([
            crearChip('CHIP9'),
            crearChip('SUPERCHIPM', {
                producto_inventariable_id: 2,
                producto_codigo: 'SUPERCHIP',
                producto_nombre: 'Superchip'
            }, {
                producto_activo: true,
                sede_activa: true,
                precio: '75.25',
                stock_permitido: true,
                venta_habilitada: true,
                producto_facturacion_id: 26,
                codigo_sku: 'SUPERCHIP',
                descripcion: 'SUPERCHIP',
                unidad: 'NIU',
                tipo_afectacion_igv: '10',
                codigo_clasificacion_sunat: null,
                fiscal_activo: true,
                es_para_venta: true
            })
        ])
    );

    assert.equal(result.items[0].precio, 180);
    assert.equal(result.items[1].precio, 75.25);
    assert.equal(result.totalEstimado, 255.25);
});

test('un duplicado en el request se rechaza antes de consultar la base de datos', async () => {
    const queryable = new ConsultaSoloLectura([crearChip()]);

    await assert.rejects(
        validar(['CHIP9', 'chip9'], queryable),
        /CHIP_DUPLICADO/
    );
    assert.equal(queryable.consultas.length, 0);
    assert.equal(intentosDeConexion, 0);
});

test('la validación es estrictamente read-only y no depende de venta, pago, facturación ni emisión', async () => {
    const queryable = new ConsultaSoloLectura([crearChip()]);
    await validar(['CHIP9'], queryable);

    const sql = queryable.consultas.map((consulta) => consulta.sql).join('\n').toUpperCase();
    const prohibidos = [
        /\bUPDATE\s+FG_CHIP\b/,
        /\bINSERT\s+INTO\b/,
        /\bDELETE\s+FROM\b/,
        /\bBEGIN\b/,
        /\bCOMMIT\b/,
        /\bROLLBACK\b/,
        /\bFOR UPDATE\b/,
        /\bFG_OPERACION_COMERCIAL\b/,
        /\bFG_OPERACION_DETALLE\b/,
        /\bFG_OPERACION_DETALLE_CHIP\b/,
        /\bFG_ORDEN_PAGO\b/,
        /\bFG_PAGO\b/,
        /\bFG_FACTURACION\b/,
        /\bFG_FACTURACION_INTENTO\b/,
        /\bFG_SERIE_COMPROBANTE\b/,
        /\bFG_CHIP_MOVIMIENTO\b/
    ];
    for (const patron of prohibidos) assert.doesNotMatch(sql, patron);
    assert.equal(intentosDeConexion, 0);

    const fuente = readFileSync(
        require.resolve('../services/faregas-venta-directa-validacion.service'),
        'utf8'
    );
    assert.doesNotMatch(fuente, /nubefact/i);
    assert.doesNotMatch(fuente, /faregas-venta-directa-(?:canonica|fase2)\.service/);
    assert.doesNotMatch(fuente, /faregas-facturacion\.service/);
});

test('la planta se toma exclusivamente del usuario autenticado', async () => {
    const queryable = new ConsultaSoloLectura([crearChip()]);
    const result = await validar(['CHIP9'], queryable, { plantaKey: '999' });
    const [item] = result.items;

    assert.equal(item.plantaKey, '201');
    assert.deepEqual(queryable.consultas[0].valores, [['CHIP9'], '201']);
    assert.equal(result.items[0].validoParaVenta, true);
});
