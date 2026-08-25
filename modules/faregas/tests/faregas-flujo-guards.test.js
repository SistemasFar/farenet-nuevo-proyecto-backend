const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const tarifasService = require('../services/faregas-tarifas.service');
const certificadosService = require('../services/faregas-certificados.service');
const pagosService = require('../services/faregas-pagos.service');

test.after(() => db.end());

const contexto = { username: 'OPERADOR_TEST', perfil_id: 'OPERADOR', planta_key: '201' };
const tarifaComplementaria = {
    tipo_flujo: 'SERVICIO_COMPLEMENTARIO',
    tipo_certificado_clave: null,
    precio: 25
};

const conMocks = async (crearCliente, accion) => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    const tarifaOriginal = tarifasService.obtenerTarifaOperativaPorCodigo;
    const client = crearCliente();
    db.connect = async () => client;
    authService.validarAccesoPlanta = async () => true;
    tarifasService.obtenerTarifaOperativaPorCodigo = async () => tarifaComplementaria;
    try {
        await accion(client);
    } finally {
        db.connect = connectOriginal;
        authService.validarAccesoPlanta = accesoOriginal;
        tarifasService.obtenerTarifaOperativaPorCodigo = tarifaOriginal;
    }
};

test('actualizar borrador rechaza cambiar la tarifa a un servicio complementario', async () => {
    let actualizo = false;
    await conMocks(() => ({
        async query(sql) {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
            if (/SELECT estado, planta_key, tipo_certificado_clave, tarifa_codigo FROM fg_certificado/i.test(sql)) {
                return {
                    rowCount: 1,
                    rows: [{ estado: 'BORRADOR', planta_key: '201', tipo_certificado_clave: 'GLP_ANUAL', tarifa_codigo: 'GLP_ANUAL' }]
                };
            }
            if (/SELECT 1 FROM fg_orden_pago/i.test(sql)) return { rowCount: 0, rows: [] };
            if (/UPDATE fg_certificado/i.test(sql)) actualizo = true;
            throw new Error(`Consulta inesperada: ${sql}`);
        },
        release() {}
    }), async () => {
        await assert.rejects(
            certificadosService.actualizarBorrador(50, { tarifaCodigo: 'TEST_COMPLEMENTARIO' }, contexto),
            /SERVICIO_NO_CERTIFICACION/
        );
    });
    assert.equal(actualizo, false);
});

test('crear orden de pago rechaza una tarifa de servicio complementario', async () => {
    let creoOrden = false;
    await conMocks(() => ({
        async query(sql) {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
            if (/SELECT id, estado, planta_key, tipo_certificado_clave, tarifa_codigo FROM fg_certificado/i.test(sql)) {
                return {
                    rowCount: 1,
                    rows: [{ id: 50, estado: 'BORRADOR', planta_key: '201', tipo_certificado_clave: 'GLP_ANUAL', tarifa_codigo: 'TEST_COMPLEMENTARIO' }]
                };
            }
            if (/SELECT \* FROM fg_orden_pago/i.test(sql)) return { rowCount: 0, rows: [] };
            if (/INSERT INTO fg_orden_pago/i.test(sql)) creoOrden = true;
            throw new Error(`Consulta inesperada: ${sql}`);
        },
        release() {}
    }), async () => {
        await assert.rejects(
            pagosService.guardarPagos(50, {
                importeTotal: 25,
                pagos: [{ tipo: 'EFECTIVO', importe: 25 }]
            }, contexto),
            /SERVICIO_NO_CERTIFICACION/
        );
    });
    assert.equal(creoOrden, false);
});
