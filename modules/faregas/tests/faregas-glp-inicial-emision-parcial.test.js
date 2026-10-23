const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const certService = require('../services/faregas-certificados.service');
const factService = require('../services/faregas-facturacion.service');
const factController = require('../controllers/faregas-facturacion.controller');

const vehiculoMockCompleto = {
    marca: 'NISSAN',
    modelo: 'SENTRA',
    version: '1.8',
    placa: 'ABC123',
    numero_motor: 'MR20',
    vin: '3N1123456789',
    serie_chasis: '3N1123456789',
    categoria: 'M1',
    combustible: 'GASOLINA',
    combustible_original: 'GASOLINA',
    anio_fabricacion: 2020,
    numero_cilindros: 4,
    cilindrada: '1800',
    numero_ejes: 2,
    numero_ruedas: 4,
    numero_asientos: 5,
    numero_pasajeros: 4,
    longitud: 4.6,
    ancho: 1.8,
    alto: 1.5,
    peso_neto: 1200,
    peso_bruto: 1600,
    carga_util: 400
};

const titularMockCompleto = {
    tipo_documento: 'DNI',
    nro_documento: '74045612',
    nombre_razon_social: 'CLIENTE PRUEBA'
};

const ordenPagoMockCompleto = {
    id: 1,
    estado: 'PAGADO',
    importe_total: 90,
    importe_pagado: 90,
    saldo_pendiente: 0,
    formapago_key: 'efectivo'
};

test('1. GLP Inicial: campos requeridos del CILINDRO no exigen modelo', () => {
    const { camposRequeridosComponenteGlp } = certService._private;
    const inicialCilindro = camposRequeridosComponenteGlp('INICIAL', 'CILINDRO').map(([campo]) => campo);
    const inicialRegulador = camposRequeridosComponenteGlp('INICIAL', 'REGULADOR').map(([campo]) => campo);

    // Cilindro requiere marca, serie, capacidad, anio y mes, pero NO modelo
    assert.deepEqual(inicialCilindro, [
        'marca',
        'numero_serie',
        'capacidad_litros',
        'anio_fabricacion',
        'mes_fabricacion'
    ]);
    assert.equal(inicialCilindro.includes('modelo'), false);

    // Regulador SÍ requiere modelo
    assert.deepEqual(inicialRegulador, ['marca', 'numero_serie', 'modelo']);
    assert.equal(inicialRegulador.includes('modelo'), true);
});

test('2. GLP Inicial: componente CILINDRO sin modelo es válido técnicamente', async () => {
    const originalQuery = db.query;

    db.query = async (sql, params = []) => {
        const text = String(sql);
        if (text.includes('SELECT c.*, t.clave AS tipo_clave')) {
            return {
                rowCount: 1,
                rows: [{
                    id: 900,
                    tipo_certificado_clave: 'GLP_ANUAL',
                    tipo_clave: 'GLP_ANUAL',
                    planta_key: '98',
                    estado: 'BORRADOR',
                    numero_certificado: null,
                    servicio_tipo_flujo: null
                }]
            };
        }
        if (text.includes('FROM fg_planta')) {
            return { rowCount: 1, rows: [{ key: '98', nombre: 'SURCO' }] };
        }
        if (text.includes('FROM fg_usuario_planta')) {
            return { rowCount: 1, rows: [{ plantas_key: '98' }] };
        }
        if (text.includes('FROM fg_certificado_vehiculo')) {
            return { rowCount: 1, rows: [vehiculoMockCompleto] };
        }
        if (text.includes('FROM fg_certificado_titular')) {
            return { rowCount: 1, rows: [titularMockCompleto] };
        }
        if (text.includes('FROM fg_orden_pago')) {
            return { rowCount: 1, rows: [ordenPagoMockCompleto] };
        }
        if (text.includes('FROM fg_certificado_chip')) {
            return { rowCount: 0, rows: [] };
        }
        if (text.includes('FROM fg_facturacion')) {
            return {
                rowCount: 1,
                rows: [{
                    id: 771,
                    tipo_comprobante: 'BOLETA',
                    condicion_pago: 'CONTADO',
                    estado: 'PENDIENTE_SUNAT',
                    serie: 'BBB1',
                    numero: 217,
                    nro_comprobante: 'BBB1-00000217',
                    entorno_facturador: 'DEMO',
                    proveedor: 'NUBEFACT',
                    enlace_pdf: 'http://test.pdf',
                    enlace_xml: 'http://test.xml'
                }]
            };
        }
        if (text.includes('FROM fg_documento_anulacion')) {
            return { rowCount: 0, rows: [] };
        }
        if (text.includes('FROM fg_certificado_glp WHERE certificado_id = $1')) {
            return {
                rowCount: 1,
                rows: [{
                    modalidad: 'INICIAL',
                    taller_autorizado_id: 2,
                    vigencia_hasta: '2026-10-31'
                }]
            };
        }
        if (text.includes('FROM fg_certificado_glp_componente')) {
            return {
                rowCount: 2,
                rows: [
                    {
                        componente: 'CILINDRO',
                        marca: 'FABRICANTE GLP',
                        modelo: null, // Sin modelo
                        capacidad_litros: 48,
                        mes_fabricacion: 10,
                        anio_fabricacion: 2025,
                        numero_serie: 'CIL-9988'
                    },
                    {
                        componente: 'REGULADOR',
                        marca: 'REGULADORES SAC',
                        modelo: 'TOMAS-AT09',
                        numero_serie: 'REG-1122'
                    }
                ]
            };
        }
        if (text.includes('FROM fg_certificado_glp_verificacion')) {
            return {
                rowCount: 7,
                rows: ['1','2','3','4','5','6','7'].map(c => ({ codigo: c, cumple: true }))
            };
        }
        return { rowCount: 0, rows: [] };
    };

    try {
        const resultado = await certService.validarEmision(900, { username: 'gibarra', perfil_id: 'SISTEMAS' });
        assert.equal(resultado.valido, true, `Errores: ${JSON.stringify(resultado.errores)}`);
        assert.equal(resultado.errores.length, 0);
    } finally {
        db.query = originalQuery;
    }
});

