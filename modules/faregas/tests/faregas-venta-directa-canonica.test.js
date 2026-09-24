const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const ventaDirectaService = require('../services/faregas-venta-directa-canonica.service');

const user = { username: 'USUARIO_PRUEBA', perfil_id: 'SISTEMAS', planta_key: '201' };
const configProducto = {
    id: 1,
    codigo: 'CHIP',
    nombre: 'Chip y porta chip',
    activo: true,
    precio: '10.00',
    sede_activa: true,
    stock_permitido: true,
    venta_habilitada: true,
    producto_facturacion_id: 25,
    codigo_sku: 'SKU-CHIP-REAL',
    descripcion: 'CHIP CONFIGURADO',
    unidad: 'NIU',
    tipo_afectacion_igv: '10',
    codigo_clasificacion_sunat: null,
    fiscal_activo: true,
    es_para_venta: true
};

const clonar = (valor) => {
    if (valor instanceof Map) {
        return new Map([...valor.entries()].map(([clave, item]) => [clave, clonar(item)]));
    }
    if (Array.isArray(valor)) return valor.map(clonar);
    if (valor && typeof valor === 'object') {
        return Object.fromEntries(Object.entries(valor).map(([clave, item]) => [clave, clonar(item)]));
    }
    return valor;
};

class ClienteSimulado {
    constructor(chips, config = configProducto) {
        this.state = {
            chips: chips.map((chip) => ({ ...chip })),
            configPorProducto: new Map([[config.id, { ...config }]]),
            operations: [],
            detalles: [],
            relaciones: [],
            ordenes: [],
            pagos: [],
            movimientos: []
        };
        this.queries = [];
        this.transacciones = [];
        this.siguienteOperacion = 100;
        this.siguienteDetalle = 200;
        this.siguienteOrden = 300;
        this.falloEn = null;
        this.before = null;
    }

    async query(sql, valores = []) {
        const texto = String(sql).replace(/\s+/g, ' ').trim();
        const mayusculas = texto.toUpperCase();
        this.queries.push(texto);

        if (mayusculas === 'BEGIN') {
            this.before = clonar(this.state);
            this.transacciones.push('BEGIN');
            return { rowCount: 0, rows: [] };
        }
        if (mayusculas === 'COMMIT') {
            this.transacciones.push('COMMIT');
            this.before = null;
            return { rowCount: 0, rows: [] };
        }
        if (mayusculas === 'ROLLBACK') {
            this.transacciones.push('ROLLBACK');
            if (this.before) this.state = this.before;
            this.before = null;
            return { rowCount: 0, rows: [] };
        }
        if (this.falloEn && mayusculas.includes(this.falloEn)) {
            throw new Error('FALLO_SIMULADO');
        }

        if (mayusculas.includes('FROM FG_CHIP') && mayusculas.includes('FOR UPDATE')) {
            const solicitadas = valores[0] || [];
            const rows = solicitadas
                .map((numero) => this.state.chips.find((chip) => chip.numero_chip === numero))
                .filter(Boolean)
                .map((chip) => ({ ...chip }));
            return { rowCount: rows.length, rows };
        }

        if (mayusculas.includes('FROM FG_PRODUCTO_INVENTARIABLE PI') && mayusculas.includes('FOR UPDATE OF PIS')) {
            const productoId = Number(valores[0]);
            const config = this.state.configPorProducto.get(productoId);
            return { rowCount: config ? 1 : 0, rows: config ? [{ ...config }] : [] };
        }

        if (mayusculas.includes('SELECT NOMBRE FROM TARJETA')) {
            return { rowCount: 1, rows: [{ nombre: 'VISA' }] };
        }
        if (mayusculas.includes('SELECT 1 FROM CUENTACORRIENTE')) {
            return { rowCount: 1, rows: [{ '?column?': 1 }] };
        }

        if (mayusculas.startsWith('INSERT INTO FG_OPERACION_COMERCIAL')) {
            const id = this.siguienteOperacion++;
            this.state.operations.push({ id, params: [...valores], estado: 'PAGADO' });
            return { rowCount: 1, rows: [{ id }] };
        }

        if (mayusculas.startsWith('INSERT INTO FG_OPERACION_DETALLE_CHIP')) {
            this.state.relaciones.push({ operacion_detalle_id: Number(valores[0]), chip_id: Number(valores[1]) });
            return { rowCount: 1, rows: [] };
        }

        if (mayusculas.startsWith('INSERT INTO FG_OPERACION_DETALLE')) {
            const id = this.siguienteDetalle++;
            this.state.detalles.push({ id, params: [...valores] });
            return { rowCount: 1, rows: [{ id }] };
        }

        if (mayusculas.startsWith('INSERT INTO FG_ORDEN_PAGO')) {
            const id = this.siguienteOrden++;
            this.state.ordenes.push({ id, params: [...valores], estado: 'PAGADO' });
            return { rowCount: 1, rows: [{ id }] };
        }

        if (mayusculas.startsWith('INSERT INTO FG_PAGO')) {
            this.state.pagos.push({ params: [...valores] });
            return { rowCount: 1, rows: [] };
        }

        if (mayusculas.startsWith('UPDATE FG_CHIP')) {
            const chip = this.state.chips.find((item) => item.id === Number(valores[0]));
            if (!chip || chip.estado !== 'DISPONIBLE' || chip.planta_actual_key !== valores[2]) {
                return { rowCount: 0, rows: [] };
            }
            chip.estado = 'VENDIDO';
            chip.actualizado_por = valores[1];
            return { rowCount: 1, rows: [] };
        }

        if (mayusculas.startsWith('INSERT INTO FG_CHIP_MOVIMIENTO')) {
            this.state.movimientos.push({ chip_id: Number(valores[0]), operacion_id: Number(valores[3]) });
            return { rowCount: 1, rows: [] };
        }

        throw new Error(`Consulta no simulada: ${texto}`);
    }

