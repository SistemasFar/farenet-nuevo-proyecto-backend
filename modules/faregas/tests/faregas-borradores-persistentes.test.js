const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const auth = require('../services/faregas-auth.service');
const service = require('../services/faregas-certificados.service');

test('lista borradores activos de la sede, con búsqueda backend y sin filtro por día', async () => {
    const queryOriginal = db.query;
    const plantasOriginal = auth.getPlantasPorUsuario;
    const consultas = [];
    auth.getPlantasPorUsuario = async () => [{ key: '201' }];
    db.query = async (sql, params) => {
        consultas.push({ sql, params });
        if (/COUNT\(DISTINCT c.id\)/i.test(sql)) return { rows: [{ count: '1' }] };
        return { rows: [{ id: 44, estado: 'BORRADOR', pasoActual: 'PAGO' }] };
    };
    try {
        const result = await service.obtenerBorradores(1, 10, 'ABC123', {
            username: 'operador', perfil_id: 'OPERADOR', planta_key: '201'
        });
        assert.equal(result.total, 1);
        assert.equal(result.data[0].id, 44);
        assert.equal(consultas[0].params[0], '201');
        assert.match(consultas[0].sql, /c\.estado = 'BORRADOR'/);
        assert.doesNotMatch(consultas[0].sql, /CURRENT_DATE/);
        assert.match(consultas[1].sql, /COALESCE\(c\.fecha_modificacion, c\.fecha_creacion\) DESC/);
        assert.equal(consultas[1].params[1], '%ABC123%');
    } finally {
        db.query = queryOriginal;
        auth.getPlantasPorUsuario = plantasOriginal;
    }
});

test('impide recuperar un borrador perteneciente a una sede no autorizada', async () => {
    const queryOriginal = db.query;
    const accesoOriginal = auth.validarAccesoPlanta;
    db.query = async () => ({ rowCount: 1, rows: [{ id: 9, planta_key: '999', estado: 'BORRADOR' }] });
    auth.validarAccesoPlanta = async () => false;
    try {
        await assert.rejects(
            service.obtenerBorradorCompleto(9, { username: 'operador', perfil_id: 'OPERADOR' }),
            /PLANTA_NO_AUTORIZADA/
        );
    } finally {
        db.query = queryOriginal;
        auth.validarAccesoPlanta = accesoOriginal;
    }
});

test('persiste una transición consecutiva y rechaza saltarse pasos', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = auth.validarAccesoPlanta;
    const actualizaciones = [];
    let pasoActual = 'PAGO';
    const client = {
        query: async (sql, params) => {
            if (/SELECT estado, planta_key, paso_actual/i.test(sql)) {
                return { rowCount: 1, rows: [{ estado: 'BORRADOR', planta_key: '201', paso_actual: pasoActual }] };
            }
            if (/UPDATE fg_certificado/i.test(sql)) {
                actualizaciones.push(params);
                pasoActual = params[1];
            }
            return { rowCount: 0, rows: [] };
        },
        release: () => undefined
    };
    db.connect = async () => client;
    auth.validarAccesoPlanta = async () => true;
    try {
        const result = await service.actualizarPasoBorrador(7, 'VEHICULO', {
            username: 'operador', perfil_id: 'OPERADOR'
        });
        assert.equal(result.pasoActual, 'VEHICULO');
        assert.equal(actualizaciones.length, 1);
        await assert.rejects(
            service.actualizarPasoBorrador(7, 'VERIFICACION_EMISION', {
                username: 'operador', perfil_id: 'OPERADOR'
            }),
            /TRANSICION_PASO_INVALIDA/
        );
    } finally {
        db.connect = connectOriginal;
        auth.validarAccesoPlanta = accesoOriginal;
    }
});

test('permite guardar el vehículo después del pago y solo lo bloquea al iniciar facturación', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = auth.validarAccesoPlanta;
    const consultas = [];
    let facturacionIniciada = false;
    const client = {
        query: async (sql) => {
            consultas.push(sql);
            if (/SELECT estado, planta_key FROM fg_certificado/i.test(sql)) {
                return { rowCount: 1, rows: [{ estado: 'BORRADOR', planta_key: '201' }] };
            }
            if (/FROM fg_facturacion/i.test(sql)) {
                return facturacionIniciada
                    ? { rowCount: 1, rows: [{ '?column?': 1 }] }
                    : { rowCount: 0, rows: [] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => undefined
    };
    db.connect = async () => client;
    auth.validarAccesoPlanta = async () => true;
    try {
        await service.guardarVehiculoBorrador(163, { placa: 'ABC123' }, {
            username: 'operador', perfil_id: 'OPERADOR'
        });
        const consultaBloqueo = consultas.find((sql) => /FROM fg_facturacion/i.test(sql));
        assert.ok(consultaBloqueo);
        assert.doesNotMatch(consultaBloqueo, /fg_orden_pago/i);

        facturacionIniciada = true;
        await assert.rejects(
            service.guardarVehiculoBorrador(163, { placa: 'ABC123' }, {
                username: 'operador', perfil_id: 'OPERADOR'
            }),
            /DATOS_PREVIOS_NO_EDITABLES/
        );
    } finally {
        db.connect = connectOriginal;
        auth.validarAccesoPlanta = accesoOriginal;
    }
});
