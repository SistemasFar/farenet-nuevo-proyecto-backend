const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../controllers/faregas-config.controller');
const service = require('../services/faregas-config.service');
const db = require('../../../config/database');

test.after(() => db.end());

const response = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
});

test('rechaza editar una empresa con RUC inválido', async () => {
    const res = response();
    await controller.editarEmpresa({
        params: { key: 'CAMBRIDGE' }, body: { nombre: 'Empresa', ruc: '123' },
        user: { username: 'TEST' }, ip: '127.0.0.1'
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /11 dígitos/i);
});

test('normaliza y envía la edición de empresa al servicio FAREGAS', async () => {
    const original = service.editarEmpresa;
    let recibido;
    service.editarEmpresa = async (...args) => { recibido = args; };
    try {
        const res = response();
        await controller.editarEmpresa({
            params: { key: 'CAMBRIDGE' },
            body: { nombre: '  Empresa Demo  ', ruc: '20600444531', direccion: '', telefono: ' 717-3131 ' },
            user: { username: 'TEST' }, ip: '127.0.0.1'
        }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(recibido[0], 'CAMBRIDGE');
        assert.deepEqual(recibido[1], {
            nombre: 'Empresa Demo', ruc: '20600444531', direccion: null,
            telefono: '717-3131', cuenta_banco_nacion: null
        });
    } finally {
        service.editarEmpresa = original;
    }
});

test('asigna una empresa normalizada a una sede', async () => {
    const original = service.asignarEmpresaSede;
    let recibido;
    service.asignarEmpresaSede = async (...args) => { recibido = args; };
    try {
        const res = response();
        await controller.asignarEmpresaSede({
            params: { key: '201' }, body: { empresa_key: ' cambridge ' },
            user: { username: 'TEST' }, ip: '127.0.0.1'
        }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(recibido.slice(0, 2), ['201', 'CAMBRIDGE']);
    } finally {
        service.asignarEmpresaSede = original;
    }
});

test('valida y envía el cambio de estado de una empresa', async () => {
    const original = service.cambiarEstadoEmpresa;
    let recibido;
    service.cambiarEstadoEmpresa = async (...args) => { recibido = args; };
    try {
        const res = response();
        await controller.cambiarEstadoEmpresa({
            params: { key: 'CAMBRIDGE' }, body: { activo: false },
            user: { username: 'TEST' }, ip: '127.0.0.1'
        }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(recibido.slice(0, 2), ['CAMBRIDGE', false]);
        assert.equal(recibido[2], null);
    } finally {
        service.cambiarEstadoEmpresa = original;
    }
});

test('crea una empresa normalizando código y datos opcionales', async () => {
    const original = service.crearEmpresa;
    let recibido;
    service.crearEmpresa = async (...args) => { recibido = args; };
    try {
        const res = response();
        await controller.crearEmpresa({
            body: { key: ' nueva_1 ', nombre: ' Nueva Empresa ', ruc: '20123456789' },
            user: { username: 'TEST' }, ip: '127.0.0.1'
        }, res);
        assert.equal(res.statusCode, 201);
        assert.deepEqual(recibido[0], {
            key: 'NUEVA_1', nombre: 'Nueva Empresa', ruc: '20123456789',
            direccion: null, telefono: null, cuenta_banco_nacion: null
        });
    } finally {
        service.crearEmpresa = original;
    }
});

test('envía obligatoriamente la empresa reemplazante al desactivar', async () => {
    const original = service.cambiarEstadoEmpresa;
    let recibido;
    service.cambiarEstadoEmpresa = async (...args) => { recibido = args; };
    try {
        const res = response();
        await controller.cambiarEstadoEmpresa({
            params: { key: 'CAMBRIDGE' },
            body: { activo: false, empresa_reemplazo_key: ' nottingham ' },
            user: { username: 'TEST' }, ip: '127.0.0.1'
        }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(recibido.slice(0, 3), ['CAMBRIDGE', false, 'NOTTINGHAM']);
    } finally {
        service.cambiarEstadoEmpresa = original;
    }
});