    release() {}
}

const crearCliente = (chips = [{ id: 1, numero_chip: 'CHIP-A', estado: 'DISPONIBLE', planta_actual_key: '201', producto_inventariable_id: 1 }], config = configProducto) => {
    const client = new ClienteSimulado(chips, config);
    db.connect = async () => client;
    authService.validarAccesoPlanta = async () => ({ key: '201', nombre: 'INDEPENDENCIA' });
    return client;
};

const payload = (overrides = {}) => ({
    tipoComprobante: 'BOLETA',
    tipoDocumentoCliente: 'DNI',
    nroDocumento: '12345678',
    nombreRazonSocial: 'CLIENTE PRUEBA',
    condicionPago: 'CONTADO',
    medioPago: 'EFECTIVO',
    pagosAgregados: [{ tipo: 'EFECTIVO', importe: '10.00' }],
    chips: ['CHIP-A'],
    ...overrides
});

const restaurar = (connectOriginal, accesoOriginal) => {
    db.connect = connectOriginal;
    authService.validarAccesoPlanta = accesoOriginal;
};

test.after(() => db.end());

test('venta directa canónica crea una operación, detalle, relación, orden y pago', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    const client = crearCliente();
    try {
        const result = await ventaDirectaService.crearVentaDirecta(payload({ precioUnitario: 9999 }), user);

        assert.equal(result.operacionId, 100);
        assert.equal(client.state.operations.length, 1);
        assert.equal(client.state.detalles.length, 1);
        assert.equal(client.state.relaciones.length, 1);
        assert.equal(client.state.ordenes.length, 1);
        assert.equal(client.state.pagos.length, 1);
        assert.equal(client.state.movimientos.length, 1);
        assert.equal(client.state.chips[0].estado, 'VENDIDO');
        assert.equal(client.state.operations[0].params[5], 8.47);
        assert.equal(client.state.operations[0].params[6], 1.53);
        assert.equal(client.state.operations[0].params[7], 10);
        assert.equal(client.state.operations[0].params[1], 'DNI');
        assert.equal(client.state.operations[0].params[2], '12345678');
        assert.equal(client.state.operations[0].params[3], 'CLIENTE PRUEBA');
        assert.deepEqual(client.transacciones, ['BEGIN', 'COMMIT']);
    } finally {
        restaurar(connectOriginal, accesoOriginal);
    }
});

