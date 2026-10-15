const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const db = require('../../../config/database');
const clientesService = require('../services/faregas-clientes.service');

test('buscarClientePropio compara tipo y número como identidad compuesta', async () => {
    const queryOriginal = db.query;
    try {
        db.query = async (sql, params) => {
            assert.match(sql, /WHERE tipo_documento = \$1 AND nro_documento = \$2/);
            assert.deepEqual(params, ['DNI', '74045612']);
            return {
                rows: [{
                    id: 7,
                    tipoDocumento: 'DNI',
                    nroDocumento: '74045612',
                    nombreRazonSocial: 'CLIENTE LOCAL',
                    direccion: 'LIMA',
                    correo: 'cliente@faregas.pe',
                    telefono: '999999999'
                }]
            };
        };

        const cliente = await clientesService.buscarClientePropio('DNI', '74045612', {
            incluirFacturacionHistorica: false
        });
        assert.equal(cliente.id, 7);
    } finally {
        db.query = queryOriginal;
    }
});

test('consultarDocumento rechaza documentos con longitud distinta a 8 u 11 dígitos', async () => {
    await assert.rejects(
        () => clientesService.consultarDocumento('12345'),
        (err) => err.message === 'DOCUMENTO_INVALIDO'
    );
    await assert.rejects(
        () => clientesService.consultarDocumento('123456789'),
        (err) => err.message === 'DOCUMENTO_INVALIDO'
    );
    await assert.rejects(
        () => clientesService.consultarDocumento('123456789012'),
        (err) => err.message === 'DOCUMENTO_INVALIDO'
    );
});

test('Caso 1: cliente existe en fg_cliente retorna origen FAREGAS sin llamar externo', async () => {
    const buscarOriginal = clientesService.buscarClientePropio;
    try {
        clientesService.buscarClientePropio = async (tipo, doc, opciones) => {
            assert.deepEqual(opciones, { incluirFacturacionHistorica: false });
            if (doc === '74045612') {
                return {
                    id: 99,
                    tipoDocumento: 'DNI',
                    nroDocumento: '74045612',
                    nombreRazonSocial: 'GRACE IBARRA DUEÑA REAL',
                    direccion: 'AV. FAREGAS 123',
                    correo: 'grace@correo.com',
                    telefono: '987654321',
                };
            }
            return null;
        };

        const res = await clientesService.consultarDocumento('DNI', '74045612');
        assert.equal(res.encontrado, true);
        assert.equal(res.origen, 'FAREGAS');
        assert.equal(res.data.nombreRazonSocial, 'GRACE IBARRA DUEÑA REAL');
        assert.equal(res.data.correo, 'grace@correo.com');
        assert.equal(res.data.telefono, '987654321');
        assert.equal(res.data.clienteExistente, true);
    } finally {
        clientesService.buscarClientePropio = buscarOriginal;
    }
});

test('Caso 2: cliente no existe y token ausente retorna EXTERNO_NO_CONFIGURADO sin inventar datos', async () => {
    const buscarOriginal = clientesService.buscarClientePropio;
    const tokenBackup = process.env.API_DNI_TOKEN;
    try {
        delete process.env.API_DNI_TOKEN;

        clientesService.buscarClientePropio = async (_tipo, _doc, opciones) => {
            assert.deepEqual(opciones, { incluirFacturacionHistorica: false });
            return null;
        };

        const resDni = await clientesService.consultarDocumento('DNI', '70261331');
        assert.equal(resDni.encontrado, false);
        assert.equal(resDni.origen, 'EXTERNO_NO_CONFIGURADO');
        assert.equal(resDni.proveedor, 'RENIEC');
        assert.equal(resDni.data, null);
        assert.match(resDni.mensaje, /no está configurada/);

        const resRuc = await clientesService.consultarDocumento('RUC', '10702613316');
        assert.equal(resRuc.encontrado, false);
        assert.equal(resRuc.origen, 'EXTERNO_NO_CONFIGURADO');
        assert.equal(resRuc.proveedor, 'SUNAT');
        assert.equal(resRuc.data, null);
    } finally {
        clientesService.buscarClientePropio = buscarOriginal;
        if (tokenBackup) process.env.API_DNI_TOKEN = tokenBackup;
        else delete process.env.API_DNI_TOKEN;
    }
});

