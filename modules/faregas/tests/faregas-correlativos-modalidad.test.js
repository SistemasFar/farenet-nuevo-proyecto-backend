const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const service = require('../services/faregas-certificados.service');

test.after(() => db.end());

test('GNV Inicial consulta el rango del tipo base GNV con modalidad INICIAL', async () => {
    const queryOriginal = db.query;
    let consulta;
    db.query = async (sql, params) => {
        consulta = { sql, params };
        return { rowCount: 1, rows: [{ id: 10 }] };
    };

    try {
        const rango = await service.obtenerRangoActivo('201', 'GNV_INICIAL');
        assert.equal(rango.id, 10);
        assert.match(consulta.sql, /c\.modalidad = \$4/i);
        assert.deepEqual(consulta.params, ['201', 'GNV_ANUAL', 'GNV_INICIAL', 'INICIAL']);
    } finally {
        db.query = queryOriginal;
    }
});

test('el filtro GLP Inicial usa tipo base y modalidad sin confundirlo con GLP Anual', async () => {
    const queryOriginal = db.query;
    let consulta;
    db.query = async (sql, params) => {
        consulta = { sql, params };
        return { rows: [] };
    };

    try {
        await service.obtenerCorrelativos({ plantaKey: '190', tipo: 'GLP_INICIAL' });
        assert.match(consulta.sql, /c\.modalidad = \$3/i);
        assert.deepEqual(consulta.params, ['190', 'GLP_ANUAL', 'INICIAL']);
    } finally {
        db.query = queryOriginal;
    }
});

test('rechaza una modalidad que no pertenece al catálogo exacto', async () => {
    await assert.rejects(
        service.obtenerRangoActivo('201', 'GNV_DESCONOCIDO'),
        /TIPO_NOT_FOUND/
    );
});

test('la primera previsualizacion reserva el correlativo real de forma atomica', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    const consultas = [];
    const client = {
        async query(sql, params) {
            consultas.push({ sql, params });
            if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: 0, rows: [] };
            if (/SELECT c\.\*, t\.clave AS tipo_clave/i.test(sql)) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: 50,
                        estado: 'BORRADOR',
                        planta_key: '201',
                        tipo_clave: 'GLP_ANUAL',
                        tipo_codigo: '41',
                        modalidad_correlativo: 'ANUAL',
                        numero_certificado: null
                    }]
                };
            }
            if (/SELECT \* FROM fg_correlativo_certificado/i.test(sql)) {
                return { rowCount: 1, rows: [{ id: 8, nro_actual: 200, nro_maximo: 300 }] };
            }
            if (/UPDATE fg_correlativo_certificado/i.test(sql)) return { rowCount: 1, rows: [] };
            if (/UPDATE fg_certificado/i.test(sql)) return { rowCount: 1, rows: [] };
            throw new Error(`Consulta inesperada: ${sql}`);
        },
        release() {}
    };
    db.connect = async () => client;
    authService.validarAccesoPlanta = async () => true;

    try {
        const numero = await service.reservarNumeroPrevisualizacion(50, {
            username: 'OPERADOR', perfil_id: 'OPERADOR', planta_key: '201'
        });
        assert.equal(numero, 'DG-41-000201');
        assert.ok(consultas.some(c => /FOR UPDATE OF c/i.test(c.sql)));
        assert.ok(consultas.some(c => /UPDATE fg_correlativo_certificado/i.test(c.sql) && c.params[0] === 201));
        assert.ok(consultas.some(c => /UPDATE fg_certificado/i.test(c.sql) && c.params[0] === 'DG-41-000201'));
    } finally {
        db.connect = connectOriginal;
        authService.validarAccesoPlanta = accesoOriginal;
    }
});

test('una previsualizacion repetida reutiliza el numero reservado', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    let consultoRango = false;
    const client = {
        async query(sql) {
            if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: 0, rows: [] };
            if (/SELECT c\.\*, t\.clave AS tipo_clave/i.test(sql)) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: 50,
                        estado: 'BORRADOR',
                        planta_key: '201',
                        tipo_clave: 'GLP_ANUAL',
                        tipo_codigo: '41',
                        modalidad_correlativo: 'ANUAL',
                        numero_certificado: 'DG-41-000201'
                    }]
                };
            }
            if (/fg_correlativo_certificado/i.test(sql)) consultoRango = true;
            throw new Error(`Consulta inesperada: ${sql}`);
        },
        release() {}
    };
    db.connect = async () => client;
    authService.validarAccesoPlanta = async () => true;

    try {
        const numero = await service.reservarNumeroPrevisualizacion(50, {
            username: 'OPERADOR', perfil_id: 'OPERADOR', planta_key: '201'
        });
        assert.equal(numero, 'DG-41-000201');
        assert.equal(consultoRango, false);
    } finally {
        db.connect = connectOriginal;
        authService.validarAccesoPlanta = accesoOriginal;
    }
});

