const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-chip-certificado.service');

const certificado = { id: 10, estado: 'BORRADOR', planta_key: '201', producto_chip_id: '1' };
const chip = {
    id: 20,
    numero_chip: 'SUPERNM123',
    estado: 'DISPONIBLE',
    planta_actual_key: '201',
    producto_inventariable_id: '1',
    producto_codigo: 'CHIP',
    producto_nombre: 'Chip y porta chip'
};

const clienteSeleccion = (chipEncontrado = chip, usada = false) => {
    const consultas = [];
    return {
        consultas,
        async query(sql) {
            consultas.push(sql);
            if (sql.includes('FROM fg_certificado_chip cc')) return { rowCount: 0, rows: [] };
            if (sql.includes('FROM fg_chip c') && sql.includes('c.numero_chip')) {
                return chipEncontrado ? { rowCount: 1, rows: [chipEncontrado] } : { rowCount: 0, rows: [] };
            }
            if (sql.includes('SELECT certificado_id FROM fg_certificado_chip')) {
                return usada ? { rowCount: 1, rows: [{ certificado_id: 99 }] } : { rowCount: 0, rows: [] };
            }
            return { rowCount: 1, rows: [] };
        }
    };
};

test('seleccionar vincula el serial pero no consume ni cambia el estado del chip', async () => {
    const client = clienteSeleccion();
    const resultado = await service._private.seleccionarDentroTransaccion(client, certificado, 'supernm123');

    assert.equal(resultado.numero_chip, 'SUPERNM123');
    assert.ok(client.consultas.some((sql) => sql.includes('INSERT INTO fg_certificado_chip')));
    assert.equal(client.consultas.some((sql) => sql.includes('UPDATE fg_chip')), false);
    assert.equal(client.consultas.some((sql) => sql.includes('fg_chip_movimiento')), false);
});

test('seleccionar rechaza serial inexistente, de otro tipo, sede o estado', async (t) => {
    const casos = [
        ['CHIP_NO_ENCONTRADO', null],
        ['CHIP_TIPO_INVALIDO', { ...chip, producto_inventariable_id: '2' }],
        ['CHIP_OTRA_SEDE', { ...chip, planta_actual_key: '202' }],
        ['CHIP_NO_DISPONIBLE', { ...chip, estado: 'RESERVADO' }],
        ['CHIP_NO_DISPONIBLE', { ...chip, estado: 'VENDIDO' }],
        ['CHIP_NO_DISPONIBLE', { ...chip, estado: 'BAJA' }]
    ];
    for (const [codigo, variante] of casos) {
        await t.test(codigo + String(variante?.estado || ''), async () => {
            await assert.rejects(
                service._private.seleccionarDentroTransaccion(clienteSeleccion(variante), certificado, 'SUPERNM123'),
                (error) => error.message === codigo
            );
        });
    }
});

test('seleccionar rechaza un serial ya asociado a otro certificado', async () => {
    await assert.rejects(
        service._private.seleccionarDentroTransaccion(clienteSeleccion(chip, true), certificado, 'SUPERNM123'),
        (error) => error.message === 'CHIP_ASIGNADO_OTRO_CERTIFICADO'
    );
});

test('reabrir el borrador recupera exactamente el serial seleccionado', async () => {
    const client = {
        async query(sql) {
            if (sql.includes('FROM fg_certificado\n')) return { rowCount: 1, rows: [certificado] };
            if (sql.includes('FROM fg_certificado_chip cc')) return { rowCount: 1, rows: [chip] };
            return { rowCount: 0, rows: [] };
        }
    };
    const resultado = await service.obtener(client, certificado.id);

    assert.equal(resultado.seleccionado, true);
    assert.equal(resultado.chip.numeroChip, 'SUPERNM123');
    assert.equal(resultado.chip.estado, 'DISPONIBLE');
});

test('facturación consume una sola vez y registra movimiento trazable', async () => {
    const consultas = [];
    const client = {
        async query(sql) {
            consultas.push(sql);
            if (sql.includes('FROM fg_certificado\n')) return { rowCount: 1, rows: [certificado] };
            if (sql.includes('FROM fg_certificado_chip cc')) return { rowCount: 1, rows: [chip] };
            if (sql.includes('UPDATE fg_chip')) return { rowCount: 1, rows: [{ id: chip.id }] };
            return { rowCount: 1, rows: [] };
        }
    };

    const resultado = await service.consumirEnFacturacion(client, {
        certificadoId: certificado.id,
        operacionId: 30,
        username: 'TEST'
    });
    assert.equal(resultado.chip.estado, 'VENDIDO');
    assert.equal(consultas.filter((sql) => sql.includes('UPDATE fg_chip')).length, 1);
    assert.equal(consultas.filter((sql) => sql.includes('INSERT INTO fg_chip_movimiento')).length, 1);
});

test('reintentar facturación de un chip ya vendido es idempotente', async () => {
    const vendido = { ...chip, estado: 'VENDIDO' };
    const consultas = [];
    const client = {
        async query(sql) {
            consultas.push(sql);
            if (sql.includes('FROM fg_certificado\n')) return { rowCount: 1, rows: [certificado] };
            if (sql.includes('FROM fg_certificado_chip cc')) return { rowCount: 1, rows: [vendido] };
            if (sql.includes('SELECT 1 FROM fg_chip_movimiento')) return { rowCount: 1, rows: [{ '?column?': 1 }] };
            return { rowCount: 0, rows: [] };
        }
    };

    const resultado = await service.consumirEnFacturacion(client, {
        certificadoId: certificado.id,
        operacionId: 30,
        username: 'TEST'
    });
    assert.equal(resultado.chip.estado, 'VENDIDO');
    assert.equal(consultas.some((sql) => sql.includes('UPDATE fg_chip')), false);
    assert.equal(consultas.some((sql) => sql.includes('INSERT INTO fg_chip_movimiento')), false);
});

test('el UPDATE condicional evita que dos facturaciones consuman el mismo serial', async () => {
    const client = {
        async query(sql) {
            if (sql.includes('FROM fg_certificado\n')) return { rowCount: 1, rows: [certificado] };
            if (sql.includes('FROM fg_certificado_chip cc')) return { rowCount: 1, rows: [chip] };
            if (sql.includes('UPDATE fg_chip')) return { rowCount: 0, rows: [] };
            return { rowCount: 0, rows: [] };
        }
    };

    await assert.rejects(
        service.consumirEnFacturacion(client, { certificadoId: 10, operacionId: 30, username: 'TEST' }),
        (error) => error.message === 'CHIP_NO_DISPONIBLE'
    );
});