test('Caso 3: DNI externo con proveedor mockeado EN EL TEST responde datos normalizados', async () => {
    const buscarOriginal = clientesService.buscarClientePropio;
    const asegurarOriginal = clientesService.asegurarCliente;
    const getOriginal = axios.get;
    const tokenBackup = process.env.API_DNI_TOKEN;
    try {
        process.env.API_DNI_TOKEN = 'test-token-valido';
        clientesService.buscarClientePropio = async () => null;
        clientesService.asegurarCliente = async (data) => {
            assert.equal(data.tipoDocumento, 'DNI');
            assert.equal(data.nroDocumento, '70261331');
            return { id: 701, creado: true };
        };

        axios.get = async (url, config) => {
            assert.ok(url.includes('api.decolecta.com/v1/reniec/dni?numero=70261331'));
            assert.equal(config.headers.Authorization, 'Bearer test-token-valido');
            assert.equal(config.headers.Accept, 'application/json');
            assert.equal(config.timeout, 6000);
            return {
                status: 200,
                data: {
                    nombres: 'CARLOS ALBERTO',
                    apellidoPaterno: 'RODRIGUEZ',
                    apellidoMaterno: 'MENDOZA',
                    numeroDocumento: '70261331'
                }
            };
        };

        const res = await clientesService.consultarDocumento('DNI', '70261331');
        assert.equal(res.encontrado, true);
        assert.equal(res.origen, 'RENIEC');
        assert.equal(res.data.nombreRazonSocial, 'RODRIGUEZ MENDOZA CARLOS ALBERTO');
        assert.equal(res.data.tipoDocumento, 'DNI');
        assert.equal(res.data.clienteExistente, false);
        assert.equal(res.data.id, 701);
        assert.equal(res.cliente, res.data);
        assert.equal(res.httpStatus, 200);
    } finally {
        clientesService.buscarClientePropio = buscarOriginal;
        clientesService.asegurarCliente = asegurarOriginal;
        axios.get = getOriginal;
        if (tokenBackup) process.env.API_DNI_TOKEN = tokenBackup;
        else delete process.env.API_DNI_TOKEN;
    }
});

test('Caso 4: RUC externo con proveedor mockeado EN EL TEST responde datos normalizados', async () => {
    const buscarOriginal = clientesService.buscarClientePropio;
    const asegurarOriginal = clientesService.asegurarCliente;
    const getOriginal = axios.get;
    const tokenBackup = process.env.API_DNI_TOKEN;
    try {
        process.env.API_DNI_TOKEN = 'test-token-valido';
        clientesService.buscarClientePropio = async () => null;
        clientesService.asegurarCliente = async (data) => {
            assert.equal(data.tipoDocumento, 'RUC');
            assert.equal(data.nroDocumento, '20601234567');
            assert.equal(data.nombreRazonSocial, 'TRANSPORTES LOGISTICOS REALES S.A.C.');
            return { id: 702, creado: true };
        };

        axios.get = async (url) => {
            assert.ok(url.includes('api.decolecta.com/v1/sunat/ruc?numero=20601234567'));
            return {
                status: 200,
                data: {
                    razonSocial: 'TRANSPORTES LOGISTICOS REALES S.A.C.',
                    direccion: 'AV. ARGENTINA 456',
                    numeroDocumento: '20601234567'
                }
            };
        };

        const res = await clientesService.consultarDocumento('RUC', '20601234567');
        assert.equal(res.encontrado, true);
        assert.equal(res.origen, 'SUNAT');
        assert.equal(res.data.nombreRazonSocial, 'TRANSPORTES LOGISTICOS REALES S.A.C.');
        assert.equal(res.data.direccion, 'AV. ARGENTINA 456');
        assert.equal(res.data.clienteExistente, false);
        assert.equal(res.data.id, 702);
    } finally {
        clientesService.buscarClientePropio = buscarOriginal;
        clientesService.asegurarCliente = asegurarOriginal;
        axios.get = getOriginal;
        if (tokenBackup) process.env.API_DNI_TOKEN = tokenBackup;
        else delete process.env.API_DNI_TOKEN;
    }
});