test('dos chips del mismo producto se agrupan en una sola operación con un detalle físico por chip', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    const client = crearCliente([
        { id: 1, numero_chip: 'CHIP-A', estado: 'DISPONIBLE', planta_actual_key: '201', producto_inventariable_id: 1 },
        { id: 2, numero_chip: 'CHIP-B', estado: 'DISPONIBLE', planta_actual_key: '201', producto_inventariable_id: 1 }
    ]);
    try {
        const result = await ventaDirectaService.crearVentaDirecta(payload({
            chips: ['CHIP-A', 'CHIP-B'],
            pagosAgregados: [{ tipo: 'EFECTIVO', importe: '20.00' }]
        }), user);

        assert.equal(result.detalles.length, 2);
        assert.equal(client.state.operations.length, 1);
        assert.equal(client.state.detalles.length, 2);
        assert.equal(client.state.relaciones.length, 2);
        assert.equal(client.state.ordenes.length, 1);
        assert.equal(client.state.pagos.length, 1);
        assert.equal(client.state.movimientos.length, 2);
        assert.deepEqual(client.state.chips.map((chip) => chip.estado), ['VENDIDO', 'VENDIDO']);
    } finally {
        restaurar(connectOriginal, accesoOriginal);
    }
});

test('registra todos los pagos múltiples soportados por el modelo canónico', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    const client = crearCliente();
    try {
        await ventaDirectaService.crearVentaDirecta(payload({
            pagosAgregados: [
                { tipo: 'TARJETA', importe: '4.00', tarjetaKey: '1', nroOperacion: 'OP-001', digitosTarjeta: '1234' },
                { tipo: 'TARJETA', importe: '6.00', tarjetaKey: '1', nroOperacion: 'OP-002', digitosTarjeta: '1234' }
            ]
        }), user);

        assert.equal(client.state.pagos.length, 2);
        assert.deepEqual(client.state.pagos.map((pago) => pago.params[4]), [4, 6]);
    } finally {
        restaurar(connectOriginal, accesoOriginal);
    }
});

test('rechaza pago incompleto, sobrepago, chip reservado, chip vendido y chip de otra sede', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    try {
        for (const caso of [
            { chips: [{ id: 1, numero_chip: 'CHIP-A', estado: 'DISPONIBLE', planta_actual_key: '201', producto_inventariable_id: 1 }], body: { pagosAgregados: [{ tipo: 'EFECTIVO', importe: '9.99' }] }, error: 'PAGO_INCOMPLETO' },
            { chips: [{ id: 1, numero_chip: 'CHIP-A', estado: 'DISPONIBLE', planta_actual_key: '201', producto_inventariable_id: 1 }], body: { pagosAgregados: [{ tipo: 'EFECTIVO', importe: '10.01' }] }, error: 'PAGO_EXCEDE_TOTAL' },
            { chips: [{ id: 1, numero_chip: 'CHIP-A', estado: 'RESERVADO', planta_actual_key: '201', producto_inventariable_id: 1 }], body: {}, error: 'CHIP_NO_DISPONIBLE' },
            { chips: [{ id: 1, numero_chip: 'CHIP-A', estado: 'VENDIDO', planta_actual_key: '201', producto_inventariable_id: 1 }], body: {}, error: 'CHIP_NO_DISPONIBLE' },
            { chips: [{ id: 1, numero_chip: 'CHIP-A', estado: 'DISPONIBLE', planta_actual_key: '190', producto_inventariable_id: 1 }], body: {}, error: 'CHIP_OTRA_SEDE' }
        ]) {
            const client = crearCliente(caso.chips);
            await assert.rejects(
                ventaDirectaService.crearVentaDirecta(payload({ chips: [caso.chips[0].numero_chip], ...caso.body }), user),
                new RegExp(caso.error)
            );
            assert.equal(client.state.operations.length, 0);
            assert.equal(client.state.ordenes.length, 0);
        }
    } finally {
        restaurar(connectOriginal, accesoOriginal);
    }
});