test('3. GLP Inicial: componente CILINDRO con modelo opcional también es aceptado', async () => {
    const originalQuery = db.query;

    db.query = async (sql, params = []) => {
        const text = String(sql);
        if (text.includes('SELECT c.*, t.clave AS tipo_clave')) {
            return {
                rowCount: 1,
                rows: [{
                    id: 901,
                    tipo_certificado_clave: 'GLP_ANUAL',
                    tipo_clave: 'GLP_ANUAL',
                    planta_key: '98',
                    estado: 'BORRADOR',
                    numero_certificado: null,
                    servicio_tipo_flujo: null
                }]
            };
        }
        if (text.includes('FROM fg_planta')) {
            return { rowCount: 1, rows: [{ key: '98', nombre: 'SURCO' }] };
        }
        if (text.includes('FROM fg_usuario_planta')) {
            return { rowCount: 1, rows: [{ plantas_key: '98' }] };
        }
        if (text.includes('FROM fg_certificado_vehiculo')) {
            return { rowCount: 1, rows: [vehiculoMockCompleto] };
        }
        if (text.includes('FROM fg_certificado_titular')) {
            return { rowCount: 1, rows: [titularMockCompleto] };
        }
        if (text.includes('FROM fg_orden_pago')) {
            return { rowCount: 1, rows: [ordenPagoMockCompleto] };
        }
        if (text.includes('FROM fg_certificado_chip')) return { rowCount: 0, rows: [] };
        if (text.includes('FROM fg_facturacion')) {
            return {
                rowCount: 1,
                rows: [{
                    id: 772,
                    tipo_comprobante: 'BOLETA',
                    condicion_pago: 'CONTADO',
                    estado: 'PENDIENTE_SUNAT',
                    serie: 'BBB1',
                    numero: 218,
                    nro_comprobante: 'BBB1-00000218',
                    entorno_facturador: 'DEMO',
                    proveedor: 'NUBEFACT',
                    enlace_pdf: 'http://test.pdf'
                }]
            };
        }
        if (text.includes('FROM fg_documento_anulacion')) return { rowCount: 0, rows: [] };
        if (text.includes('FROM fg_certificado_glp WHERE certificado_id = $1')) {
            return { rowCount: 1, rows: [{ modalidad: 'INICIAL', taller_autorizado_id: 2, vigencia_hasta: '2026-10-31' }] };
        }
        if (text.includes('FROM fg_certificado_glp_componente')) {
            return {
                rowCount: 2,
                rows: [
                    {
                        componente: 'CILINDRO',
                        marca: 'FABRICANTE GLP',
                        modelo: 'TOROIDAL-60', // Con modelo explícito
                        capacidad_litros: 48,
                        mes_fabricacion: 10,
                        anio_fabricacion: 2025,
                        numero_serie: 'CIL-9988'
                    },
                    {
                        componente: 'REGULADOR',
                        marca: 'REGULADORES SAC',
                        modelo: 'TOMAS-AT09',
                        numero_serie: 'REG-1122'
                    }
                ]
            };
        }
        if (text.includes('FROM fg_certificado_glp_verificacion')) {
            return { rowCount: 7, rows: ['1','2','3','4','5','6','7'].map(c => ({ codigo: c, cumple: true })) };
        }
        return { rowCount: 0, rows: [] };
    };

    try {
        const resultado = await certService.validarEmision(901, { username: 'gibarra', perfil_id: 'SISTEMAS' });
        assert.equal(resultado.valido, true, `Errores: ${JSON.stringify(resultado.errores)}`);
        assert.equal(resultado.errores.length, 0);
    } finally {
        db.query = originalQuery;
    }
});