test('cliente manual válido se inserta una sola vez en fg_cliente por tipo y número', async () => {
    const queryOriginal = db.query;
    const consultas = [];
    try {
        db.query = async (sql, params) => {
            consultas.push({ sql, params });
            if (/^\s*SELECT id, tipo_documento/s.test(sql)) return { rows: [] };
            if (/^\s*INSERT INTO fg_cliente/s.test(sql)) {
                return { rows: [{
                    id: 811,
                    tipo_documento: 'RUC',
                    nro_documento: '10702613316',
                    nombre_razon_social: 'MARIEL MARTINEZ',
                    direccion: 'CALLE VARSOBIA',
                    correo: 'mariel@correo.pe',
                    telefono: '999999999'
                }] };
            }
            throw new Error(`SQL inesperado: ${sql}`);
        };

        const cliente = await clientesService.asegurarCliente({
            tipoDocumento: ' RUC ',
            nroDocumento: '10702613316',
            nombreRazonSocial: 'MARIEL MARTINEZ',
            direccion: 'CALLE VARSOBIA',
            correo: 'MARIEL@CORREO.PE',
            telefono: '999999999'
        });
        assert.equal(cliente.id, 811);
        assert.equal(cliente.creado, true);
        assert.deepEqual(consultas[0].params, ['RUC', '10702613316']);
        assert.deepEqual(consultas[1].params, [
            'RUC', '10702613316', 'MARIEL MARTINEZ', 'CALLE VARSOBIA', '999999999', 'mariel@correo.pe'
        ]);
    } finally {
        db.query = queryOriginal;
    }
});

test('proveedor externo con 401 se distingue como credencial no autorizada', async () => {
    const buscarOriginal = clientesService.buscarClientePropio;
    const getOriginal = axios.get;
    const tokenBackup = process.env.API_DNI_TOKEN;
    try {
        process.env.API_DNI_TOKEN = 'token-invalido-de-test';
        clientesService.buscarClientePropio = async () => null;
        axios.get = async () => {
            const error = new Error('Unauthorized');
            error.response = { status: 401 };
            throw error;
        };

        const res = await clientesService.consultarDocumento('DNI', '70261331');
        assert.equal(res.encontrado, false);
        assert.equal(res.origen, 'EXTERNO_NO_AUTORIZADO');
        assert.equal(res.proveedor, 'RENIEC');
        assert.equal(res.httpStatus, 401);
        assert.match(res.mensaje, /autenticar/);
    } finally {
        clientesService.buscarClientePropio = buscarOriginal;
        axios.get = getOriginal;
        if (tokenBackup) process.env.API_DNI_TOKEN = tokenBackup;
        else delete process.env.API_DNI_TOKEN;
    }
});

