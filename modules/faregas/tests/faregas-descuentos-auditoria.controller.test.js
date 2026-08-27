const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const controller = require('../controllers/faregas-descuentos.controller');
const descuentosService = require('../services/faregas-descuentos.service');
const auditoriaService = require('../services/faregas-auditoria.service');

test.after(() => db.end());

const response = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
});

test('crear un código registra la auditoría con usuario, código e identificadores reales', async () => {
    const crearOriginal = descuentosService.crearCodigoCliente;
    const auditarOriginal = auditoriaService.registrarEvento;
    let auditoria;

    descuentosService.crearCodigoCliente = async () => ({ id: 321 });
    auditoriaService.registrarEvento = async (evento) => { auditoria = evento; };

    const req = {
        params: { id: '45' },
        body: { codigo: ' promo-2026 ' },
        user: { username: 'gibarra', perfil_id: 'SISTEMAS', planta_key: '201' },
        headers: { 'user-agent': 'test' },
        ip: '127.0.0.1'
    };
    const res = response();

    try {
        await controller.crearCodigo(req, res);
        assert.equal(res.statusCode, 201);
        assert.deepEqual(res.payload, { success: true, id: 321 });
        assert.equal(auditoria.username, 'gibarra');
        assert.equal(auditoria.perfil, 'SISTEMAS');
        assert.equal(auditoria.categoria, 'DESCUENTO');
        assert.equal(auditoria.evento, 'CODIGO_DESCUENTO_CREADO');
        assert.equal(auditoria.entidad, 'fg_descuentocliente');
        assert.equal(auditoria.entidad_id, 321);
        assert.deepEqual(auditoria.datos, { descuentoId: 45, codigo: 'PROMO-2026' });
    } finally {
        descuentosService.crearCodigoCliente = crearOriginal;
        auditoriaService.registrarEvento = auditarOriginal;
    }
});
