const test = require('node:test');
const assert = require('node:assert/strict');
const chipService = require('../services/faregas-chip-certificado.service');

test('chip-certificado: validaciones de consumo en facturacion', async (t) => {
    // Mocking the pg client
    let queries = [];
    const createMockClient = (options = {}) => ({
        query: async (text, params) => {
            queries.push({ text: text.trim().replace(/\s+/g, ' '), params });
            
            // Mock obtenerAsociacion
            if (text.includes('FROM fg_certificado_chip cc')) {
                if (options.noChipAsociado) return { rowCount: 0, rows: [] };
                return { 
                    rowCount: 1, 
                    rows: [{ 
                        id: 500, 
                        numero_chip: 'CHIP333', 
                        estado: options.chipEstado || 'DISPONIBLE', 
                        planta_actual_key: options.sedeDistinta ? '999' : '201', 
                        producto_inventariable_id: options.productoDistinto ? 99 : 10,
                        producto_codigo: 'CH-1',
                        producto_nombre: 'CHIP'
                    }] 
                };
            }
            
            // Mock obtenerCertificado
            if (text.includes('FROM fg_certificado') && !text.includes('fg_certificado_chip')) {
                return { rowCount: 1, rows: [{ id: 100, estado: 'BORRADOR', planta_key: '201', producto_chip_id: 10 }] };
            }
            
            // Mock trazabilidad de VENDIDO
            if (text.includes('SELECT 1 FROM fg_chip_movimiento')) {
                if (options.sinTrazabilidad) return { rowCount: 0, rows: [] };
                return { rowCount: 1, rows: [{}] };
            }
            
            // Mock UPDATE
            if (text.includes('UPDATE fg_chip')) {
                if (options.failUpdate) return { rowCount: 0, rows: [] };
                return { rowCount: 1, rows: [{ id: 500 }] };
            }
            
            // Mock INSERT fg_chip_movimiento
            if (text.includes('INSERT INTO fg_chip_movimiento')) {
                return { rowCount: 1, rows: [] };
            }
            
            return { rowCount: 0, rows: [] };
        }
    });

    t.beforeEach(() => {
        queries = [];
    });

    await t.test('1. Chip RESERVADO del mismo certificado pasa a VENDIDO', async () => {
        const client = createMockClient({ chipEstado: 'RESERVADO' });
        const result = await chipService.consumirEnFacturacion(client, { certificadoId: 100, operacionId: 999, username: 'test' });
        
        assert.ok(result);
        assert.equal(result.chip.estado, 'VENDIDO');
        
        // Verificar que se hizo UPDATE
        const updateQ = queries.find(q => q.text.startsWith('UPDATE fg_chip'));
        assert.ok(updateQ);
        assert.ok(updateQ.text.includes("estado IN ('DISPONIBLE', 'RESERVADO')"));
    });

    await t.test('2. Se registra exactamente un movimiento VENTA', async () => {
        const client = createMockClient({ chipEstado: 'RESERVADO' });
        await chipService.consumirEnFacturacion(client, { certificadoId: 100, operacionId: 999, username: 'test' });
        
        const insertQ = queries.filter(q => q.text.startsWith('INSERT INTO fg_chip_movimiento'));
        assert.equal(insertQ.length, 1);
        assert.ok(insertQ[0].text.includes("'VENTA'"));
    });

    await t.test('3. Reintento idempotente con chip VENDIDO y movimiento del mismo certificado no duplica la venta', async () => {
        const client = createMockClient({ chipEstado: 'VENDIDO' });
        const result = await chipService.consumirEnFacturacion(client, { certificadoId: 100, operacionId: 999, username: 'test' });
        
        assert.equal(result.chip.estado, 'VENDIDO');
        
        // No debe haber UPDATE ni INSERT adicional
        const updateQ = queries.find(q => q.text.startsWith('UPDATE fg_chip'));
        const insertQ = queries.find(q => q.text.startsWith('INSERT INTO fg_chip_movimiento'));
        assert.ok(!updateQ);
        assert.ok(!insertQ);
    });

    await t.test('4. Chip VENDIDO pero de otro certificado (sin trazabilidad) es rechazado', async () => {
        const client = createMockClient({ chipEstado: 'VENDIDO', sinTrazabilidad: true });
        await assert.rejects(
            chipService.consumirEnFacturacion(client, { certificadoId: 100, operacionId: 999, username: 'test' }),
            /CHIP_VENDIDO_SIN_TRAZABILIDAD/
        );
    });

    await t.test('5. Chip con producto o sede diferente es rechazado', async () => {
        const clientProd = createMockClient({ chipEstado: 'RESERVADO', productoDistinto: true });
        await assert.rejects(
            chipService.consumirEnFacturacion(clientProd, { certificadoId: 100, operacionId: 999, username: 'test' }),
            /CHIP_TIPO_INVALIDO/
        );
        
        const clientSede = createMockClient({ chipEstado: 'RESERVADO', sedeDistinta: true });
        await assert.rejects(
            chipService.consumirEnFacturacion(clientSede, { certificadoId: 100, operacionId: 999, username: 'test' }),
            /CHIP_OTRA_SEDE/
        );
    });

    await t.test('6. Chip en otro estado diferente de DISPONIBLE o RESERVADO es rechazado', async () => {
        const client = createMockClient({ chipEstado: 'ROTO' });
        await assert.rejects(
            chipService.consumirEnFacturacion(client, { certificadoId: 100, operacionId: 999, username: 'test' }),
            /CHIP_NO_DISPONIBLE/
        );
    });
});
