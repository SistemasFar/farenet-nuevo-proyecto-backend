const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const service = require('../services/faregas-chips.service');

test('editar un tipo sin selector conserva el mapping fiscal global y por sede', async () => {
    const connectOriginal = db.connect;
    const consultas = [];
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            consultas.push({ text, params });
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rowCount: 0, rows: [] };
            if (text.includes('SELECT codigo FROM fg_producto_inventariable')) {
                return { rowCount: 1, rows: [{ codigo: 'CHIP' }] };
            }
            if (text.includes('SELECT key FROM fg_planta')) {
                return { rowCount: 1, rows: [{ key: '201' }] };
            }
            if (text.includes('FROM fg_producto_facturacion')) {
                return { rowCount: 1, rows: [{ id: 25 }] };
            }
            return { rowCount: 1, rows: [{ id: 1 }] };
        },
        release() {}
    };

    try {
        db.connect = async () => client;
        await service.editarProductoInventariable(1, {
            nombre: 'Chip y porta chip',
            tipo: 'CHIP_SERIALIZADO',
            sedes: [{
                plantaKey: '201',
                precio: 181,
                stockPermitido: true,
                ventaHabilitada: true,
                productoFacturacionId: 25
            }]
        }, { username: 'USUARIO_CHIP' });

        const actualizacionProducto = consultas.find((item) => item.text.startsWith('UPDATE fg_producto_inventariable SET'));
        const actualizacionSede = consultas.find((item) => item.text.includes('INSERT INTO fg_producto_inventariable_sede'));

        assert.ok(actualizacionProducto);
        assert.doesNotMatch(actualizacionProducto.text, /producto_facturacion_id/);
        assert.deepEqual(actualizacionProducto.params, ['Chip y porta chip', 'CHIP_SERIALIZADO', 1]);
        assert.ok(actualizacionSede);
        assert.equal(actualizacionSede.params[5], 25);
    } finally {
        db.connect = connectOriginal;
    }
});

test('crear un tipo físico no recibe ni selecciona producto fiscal', async () => {
    const connectOriginal = db.connect;
    const consultas = [];
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            consultas.push({ text, params });
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rowCount: 0, rows: [] };
            if (text.includes('INSERT INTO fg_producto_inventariable ')) {
                return { rowCount: 1, rows: [{ id: 77, codigo: 'EXOCHIP', nombre: 'EXOCHIP', tipo: 'CHIP_SERIALIZADO' }] };
            }
            return { rowCount: 0, rows: [] };
        },
        release() {}
    };

    try {
        db.connect = async () => client;
        await service.crearProductoInventariable({
            codigo: 'EXOCHIP',
            nombre: 'EXOCHIP',
            tipo: 'CHIP_SERIALIZADO',
            sedes: []
        }, { username: 'USUARIO_CHIP' });

        const insercion = consultas.find((item) => item.text.includes('INSERT INTO fg_producto_inventariable '));
        assert.ok(insercion);
        assert.equal(insercion.params[3], null);
        assert.equal(consultas.some((item) => item.text.includes('fg_producto_facturacion')), false);
    } finally {
        db.connect = connectOriginal;
    }
});
