const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-chip-certificado.service');

const crearCliente = ({ asociaciones = [], operacion = null, chip = null } = {}) => {
    const llamadas = [];
    return {
        llamadas,
        async query(sql, params = []) {
            const texto = String(sql).replace(/\s+/g, ' ').trim();
            llamadas.push({ texto, params });
            if (texto.includes('FROM fg_certificado_chip cc')) {
                return { rowCount: asociaciones.length, rows: asociaciones };
            }
            if (texto.includes('FROM fg_producto_inventariable pi')) {
                return { rowCount: 1, rows: [{ stock_permitido: true }] };
            }
            if (texto.includes('FROM fg_orden_pago op')) {
                return { rowCount: operacion ? 1 : 0, rows: operacion ? [operacion] : [] };
            }
            if (texto.includes('FROM fg_chip') && texto.includes('WHERE numero_chip = $1')) {
                return { rowCount: chip ? 1 : 0, rows: chip ? [chip] : [] };
            }
            return { rowCount: 1, rows: [] };
        }
    };
};

const base = {
    certificadoId: 71,
    plantaKey: '201',
    modalidad: 'INICIAL',
    numeroChip: 'chip001',
    username: 'ramirez'
};

test('reserva un chip disponible usando la operación ya creada por el pago', async () => {
    const client = crearCliente({
        operacion: { id: 90, planta_key: '201', estado: 'PAGADO' },
        chip: { id: 12, numero_chip: 'CHIP001', estado: 'DISPONIBLE', planta_actual_key: '201', operacion_reserva_id: null }
    });

    const resultado = await service.sincronizarReserva(client, base);

    assert.deepEqual(resultado, { id: 12, numeroChip: 'CHIP001', estado: 'RESERVADO' });
    assert.equal(client.llamadas.some(({ texto }) => texto.startsWith('INSERT INTO fg_certificado_chip')), true);
    assert.equal(client.llamadas.some(({ texto }) => texto.includes("VALUES ($1, 'RESERVA'")), true);
});

test('repetir el guardado mantiene la reserva sin duplicar movimientos', async () => {
    const client = crearCliente({
        asociaciones: [{ id: 12, numero_chip: 'CHIP001', estado: 'RESERVADO', planta_actual_key: '201', operacion_reserva_id: 90 }],
        operacion: { id: 90, planta_key: '201', estado: 'PAGADO' }
    });

    const resultado = await service.sincronizarReserva(client, base);

    assert.equal(resultado.estado, 'RESERVADO');
    assert.equal(client.llamadas.some(({ texto }) => texto.startsWith('INSERT INTO fg_chip_movimiento')), false);
});

test('cambiar a modalidad anual libera la reserva vinculada', async () => {
    const client = crearCliente({
        asociaciones: [{ id: 12, numero_chip: 'CHIP001', estado: 'RESERVADO', planta_actual_key: '201', operacion_reserva_id: 90 }]
    });

    const resultado = await service.sincronizarReserva(client, { ...base, modalidad: 'ANUAL', numeroChip: null });

    assert.equal(resultado, null);
    assert.equal(client.llamadas.some(({ texto }) => texto.startsWith('DELETE FROM fg_certificado_chip')), true);
    assert.equal(client.llamadas.some(({ texto }) => texto.includes("VALUES ($1, 'LIBERACION'")), true);
});

test('rechaza un chip que pertenece a otra sede', async () => {
    const client = crearCliente({
        operacion: { id: 90, planta_key: '201', estado: 'PAGADO' },
        chip: { id: 12, numero_chip: 'CHIP001', estado: 'DISPONIBLE', planta_actual_key: '190', operacion_reserva_id: null }
    });

    await assert.rejects(
        service.sincronizarReserva(client, base),
        error => error.message === 'CHIP_OTRA_SEDE'
    );
});