test('proveedor externo con timeout se distingue de documento no encontrado', async () => {
    const buscarOriginal = clientesService.buscarClientePropio;
    const getOriginal = axios.get;
    const tokenBackup = process.env.API_DNI_TOKEN;
    try {
        process.env.API_DNI_TOKEN = 'test-token-valido';
        clientesService.buscarClientePropio = async () => null;

        axios.get = async () => {
            const err = new Error('timeout of 6000ms exceeded');
            err.code = 'ECONNABORTED';
            throw err;
        };

        const res = await clientesService.consultarDocumento('DNI', '70261331');
        assert.equal(res.encontrado, false);
        assert.equal(res.origen, 'EXTERNO_TIMEOUT');
        assert.equal(res.proveedor, 'RENIEC');
        assert.match(res.mensaje, /temporalmente/);
    } finally {
        clientesService.buscarClientePropio = buscarOriginal;
        axios.get = getOriginal;
        if (tokenBackup) process.env.API_DNI_TOKEN = tokenBackup;
        else delete process.env.API_DNI_TOKEN;
    }
});

test('proveedor externo con 404 se normaliza como documento no encontrado', async () => {
    const buscarOriginal = clientesService.buscarClientePropio;
    const getOriginal = axios.get;
    const tokenBackup = process.env.API_DNI_TOKEN;
    try {
        process.env.API_DNI_TOKEN = 'test-token-valido';
        clientesService.buscarClientePropio = async () => null;
        axios.get = async () => {
            const error = new Error('Not found');
            error.response = { status: 404 };
            throw error;
        };

        const res = await clientesService.consultarDocumento('RUC', '20601234567');
        assert.equal(res.encontrado, false);
        assert.equal(res.origen, 'NO_ENCONTRADO');
        assert.equal(res.proveedor, 'SUNAT');
        assert.equal(res.httpStatus, 404);
    } finally {
        clientesService.buscarClientePropio = buscarOriginal;
        axios.get = getOriginal;
        if (tokenBackup) process.env.API_DNI_TOKEN = tokenBackup;
        else delete process.env.API_DNI_TOKEN;
    }
});

test('Caso 6: el servicio nunca devuelve los strings falsos hardcodeados', async () => {
    const buscarOriginal = clientesService.buscarClientePropio;
    const tokenBackup = process.env.API_DNI_TOKEN;
    try {
        delete process.env.API_DNI_TOKEN;
        clientesService.buscarClientePropio = async () => null;

        const resDni = await clientesService.consultarDocumento('DNI', '70261331');
        const resRuc = await clientesService.consultarDocumento('RUC', '10702613316');

        const jsonDni = JSON.stringify(resDni);
        const jsonRuc = JSON.stringify(resRuc);

        assert.equal(jsonDni.includes('PEREZ DE LA CRUZ JUAN'), false);
        assert.equal(jsonDni.includes('EMPRESA DE PRUEBA S.A.C.'), false);
        assert.equal(jsonDni.includes('AV. LOS INCAS 123'), false);

        assert.equal(jsonRuc.includes('PEREZ DE LA CRUZ JUAN'), false);
        assert.equal(jsonRuc.includes('EMPRESA DE PRUEBA S.A.C.'), false);
        assert.equal(jsonRuc.includes('AV. LOS INCAS 123'), false);
    } finally {
        clientesService.buscarClientePropio = buscarOriginal;
        if (tokenBackup) process.env.API_DNI_TOKEN = tokenBackup;
        else delete process.env.API_DNI_TOKEN;
    }
});

test('Caso 5: Carné de Extranjería busca localmente y usa captura manual sin enviarlo a RENIEC/SUNAT', async () => {
    const buscarOriginal = clientesService.buscarClientePropio;
    const getOriginal = axios.get;
    let llamadasExternas = 0;
    try {
        clientesService.buscarClientePropio = async (tipo, documento, opciones) => {
            assert.equal(tipo, 'CARNETEXTRANJERIA');
            assert.equal(documento, 'CE123456');
            assert.deepEqual(opciones, { incluirFacturacionHistorica: false });
            return null;
        };
        axios.get = async () => {
            llamadasExternas += 1;
            throw new Error('No debe llamarse');
        };

        const res = await clientesService.consultarDocumento('CARNETEXTRANJERIA', 'CE123456');
        assert.equal(res.encontrado, false);
        assert.equal(res.origen, 'SIN_PROVEEDOR_PARA_TIPO');
        assert.equal(res.data, null);
        assert.match(res.mensaje, /manualmente/);
        assert.equal(llamadasExternas, 0);
    } finally {
        clientesService.buscarClientePropio = buscarOriginal;
        axios.get = getOriginal;
    }
});