test('emitir reutiliza el correlativo reservado sin avanzar nuevamente el rango', async () => {
    const connectOriginal = db.connect;
    const plantasOriginal = authService.getPlantasPorUsuario;
    const validarOriginal = service.validarEmision;
    let consultoOActualizoRango = false;
    const client = {
        async query(sql, params) {
            if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: 0, rows: [] };
            if (/SELECT c\.\*, t\.clave as tipo_clave/i.test(sql)) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: 50,
                        estado: 'BORRADOR',
                        planta_key: '201',
                        tipo_clave: 'GLP_ANUAL',
                        tipo_codigo: '41',
                        modalidad_correlativo: 'ANUAL',
                        numero_certificado: 'DG-41-000201'
                    }]
                };
            }
            if (/fg_correlativo_certificado/i.test(sql)) consultoOActualizoRango = true;
            if (/UPDATE fg_certificado/i.test(sql)) {
                assert.equal(params[0], 'DG-41-000201');
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Consulta inesperada: ${sql}`);
        },
        release() {}
    };
    db.connect = async () => client;
    authService.getPlantasPorUsuario = async () => [{ key: '201' }];
    service.validarEmision = async () => ({ valido: true, errores: [] });

    try {
        const resultado = await service.emitirCertificado(50, {
            username: 'OPERADOR', perfil_id: 'OPERADOR', planta_key: '201'
        });
        assert.equal(resultado.numero_certificado, 'DG-41-000201');
        assert.equal(consultoOActualizoRango, false);
    } finally {
        db.connect = connectOriginal;
        authService.getPlantasPorUsuario = plantasOriginal;
        service.validarEmision = validarOriginal;
    }
});

test('editar un rango sin uso permite cambiar inicio y fin y reajusta el actual', async () => {
    const connectOriginal = db.connect;
    let parametrosUpdate;
    const client = {
        async query(sql, params) {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
            if (/SELECT id, nro_inicio, nro_actual, nro_maximo, activo/i.test(sql)) {
                return { rowCount: 1, rows: [{ id: 7, nro_inicio: 100, nro_actual: 99, nro_maximo: 150, activo: true }] };
            }
            if (/UPDATE fg_correlativo_certificado/i.test(sql)) {
                parametrosUpdate = params;
                return { rowCount: 1, rows: [{ id: 7, nro_inicio: 200, nro_actual: 199, nro_maximo: 300, disponibles: 101 }] };
            }
            throw new Error(`Consulta inesperada: ${sql}`);
        },
        release() {}
    };
    db.connect = async () => client;

    try {
        const resultado = await service.actualizarRango(7, { nroInicio: 200, nroMaximo: 300 });
        assert.deepEqual(parametrosUpdate, [7, 200, 199, 300]);
        assert.equal(resultado.nro_actual, 199);
    } finally {
        db.connect = connectOriginal;
    }
});

test('editar un rango usado protege el correlativo inicial', async () => {
    const connectOriginal = db.connect;
    const client = {
        async query(sql) {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
            if (/SELECT id, nro_inicio, nro_actual, nro_maximo, activo/i.test(sql)) {
                return { rowCount: 1, rows: [{ id: 8, nro_inicio: 100, nro_actual: 120, nro_maximo: 150, activo: true }] };
            }
            throw new Error(`Consulta inesperada: ${sql}`);
        },
        release() {}
    };
    db.connect = async () => client;

    try {
        await assert.rejects(
            service.actualizarRango(8, { nroInicio: 90, nroMaximo: 180 }),
            /RANGO_INICIO_NO_EDITABLE/
        );
    } finally {
        db.connect = connectOriginal;
    }
});

test('editar un rango usado permite ampliar el final sin alterar el número actual', async () => {
    const connectOriginal = db.connect;
    let parametrosUpdate;
    const client = {
        async query(sql, params) {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
            if (/SELECT id, nro_inicio, nro_actual, nro_maximo, activo/i.test(sql)) {
                return { rowCount: 1, rows: [{ id: 9, nro_inicio: 100, nro_actual: 150, nro_maximo: 150, activo: true }] };
            }
            if (/UPDATE fg_correlativo_certificado/i.test(sql)) {
                parametrosUpdate = params;
                return { rowCount: 1, rows: [{ id: 9, nro_inicio: 100, nro_actual: 150, nro_maximo: 250, disponibles: 100 }] };
            }
            throw new Error(`Consulta inesperada: ${sql}`);
        },
        release() {}
    };
    db.connect = async () => client;

    try {
        const resultado = await service.actualizarRango(9, { nroInicio: 100, nroMaximo: 250 });
        assert.deepEqual(parametrosUpdate, [9, 100, 150, 250]);
        assert.equal(resultado.nro_actual, 150);
    } finally {
        db.connect = connectOriginal;
    }
});