test('rechaza códigos duplicados antes de iniciar la transacción', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    let conectado = false;
    db.connect = async () => { conectado = true; throw new Error('no debe conectar'); };
    authService.validarAccesoPlanta = async () => ({ key: '201', nombre: 'INDEPENDENCIA' });
    try {
        await assert.rejects(
            ventaDirectaService.crearVentaDirecta(payload({ chips: ['CHIP-A', 'CHIP-A'] }), user),
            /CHIP_DUPLICADO/
        );
        assert.equal(conectado, false);
    } finally {
        restaurar(connectOriginal, accesoOriginal);
    }
});

test('hace rollback de toda la operación si falla un movimiento después de actualizar chips', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    const client = crearCliente();
    client.falloEn = 'INSERT INTO FG_CHIP_MOVIMIENTO';
    try {
        await assert.rejects(ventaDirectaService.crearVentaDirecta(payload(), user), /FALLO_SIMULADO/);
        assert.equal(client.state.operations.length, 0);
        assert.equal(client.state.detalles.length, 0);
        assert.equal(client.state.relaciones.length, 0);
        assert.equal(client.state.ordenes.length, 0);
        assert.equal(client.state.pagos.length, 0);
        assert.equal(client.state.movimientos.length, 0);
        assert.equal(client.state.chips[0].estado, 'DISPONIBLE');
        assert.deepEqual(client.transacciones, ['BEGIN', 'ROLLBACK']);
    } finally {
        restaurar(connectOriginal, accesoOriginal);
    }
});

test('protege contra una segunda venta del mismo chip con lock y update condicionado', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    const client = crearCliente();
    try {
        await ventaDirectaService.crearVentaDirecta(payload(), user);
        await assert.rejects(
            ventaDirectaService.crearVentaDirecta(payload(), user),
            /CHIP_NO_DISPONIBLE/
        );
        assert.equal(client.state.operations.length, 1);
        assert.ok(client.queries.some((sql) => sql.includes('FOR UPDATE')));
        assert.ok(client.queries.some((sql) => sql.includes("estado = 'DISPONIBLE'") && sql.includes('planta_actual_key')));
    } finally {
        restaurar(connectOriginal, accesoOriginal);
    }
});

test('no crea facturación, series ni tablas legacy y no tiene ruta Nubefact', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    const client = crearCliente();
    try {
        await ventaDirectaService.crearVentaDirecta(payload(), user);
        const sql = client.queries.join('\n').toUpperCase();
        assert.equal(sql.includes('FG_FACTURACION'), false);
        assert.equal(sql.includes('FG_SERIE_COMPROBANTE'), false);
        assert.equal(sql.includes('FG_TALONARIO_SERIE'), false);
        assert.equal(sql.includes('FG_VENTA'), false);
        assert.equal(sql.includes('NUBEFACT'), false);
    } finally {
        restaurar(connectOriginal, accesoOriginal);
    }
});

test('exige stock permitido, venta habilitada y producto fiscal válido por sede', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    try {
        for (const [config, error] of [
            [{ ...configProducto, stock_permitido: false }, /STOCK_CHIP_NO_PERMITIDO/],
            [{ ...configProducto, venta_habilitada: false }, /VENTA_CHIP_NO_HABILITADA/],
            [{ ...configProducto, fiscal_activo: false }, /PRODUCTO_FISCAL_CHIP_INVALIDO/]
        ]) {
            const client = crearCliente(undefined, config);
            await assert.rejects(ventaDirectaService.crearVentaDirecta(payload(), user), error);
            assert.equal(client.state.operations.length, 0);
        }
    } finally {
        restaurar(connectOriginal, accesoOriginal);
    }
});

test('rechaza crédito en esta fase sin crear registros parciales', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    const client = crearCliente();
    try {
        await assert.rejects(
            ventaDirectaService.crearVentaDirecta(payload({ condicionPago: 'CREDITO' }), user),
            /CONDICION_PAGO_NO_DISPONIBLE/
        );
        assert.equal(client.state.operations.length, 0);
        assert.deepEqual(client.transacciones, []);
    } finally {
        restaurar(connectOriginal, accesoOriginal);
    }
});
