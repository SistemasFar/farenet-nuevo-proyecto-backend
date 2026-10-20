const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const certificados = require('../services/faregas-certificados.service');
const { validarFacturacion } = require('../services/faregas-facturacion.rules');

test('Facturación: email opcional permite omitir, null y vacío, y valida formato si viene', () => {
    // 1. Correo omitido/null/vacío
    const sinEmail = {
        tipoComprobante: 'BOLETA',
        tipoDocumentoCliente: 'DNI',
        nroDocumento: '74045612',
        nombreRazonSocial: 'JUAN PEREZ',
        direccion: 'AV. PRINCIPAL 123',
        email: null,
        telefono: '987654321',
        condicionPago: 'CONTADO',
        cuotas: []
    };
    assert.deepEqual(validarFacturacion(sinEmail), []);

    const emailVacio = {
        ...sinEmail,
        email: ''
    };
    assert.deepEqual(validarFacturacion(emailVacio), []);

    // 2. Correo válido
    const emailValido = {
        ...sinEmail,
        email: 'cliente@faregas.pe'
    };
    assert.deepEqual(validarFacturacion(emailValido), []);

    // 3. Correo inválido
    const emailInvalido = {
        ...sinEmail,
        email: 'formato-invalido'
    };
    const errores = validarFacturacion(emailInvalido);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /correo electronico no tiene un formato valido/i);
});

test('Backend validarEmision: vigencia anterior a hoy en America/Lima es rechazada con FECHA_VENCIDA', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    const originalQuery = db.query;

    const hoyPeru = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());

    const dateAyer = new Date();
    dateAyer.setDate(dateAyer.getDate() - 2);
    const ayerPeru = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(dateAyer);

    const dateManana = new Date();
    dateManana.setDate(dateManana.getDate() + 30);
    const mananaPeru = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(dateManana);

    const setupDbMock = (vigenciaDate) => ({
        query: async (sql) => {
            if (sql.includes('FROM fg_certificado c')) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: 901,
                        tipo_clave: 'GLP_ANUAL',
                        tipo_certificado_clave: 'GLP_ANUAL',
                        estado: 'BORRADOR',
                        planta_key: '98',
                        tarifa_codigo: 'GLP01',
                        servicio_tipo_flujo: 'CERTIFICACION',
                        servicio_modalidad: 'ANUAL'
                    }]
                };
            }
            if (sql.includes('FROM fg_certificado_vehiculo')) {
                return {
                    rowCount: 1,
                    rows: [{
                        certificado_id: 901,
                        categoria: 'M1',
                        marca: 'TOYOTA',
                        modelo: 'YARIS',
                        version: 'STD',
                        anio_fabricacion: 2020,
                        vin: '9BD1234567890',
                        numero_motor: 'MOT123',
                        numero_cilindros: 4,
                        cilindrada: 1500,
                        combustible: 'GASOLINA',
                        numero_ejes: 2,
                        numero_ruedas: 4,
                        numero_asientos: 5,
                        numero_pasajeros: 4,
                        longitud: 4.2,
                        ancho: 1.7,
                        alto: 1.5,
                        peso_neto: 1100,
                        peso_bruto: 1500,
                        carga_util: 400
                    }]
                };
            }
            if (sql.includes('FROM fg_certificado_titular')) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: 1,
                        tipo_documento: 'DNI',
                        nro_documento: '74045612',
                        nombre_razon_social: 'JUAN PEREZ'
                    }]
                };
            }
            if (sql.includes('FROM fg_certificado_glp WHERE')) {
                return {
                    rowCount: 1,
                    rows: [{
                        certificado_id: 901,
                        modalidad: 'ANUAL',
                        taller_autorizado_id: 10,
                        vigencia_hasta: vigenciaDate
                    }]
                };
            }
            if (sql.includes('FROM fg_certificado_glp_componente')) {
                return {
                    rowCount: 2,
                    rows: [
                        { componente: 'CILINDRO', marca: 'FABER', numero_serie: 'CIL123', capacidad_litros: 60, anio_fabricacion: 2020 },
                        { componente: 'REGULADOR', marca: 'TOMASETTO', numero_serie: 'REG456', modelo: 'AT09' }
                    ]
                };
            }
            if (sql.includes('FROM fg_facturacion WHERE')) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: 555,
                        estado: 'ACEPTADO',
                        tipo_comprobante: 'BOLETA',
                        nro_documento: '74045612',
                        nombre_razon_social: 'JUAN PEREZ',
                        email: null // Facturación sin email es válida
                    }]
                };
            }
            if (sql.includes('FROM fg_documento_anulacion')) {
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 0, rows: [] };
        },
        release: () => {}
    });

    db.connect = async () => setupDbMock(ayerPeru);
    db.query = async (sql, params) => setupDbMock(ayerPeru).query(sql, params);
    authService.validarAccesoPlanta = async () => true;

    try {
        // Con fecha de ayer: debe rechazar con FECHA_VENCIDA
        const resultadoAyer = await certificados.validarEmision(901, { username: 'test', perfil_id: 1, planta_key: '98' });
        assert.equal(resultadoAyer.valido, false);
        const errorVigencia = resultadoAyer.errores.find(e => e.campo === 'vigencia_hasta');
        assert.ok(errorVigencia, 'Debe haber un error para vigencia_hasta');
        assert.equal(errorVigencia.codigo, 'FECHA_VENCIDA');
        assert.match(errorVigencia.mensaje, /no puede ser anterior a la fecha actual/i);

        // Con fecha de mañana (o futura): no debe tener error de vigencia
        db.connect = async () => setupDbMock(mananaPeru);
        db.query = async (sql, params) => setupDbMock(mananaPeru).query(sql, params);

        const resultadoManana = await certificados.validarEmision(901, { username: 'test', perfil_id: 1, planta_key: '98' });
        const errorVigenciaManana = resultadoManana.errores.find(e => e.campo === 'vigencia_hasta');
        assert.equal(errorVigenciaManana, undefined, 'No debe haber error de vigencia para fecha futura');

        // Con fecha de hoy: tampoco debe tener error de vigencia
        db.connect = async () => setupDbMock(hoyPeru);
        db.query = async (sql, params) => setupDbMock(hoyPeru).query(sql, params);

        const resultadoHoy = await certificados.validarEmision(901, { username: 'test', perfil_id: 1, planta_key: '98' });
        const errorVigenciaHoy = resultadoHoy.errores.find(e => e.campo === 'vigencia_hasta');
        assert.equal(errorVigenciaHoy, undefined, 'No debe haber error de vigencia para fecha de hoy');
    } finally {
        db.connect = originalConnect;
        db.query = originalQuery;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test.after(async () => {
    if (db && typeof db.end === 'function') {
        await db.end();
    }
});
