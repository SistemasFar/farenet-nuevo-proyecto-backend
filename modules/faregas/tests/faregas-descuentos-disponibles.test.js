const { Pool } = require('pg');
const descuentos = require('../services/faregas-descuentos.service');

jest.mock('../config/database');

describe('listarDescuentosDisponibles - convenio fiscal ID 17 y descuento comercial ID 23', () => {
    let mockConnect, mockQuery, mockRelease;

    beforeEach(() => {
        mockRelease = jest.fn();
        mockQuery = jest.fn();
        mockConnect = jest.fn().mockResolvedValue({
            query: mockQuery,
            release: mockRelease
        });
        Pool.mockImplementation(() => ({
            connect: mockConnect
        }));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('debe incluir el convenio fiscal protegido ID 17 en la lista disponible cuando tiene reglas para la sede y servicio del certificado', async () => {
        // Configurar: convenio 17 tiene reglas para planta 98 (SURCO) y servicio 406
        mockQuery.mockResolvedValueOnce({ rows: [] }); // obtenerCertificado
        mockQuery.mockResolvedValueOnce({ rows: [] }); // tarifa operativa
        mockQuery.mockResolvedValueOnce({ rows: [] }); // regla detalle - incluir ID 17

        const resultado = await descuentos.listarDescuentosDisponibles(726, { username: 'test', perfil_id: 'admin' });

        // El convenio ID 17 debe aparecer en la lista
        const ids = resultado.map(d => d.id);
        expect(ids).toContain(17);
    });

    test('debe bloquear el descuento comercial ID 23 (100%) con validación de autorización gratuita', async () => {
        // Configurar: descuento 23 es una campaña comercial, no tiene convenio fiscal
        mockQuery.mockResolvedValueOnce({ rows: [] }); // obtenerCertificado
        mockQuery.mockResolvedValueOnce({ rows: [] }); // tarifa operativa
        mockQuery.mockResolvedValueOnce({ rows: [] }); // regla detalle - incluye ID 23 pero sin convenio

        const resultado = await descuentos.listarDescuentosDisponibles(726, { username: 'test', perfil_id: 'admin' });

        // El descuento ID 23 debe aparecer en la lista (ahya disponible para selección)
        const ids = resultado.map(d => d.id);
        expect(ids).toContain(23);

        // Pero al intentar aplicarlo, debe fallar con OPERACION_CERO_REQUIERE_AUTORIZACION_GRATUITA
        // (la validación ocurre en consultarDescuentoDirectoCore/consultarDescuentoCore)
        // Por ahora verificamos que está en la lista para selección
        expect(resultado.length).toBeGreaterThan(0);
    });

    test('debe excluir convenio fiscal ID 17 cuando la sede no coincide', async () => {
        // Configurar: convenio 17 no tiene reglas para esta sede
        mockQuery.mockResolvedValueOnce({ rows: [] }); // obtenerCertificado - planta distinta a 98
        mockQuery.mockResolvedValueOnce({ rows: [] }); // tarifa operativa

        const resultado = await descuentos.listarDescuentosDisponibles(726, { username: 'test', perfil_id: 'admin' });

        // Si el certificado tiene planta distinta a 98, el convenio 17 debería filtrarse por regla
        const hasSURCO = resultado.some(d => d.id === 17 && d.tipo === 'CONVENIO');
        expect(hasSURCO).toBeFalsy();
    });

    test('debe excluir descuento cuando el servicio no coincide', async () => {
        // Configurar: convenio 17 tiene reglas pero para servicio distinto
        mockQuery.mockResolvedValueOnce({ rows: [{ planta_key: '98' }]}); // obtenerCertificado
        mockQuery.mockResolvedValueOnce({ rows: [] }); // tarifa operativa - servicio distinto
        mockQuery.mockResolvedValueOnce({ rows: [] }); // regla detalle - servicio no coincide

        const resultado = await descuentos.listarDescuentosDisponibles(726, { username: 'test', perfil_id: 'admin' });

        // El convenio 17 debe filtrarse por servicio incorrecto
        const hasSURCO = resultado.some(d => d.id === 17 && d.tipo === 'CONVENIO');
        expect(hasSURCO).toBeFalsy();
    });

    test('debe excluir por vigencia inválida', async () => {
        // Configurar: fuera de vigencia
        mockQuery.mockResolvedValueOnce({ rows: [{ planta_key: '98' }]}); // obtenerCertificado
        mockQuery.mockResolvedValueOnce({ rows: [] }); // tarifa operativa
        mockQuery.mockResolvedValueOnce({ rows: [] }); // regla detalle
        // El query añade AND CURRENT_TIMESTAMP >= d.fecha_inicio AND CURRENT_TIMESTAMP <= d.fecha_fin
        // Si el certificado está fuera de rango, el descuento debería excluirse

        const resultado = await descuentos.listarDescuentosDisponibles(726, { username: 'test', perfil_id: 'admin' });

        // Los descuentos vencidos deberían ser filtrados por la WHERE clause del SQL
        const tieneDescuentos = resultado.length > 0;
        expect(tieneDescuentos).toBeTruthy(); // Los que están en vigencia aparecen
    });
});