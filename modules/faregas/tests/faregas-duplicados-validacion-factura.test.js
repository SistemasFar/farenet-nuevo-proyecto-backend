const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const facturacionRules = require('../services/faregas-facturacion.rules');
const facturacionService = require('../services/faregas-facturacion.service');
const duplicadosService = require('../services/faregas-duplicados.service');
const duplicadosController = require('../controllers/faregas-duplicados.controller');

const factura = (overrides = {}) => facturacionRules.normalizarFacturacion({
    tipoComprobante: 'FACTURA',
    tipoDocumentoCliente: 'RUC',
    nroDocumento: '20100070970',
    nombreRazonSocial: 'EMPRESA DE PRUEBA',
    direccion: 'AV. PRUEBA 123',
    condicionPago: 'CONTADO',
    medioPago: 'EFECTIVO',
    ...overrides
});

test('duplicado: admite FACTURA con RUC y razón social válidos', () => {
    assert.equal(facturacionRules.esRucValido('20100070970'), true);
    assert.deepEqual(facturacionRules.validarFacturacion(factura()), []);
});

test('duplicado: rechaza RUC con 11 dígitos pero dígito verificador incorrecto', () => {
    const errores = facturacionRules.validarFacturacion(factura({ nroDocumento: '10740456121' }));
    assert.deepEqual(errores, ['El RUC no tiene un digito verificador valido.']);
});

test('duplicado: dirección fiscal vacía es válida; el nombre sí es obligatorio', () => {
    assert.deepEqual(facturacionRules.validarFacturacion(factura({ direccion: '' })), []);
    assert.ok(facturacionRules.validarFacturacion(factura({ nombreRazonSocial: '' }))
        .some(error => error.includes('nombre o razon social')));
});

test('duplicado: los pagos sólo se registran mientras la operación está pendiente de pago', () => {
    assert.equal(duplicadosService._private.debeGuardarPagos('PAGADO'), false);
    assert.equal(duplicadosService._private.debeGuardarPagos('FACTURADO'), false);
    assert.equal(duplicadosService._private.debeGuardarPagos('PENDIENTE_PAGO'), true);
});

test('duplicado pagado con RUC inválido se detiene antes de abrir transacción o guardar pagos', async () => {
    const queryOriginal = db.query;
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    let conexiones = 0;
    let registrosPago = 0;
    const consultas = [];
    db.query = async (sql) => {
        consultas.push(String(sql).trim());
        if (String(sql).includes('SELECT d.*, c.numero_certificado')) {
            return {
                rowCount: 1,
                rows: [{
                    id: 454,
                    certificado_original_id: 41,
                    operacion_id: 4541,
                    precio: 50,
                    estado: 'PENDIENTE_COMPROBANTE',
                    operacion_estado: 'PAGADO',
                    planta_key: 'SURCO',
                    numero_certificado: 'DG-41-000454',
                    numero_duplicado: 1
                }]
            };
        }
        if (String(sql).includes('SELECT p.id, p.importe')) {
            return { rowCount: 1, rows: [{ id: 80, importe: 50 }] };
        }
        throw new Error(`Consulta inesperada en el test aislado: ${String(sql).trim().slice(0, 80)}`);
    };
    db.connect = async () => {
        conexiones += 1;
        throw new Error('No se esperaba abrir una transacción para datos fiscales inválidos.');
    };
    authService.validarAccesoPlanta = async () => true;
    try {
        await assert.rejects(
            duplicadosService.procesar(454, {
                pagos: [{ tipo: 'EFECTIVO', importe: 50 }],
                facturacion: {
                    tipoComprobante: 'FACTURA',
                    tipoDocumentoCliente: 'RUC',
                    nroDocumento: '10740456121',
                    nombreRazonSocial: 'GRACE IBARRA',
                    direccion: '',
                    condicionPago: 'CONTADO'
                }
            }, { username: 'TEST', perfil_id: 1 }, {
                pagosService: { guardarPagosOperacion: async () => { registrosPago += 1; } },
                facturacionService
            }),
            error => {
                assert.equal(error.code, 'DATOS_FACTURACION_INVALIDOS');
                assert.deepEqual(error.detalles, ['El RUC no tiene un digito verificador valido.']);
                return true;
            }
        );
    } finally {
        db.query = queryOriginal;
        db.connect = connectOriginal;
        authService.validarAccesoPlanta = accesoOriginal;
    }
    assert.equal(conexiones, 0);
    assert.equal(registrosPago, 0);
    assert.equal(consultas.length, 2);
    assert.ok(consultas.every(sql => /^SELECT\b/i.test(sql)));
});

test('controller de duplicados devuelve el detalle de validación sin convertirlo en mensaje genérico', async () => {
    const original = duplicadosService.procesar;
    duplicadosService.procesar = async () => {
        const error = new Error('DATOS_FACTURACION_INVALIDOS');
        error.code = 'DATOS_FACTURACION_INVALIDOS';
        error.statusCode = 400;
        error.detalles = {
            errores: ['El RUC no tiene un digito verificador valido.'],
            duplicadoId: 999,
            operacionId: 1777
        };
        throw error;
    };
    const response = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
    try {
        await duplicadosController.procesar({ params: { id: '999' }, body: {}, user: {} }, response);
    } finally {
        duplicadosService.procesar = original;
    }
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.message, 'El RUC no tiene un digito verificador valido.');
});