test('4. Prevalidación: Bloquea facturación e impide llamada a NubeFact si la emisión técnica no está lista', async () => {
    let nubefactInvocado = false;
    let reservaFiscalPersistida = false;
    const dependenciasMock = {
        nubefactService: {
            obtenerEstadoConfiguracion: () => ({ enabled: true }),
            emitirComprobante: async () => {
                nubefactInvocado = true;
                throw new Error('NubeFact no debe invocarse con un titular incompleto');
            }
        },
        certificadosService: {
            validarEmision: async (id, user, options) => {
                assert.equal(id, 902);
                assert.equal(user.username, 'bruno');
                assert.equal(user.perfil_id, 'OPERADOR');
                assert.equal(options.ignorarComprobanteNoEmitido, true);
                assert.equal(options.ignorarChipNoConsumido, true);
                return {
                    valido: false,
                    errores: [{
                        seccion: 'titular',
                        campo: 'nro_documento',
                        codigo: 'CAMPO_REQUERIDO',
                        mensaje: 'Nro documento requerido'
                    }]
                };
            }
        }
    };

    const originalConnect = db.connect;
    const originalQuery = db.query;

    const mockQueryHandler = async (sql) => {
        const text = String(sql);
        if (text.includes('INSERT INTO fg_facturacion_intento') || text.includes("estado = 'PENDIENTE'")) {
            reservaFiscalPersistida = true;
        }
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rowCount: 0, rows: [] };
        if (text.includes('FROM fg_certificado')) {
            return {
                rowCount: 1,
                rows: [{
                    id: 902,
                    estado: 'BORRADOR',
                    planta_key: '102',
                    tipo_certificado_clave: 'GLP_ANUAL',
                    servicio_tipo_flujo: null
                }]
            };
        }
        if (text.includes('FROM fg_planta')) {
            return { rowCount: 1, rows: [{ key: '102', nombre: 'SAN MIGUEL' }] };
        }
        if (text.includes('FROM fg_usuario_planta')) {
            return { rowCount: 1, rows: [{ plantas_key: '102' }] };
        }
        if (text.includes('FROM fg_facturacion')) {
            return { rowCount: 1, rows: [{ id: 773, estado: 'BORRADOR', condicion_pago: 'CONTADO' }] };
        }
        if (text.includes('FROM fg_orden_pago')) {
            return { rowCount: 1, rows: [{ estado: 'PAGADO', saldo_pendiente: 0 }] };
        }
        if (text.includes('FROM fg_certificado_chip')) {
            return { rowCount: 0, rows: [] };
        }
        if (text.includes('FROM fg_facturacion_cuota')) {
            return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
    };

    db.query = mockQueryHandler;
    db.connect = async () => ({
        query: mockQueryHandler,
        release() {}
    });

    try {
        await assert.rejects(
            async () => {
                await factService.emitirFacturacion(902, { username: 'bruno', perfil_id: 'OPERADOR' }, dependenciasMock);
            },
            (err) => {
                assert.equal(err.code, 'CERTIFICADO_NO_VALIDO_PARA_EMISION');
                assert.ok(err.detalles?.mensaje?.includes('Nro documento requerido'));
                return true;
            }
        );
        assert.equal(nubefactInvocado, false, 'No debe invocarse a NubeFact si la prevalidación técnica falla');
        assert.equal(reservaFiscalPersistida, false, 'No debe reservar serie ni crear un intento fiscal si la prevalidación falla');
    } finally {
        db.connect = originalConnect;
        db.query = originalQuery;
    }
});

