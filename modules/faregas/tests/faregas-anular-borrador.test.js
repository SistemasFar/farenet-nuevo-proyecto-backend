const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const service = require('../services/faregas-certificados.service');

test('anularBorrador - pasos permitidos y prohibidos', async (t) => {
    // Override db.connect to mock the client
    const originalConnect = db.connect;
    
    let mockEstado = 'BORRADOR';
    let mockPasoActual = 'DATOS_INICIALES';
    let mockNumero = null;
    let updateExecuted = false;

    db.connect = async () => {
        return {
            query: async (text, params) => {
                if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return;
                if (text.includes('SELECT estado, planta_key')) {
                    return { rowCount: 1, rows: [{ estado: mockEstado, planta_key: 'TEST', paso_actual: mockPasoActual, numero_certificado: mockNumero }] };
                }
                if (text.includes('fg_facturacion')) {
                    return { rowCount: 0 };
                }
                if (text.includes('UPDATE fg_certificado SET estado')) {
                    updateExecuted = true;
                    return;
                }
                if (text.includes('correlativo')) {
                    throw new Error('NO_DEBE_ACTUALIZAR_CORRELATIVO');
                }
                // default
                return { rowCount: 1, rows: [{}] };
            },
            release: () => {}
        };
    };

    // Test permitidos
    const permitidos = ['DATOS_INICIALES', 'PAGO', 'VEHICULO', 'PREVISUALIZACION'];
    for (const paso of permitidos) {
        mockPasoActual = paso;
        updateExecuted = false;
        await assert.doesNotReject(async () => {
            await service.anularBorrador(1, { username: 'test', perfil_id: 1 });
        }, `Debe permitir en ${paso}`);
        assert.equal(updateExecuted, true, `Debe hacer UPDATE en ${paso}`);
    }

    // Test prohibidos
    const prohibidos = ['FACTURACION', 'VERIFICACION_EMISION', 'EMITIDO'];
    for (const paso of prohibidos) {
        mockPasoActual = paso;
        updateExecuted = false;
        await assert.rejects(async () => {
            await service.anularBorrador(1, { username: 'test', perfil_id: 1 });
        }, /NO_ANULABLE_EN_ESTE_PASO/, `Debe rechazar en ${paso}`);
    }
    
    // Test Previsualizacion con numero
    mockPasoActual = 'PREVISUALIZACION';
    mockNumero = 'CERT-001';
    updateExecuted = false;
    await assert.doesNotReject(async () => {
        await service.anularBorrador(1, { username: 'test', perfil_id: 1 });
    }, 'Debe permitir anular en PREVISUALIZACION con numero (sin modificar correlativo)');
    assert.equal(updateExecuted, true);

    // Restore
    db.connect = originalConnect;
});