test('validación explícita respeta la regla del tipo seleccionado', async () => {
    await assert.rejects(
        () => clientesService.consultarDocumento('DNI', '1234567890'),
        (err) => err.message === 'DOCUMENTO_INVALIDO'
    );
    await assert.rejects(
        () => clientesService.consultarDocumento('RUC', '12345678'),
        (err) => err.message === 'DOCUMENTO_INVALIDO'
    );
    await assert.rejects(
        () => clientesService.consultarDocumento('PASAPORTE', 'AB12345'),
        (err) => err.message === 'TIPO_DOCUMENTO_INVALIDO'
    );
});

test('listarClientes pagina en backend y completa contactos desde la última facturación', async () => {
    const consultas = [];
    const fakeDb = {
        query: async (sql, params) => {
            consultas.push({ sql, params });
            if (/SELECT COUNT\(\*\)::int AS total FROM filtrados/.test(sql)) {
                assert.deepEqual(params, ['grace', 'ACTIVO']);
                return { rows: [{ total: 1 }] };
            }
            assert.match(sql, /WITH ultima_facturacion AS/);
            assert.match(sql, /LIMIT \$3 OFFSET \$4/);
            assert.deepEqual(params, ['grace', 'ACTIVO', 20, 20]);
            return { rows: [{
                id: 10,
                tipo_documento: 'DNI',
                nro_documento: '74045612',
                nombre_razon_social: 'GRACE',
                direccion: 'CALLE PRUEBA 123',
                telefono: '999999999',
                correo: 'grace@example.com',
                estado: true,
                origen: 'MAESTRO',
                fecha_creacion: '2026-10-01T10:00:00.000Z',
                fecha_modificacion: '2026-10-15T10:00:00.000Z',
                total_certificados: 2,
                total_comprobantes: 3,
                ultima_atencion: '2026-10-15T10:00:00.000Z',
                ultima_planta_key: '98',
                ultima_planta_nombre: 'SURCO',
                ultima_placa: 'ABC123'
            }] };
        }
    };

    const resultado = await clientesService.listarClientes({
        texto: 'grace', estado: 'ACTIVO', pagina: 2, limite: 20
    }, { db: fakeDb });

    assert.equal(consultas.length, 2);
    assert.equal(resultado.total, 1);
    assert.equal(resultado.page, 2);
    assert.equal(resultado.totalPages, 1);
    assert.deepEqual(resultado.clientes[0], {
        id: 10,
        tipoDocumento: 'DNI',
        nroDocumento: '74045612',
        nombreRazonSocial: 'GRACE',
        direccion: 'CALLE PRUEBA 123',
        telefono: '999999999',
        correo: 'grace@example.com',
        estado: true,
        origen: 'MAESTRO',
        fechaCreacion: '2026-10-01T10:00:00.000Z',
        fechaModificacion: '2026-10-15T10:00:00.000Z',
        totalCertificados: 2,
        totalComprobantes: 3,
        ultimaAtencion: '2026-10-15T10:00:00.000Z',
        ultimaPlantaKey: '98',
        ultimaPlantaNombre: 'SURCO',
        ultimaPlaca: 'ABC123'
    });
});

test('listarClientes rechaza estados no soportados antes de consultar la base', async () => {
    await assert.rejects(
        () => clientesService.listarClientes({ estado: 'BORRADO' }, {
            db: { query: async () => { throw new Error('No debe consultar'); } }
        }),
        (error) => error.message === 'ESTADO_CLIENTE_INVALIDO' && error.statusCode === 400
    );
});