test('4.1. Titular GLP: backend rechaza el mismo snapshot incompleto observado en San Miguel', () => {
    const { validarDatosTitularCompletos } = certService._private;
    assert.throws(
        () => validarDatosTitularCompletos({
            tipoDocumento: 'DNI',
            nroDocumento: null,
            nombreRazonSocial: 'HYDRANSA E.I.R.L.'
        }),
        (error) => {
            assert.equal(error.message, 'TITULAR_DATOS_INCOMPLETOS');
            assert.deepEqual(error.detalles.campos, ['nroDocumento']);
            return true;
        }
    );

    assert.doesNotThrow(() => validarDatosTitularCompletos({
        tipoDocumento: 'RUC',
        nroDocumento: '20612146072',
        nombreRazonSocial: 'HYDRANSA E.I.R.L.'
    }));
    assert.throws(
        () => validarDatosTitularCompletos({
            tipoDocumento: 'DNI',
            nroDocumento: '1234',
            nombreRazonSocial: 'TITULAR CON DNI INVALIDO'
        }),
        (error) => error.message === 'TITULAR_DATOS_INCOMPLETOS'
            && error.detalles.campos.includes('nroDocumento')
    );
});

test('4.2. Controlador: el bloqueo técnico conserva HTTP 400 y muestra el campo pendiente', async () => {
    const originalEmitir = factService.emitirFacturacion;
    factService.emitirFacturacion = async () => {
        const error = new Error('CERTIFICADO_NO_VALIDO_PARA_EMISION');
        error.code = 'CERTIFICADO_NO_VALIDO_PARA_EMISION';
        error.statusCode = 400;
        error.detalles = {
            mensaje: 'No se puede emitir el comprobante porque el certificado presenta observaciones técnicas: Nro documento requerido',
            errores: [{ campo: 'nro_documento', mensaje: 'Nro documento requerido' }]
        };
        throw error;
    };

    const respuesta = { statusCode: null, body: null };
    const res = {
        status(code) {
            respuesta.statusCode = code;
            return this;
        },
        json(body) {
            respuesta.body = body;
            return body;
        }
    };

    try {
        await factController.emitir({ params: { id: '668' }, user: { username: 'bruno', perfil_id: 'OPERADOR' } }, res);
        assert.equal(respuesta.statusCode, 400);
        assert.equal(respuesta.body.codigo, 'CERTIFICADO_NO_VALIDO_PARA_EMISION');
        assert.match(respuesta.body.message, /Nro documento requerido/);
    } finally {
        factService.emitirFacturacion = originalEmitir;
    }
});

test('5. Recuperación de emisión parcial: Comprobante ya emitido se reutiliza sin duplicar llamada a NubeFact', async () => {
    let nubefactInvocado = false;
    const dependenciasMock = {
        nubefactService: {
            obtenerEstadoConfiguracion: () => ({ enabled: true })
        },
        proveedor: {
            emitirComprobante: async () => {
                nubefactInvocado = true;
                throw new Error('NubeFact no debió ser llamado');
            }
        }
    };

    const originalConnect = db.connect;
    const originalQuery = db.query;

    const mockQueryHandler = async (sql) => {
        const text = String(sql);
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rowCount: 0, rows: [] };
        if (text.includes('FROM fg_certificado')) {
            return {
                rowCount: 1,
                rows: [{
                    id: 903,
                    estado: 'BORRADOR',
                    planta_key: '98',
                    tipo_certificado_clave: 'GLP_ANUAL',
                    servicio_tipo_flujo: null
                }]
            };
        }
        if (text.includes('FROM fg_planta')) {
            return { rowCount: 1, rows: [{ key: '98', nombre: 'SURCO' }] };
        }
        if (text.includes('FROM fg_usuario_planta')) {
            return { rowCount: 1, rows: [{ plantas_key: '98' }] };
        }
        if (text.includes('FROM fg_facturacion')) {
            return {
                rowCount: 1,
                rows: [{
                    id: 774,
                    certificado_id: 903,
                    estado: 'PENDIENTE_SUNAT', // Ya emitido previamente
                    serie: 'BBB1',
                    numero: 218,
                    nro_comprobante: 'BBB1-00000218',
                    total: 90
                }]
            };
        }
        if (text.includes('FROM fg_orden_pago')) {
            return { rowCount: 1, rows: [{ estado: 'PAGADO', saldo_pendiente: 0 }] };
        }
        if (text.includes('FROM fg_certificado_chip')) {
            return { rowCount: 0, rows: [] };
        }
        if (text.includes('FROM fg_facturacion_cuota')) {
            return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
    };

    db.query = mockQueryHandler;
    db.connect = async () => ({
        query: mockQueryHandler,
        release() {}
    });

    try {
        const resultado = await factService.emitirFacturacion(903, { username: 'gibarra', perfil_id: 'SISTEMAS' }, dependenciasMock);
        assert.equal(resultado.estado, 'PENDIENTE_SUNAT');
        assert.equal(resultado.nroComprobante, 'BBB1-00000218');
        assert.equal(nubefactInvocado, false, 'No debe llamarse a NubeFact si el comprobante ya está resuelto');
    } finally {
        db.connect = originalConnect;
        db.query = originalQuery;
    }
});
