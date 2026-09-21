const test = require('node:test');
const assert = require('node:assert/strict');
const vehiculosService = require('../services/faregas-vehiculos.service');
const clientesService = require('../services/faregas-clientes.service');
const db = require('../../../config/database');

test('CASO A: Prioriza CONFORMIDAD EMITIDA antigua frente a GLP_ANUAL y borrador reciente', async () => {
    // 10: CONFORMIDAD EMITIDO antigua (completa) -> DEBE GANAR
    // 11: GLP_ANUAL mas reciente -> DEBE IGNORARSE POR TIPO
    // 12: CONFORMIDAD actual -> DEBE EXCLUIRSE
    // El query deberia retornar 10 si mockeamos la base de datos de esta forma.
    
    const mockDb = {
        query: async (sql, params) => {
            return { rowCount: 1, rows: [{ id: 10 }] };
        }
    };
    const id = await vehiculosService.buscarCertificadoCompatiblePorPlaca('ABC123', 'CONFORMIDAD', 12, mockDb);
    assert.equal(id, 10);
});

test('CASO B: Usa CONFORMIDAD borrador anterior solo si es completa y no hay emitida', async () => {
    // 20: CONFORMIDAD borrador anterior completa
    // 21: CONFORMIDAD borrador mas reciente incompleta
    // El sql debe contener las reglas AND NULLIF(BTRIM(tipo_conformidad), '') IS NOT NULL
    const consultas = [];
    const mockDb = {
        query: async (sql, params) => {
            consultas.push(sql);
            return { rowCount: 1, rows: [{ id: 20 }] };
        }
    };
    const id = await vehiculosService.buscarCertificadoCompatiblePorPlaca('ABC123', 'CONFORMIDAD', 99, mockDb);
    assert.equal(id, 20);
    assert.match(consultas[0], /NULLIF\(BTRIM\(tipo_conformidad\), ''\) IS NOT NULL/);
    assert.match(consultas[0], /NULLIF\(BTRIM\(tipo_tramite\), ''\) IS NOT NULL/);
});

test('CASO C: Retorna null si solo existen otros tipos', async () => {
    const mockDb = {
        query: async (sql, params) => {
            // Simulamos que el query no retorna nada (porque el WHERE tipo_certificado_clave = 'CONFORMIDAD' filtra GLP/GNV)
            return { rowCount: 0, rows: [] };
        }
    };
    const id = await vehiculosService.buscarCertificadoCompatiblePorPlaca('ABC123', 'CONFORMIDAD', 99, mockDb);
    assert.equal(id, null);
});

test('CASO D: Excluye exactamente el certificado actual y devuelve null si no hay otro', async () => {
    const consultas = [];
    const mockDb = {
        query: async (sql, params) => {
            consultas.push({ sql, params });
            return { rowCount: 0, rows: [] };
        }
    };
    const id = await vehiculosService.buscarCertificadoCompatiblePorPlaca('ABC123', 'CONFORMIDAD', 50, mockDb);
    assert.equal(id, null);
    // Verificamos que el id excluido se pasa correctamente
    assert.equal(consultas[0].params[2], 50);
});

test('CASO E: Prioriza mayor fecha_emision si hay multiples emitidos', async () => {
    const consultas = [];
    const mockDb = {
        query: async (sql, params) => {
            consultas.push(sql);
            return { rowCount: 1, rows: [{ id: 1 }] };
        }
    };
    await vehiculosService.buscarCertificadoCompatiblePorPlaca('ABC123', 'CONFORMIDAD', 99, mockDb);
    // Verificar que el ORDER BY sea correcto
    assert.match(consultas[0], /CASE WHEN c\.estado = 'EMITIDO' THEN c\.fecha_emision END DESC NULLS LAST/);
});
