const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const certificados = require('../services/faregas-certificados.service');
const generateGlpInicialHtml = require('../templates/glp-inicial.template');

const setupMockDb = ({
    tipoCertificadoClave = 'GLP_ANUAL',
    modalidad = 'INICIAL',
    combustibleGuardado = 'GASOLINA',
    onVehiculoInsert = null,
} = {}) => {
    return {
        async query(sql, params = []) {
            const texto = String(sql);
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto)) {
                return { rowCount: 0, rows: [] };
            }
            if (texto.includes('SELECT estado, planta_key FROM fg_certificado WHERE id = $1')) {
                return {
                    rowCount: 1,
                    rows: [{ estado: 'BORRADOR', planta_key: '160' }]
                };
            }
            if (texto.includes('SELECT c.tipo_certificado_clave') && texto.includes('glp_modalidad')) {
                return {
                    rowCount: 1,
                    rows: [{
                        tipo_certificado_clave: tipoCertificadoClave,
                        glp_modalidad: modalidad
                    }]
                };
            }
            if (/SELECT\s+c\.\*,\s+t\.clave\s+AS\s+tipo_clave/i.test(texto)) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: 900,
                        estado: 'BORRADOR',
                        planta_key: '160',
                        tipo_clave: tipoCertificadoClave,
                        servicio_modalidad: modalidad,
                        formato_version_motor: 'LEGACY',
                        formato_version_configuracion: null
                    }]
                };
            }
            if (texto.includes('SELECT 1') && texto.includes('FROM fg_facturacion')) {
                return { rowCount: 0, rows: [] };
            }
            if (texto.includes('SELECT combustible') && texto.includes('FROM fg_certificado_vehiculo')) {
                return {
                    rowCount: 1,
                    rows: [{ combustible: combustibleGuardado }]
                };
            }
            if (texto.includes('INSERT INTO fg_certificado_vehiculo')) {
                if (onVehiculoInsert) onVehiculoInsert(params, texto);
                return { rowCount: 1, rows: [] };
            }
            if (texto.includes('SELECT * FROM fg_certificado_glp') || texto.includes('FROM fg_certificado_glp')) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: 1,
                        certificado_id: 900,
                        modalidad,
                        taller_autorizado_id: 160
                    }]
                };
            }
            if (texto.includes('FROM fg_taller_autorizado')) {
                return {
                    rowCount: 1,
                    rows: [{ id: 160, razon_social: 'TALLER SURQUILLO', sede: 'SURQUILLO', estado: true }]
                };
            }
            if (texto.includes('SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1')) {
                return {
                    rowCount: 1,
                    rows: [{
                        certificado_id: 900,
                        placa: 'ABC-123',
                        marca: 'TOYOTA',
                        modelo: 'COROLLA',
                        combustible: combustibleGuardado,
                        anio_fabricacion: 2020,
                        vin: '12345678901234567',
                        numero_motor: 'M123',
                        color: 'BLANCO',
                        cilindrada: 1600,
                        numero_cilindros: 4,
                        numero_ejes: 2,
                        numero_ruedas: 4,
                        numero_asientos: 5,
                        numero_pasajeros: 4,
                        peso_neto: 1200,
                        peso_bruto: 1600,
                        carga_util: 400,
                        longitud: 4.5,
                        ancho: 1.7,
                        alto: 1.4
                    }]
                };
            }
            if (texto.includes('SELECT * FROM fg_certificado_titular')) {
                return {
                    rowCount: 1,
                    rows: [{ id: 1, tipo_documento: 'DNI', numero_documento: '12345678', nombre_razon_social: 'JUAN PEREZ' }]
                };
            }
            if (texto.includes('FROM fg_certificado_glp_componente')) {
                return {
                    rowCount: 2,
                    rows: [
                        { tipo_componente: 'CILINDRO', marca: 'CIL', numero_serie: 'S1', modelo: 'M1', capacidad_litros: 40, anio_fabricacion: 2024, mes_fabricacion: '01' },
                        { tipo_componente: 'REGULADOR', marca: 'REG', numero_serie: 'S2', modelo: 'M2' }
                    ]
                };
            }
            if (texto.includes('FROM fg_certificado_glp_verificacion')) {
                return { rowCount: 0, rows: [] };
            }
            if (texto.includes('FROM fg_formato_inspeccion_version')) {
                return { rowCount: 0, rows: [] };
            }
            if (texto.includes('SELECT id FROM fg_facturacion')) {
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 0, rows: [] };
        },
        release() {}
    };
};

test('GLP INICIAL: guardarVehiculoBorrador acepta GASOLINA', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    let vehiculoParams = null;

    db.connect = async () => setupMockDb({
        tipoCertificadoClave: 'GLP_ANUAL',
        modalidad: 'INICIAL',
        onVehiculoInsert: (params) => { vehiculoParams = params; }
    });
    authService.validarAccesoPlanta = async () => true;

    try {
        await certificados.guardarVehiculoBorrador(900, {
            placa: 'ABC-123',
            combustible: 'GASOLINA',
            marca: 'TOYOTA'
        }, { username: 'test', perfil_id: 1 });

        assert.ok(vehiculoParams, 'Debe haber guardado el vehículo');
        // Combustible is at index 12 in fg_certificado_vehiculo insert
        assert.equal(vehiculoParams[12], 'GASOLINA');
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('GLP INICIAL: guardarVehiculoBorrador acepta DIESEL', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    let vehiculoParams = null;

    db.connect = async () => setupMockDb({
        tipoCertificadoClave: 'GLP_ANUAL',
        modalidad: 'INICIAL',
        onVehiculoInsert: (params) => { vehiculoParams = params; }
    });
    authService.validarAccesoPlanta = async () => true;

    try {
        await certificados.guardarVehiculoBorrador(900, {
            placa: 'ABC-123',
            combustible: 'DIESEL',
            marca: 'TOYOTA'
        }, { username: 'test', perfil_id: 1 });

        assert.ok(vehiculoParams, 'Debe haber guardado el vehículo');
        assert.equal(vehiculoParams[12], 'DIESEL');
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('GLP INICIAL: guardarVehiculoBorrador rechaza GLP, GNV y otros valores no permitidos', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;

    db.connect = async () => setupMockDb({
        tipoCertificadoClave: 'GLP_ANUAL',
        modalidad: 'INICIAL'
    });
    authService.validarAccesoPlanta = async () => true;

    const combustiblesInvalidos = ['GLP', 'GNV', 'BI COMBUSTIBLE GLP', 'GAS', 'HIBRIDO', 'ELECTRICIDAD'];

    try {
        for (const comb of combustiblesInvalidos) {
            await assert.rejects(
                certificados.guardarVehiculoBorrador(900, {
                    placa: 'ABC-123',
                    combustible: comb,
                    marca: 'TOYOTA'
                }, { username: 'test', perfil_id: 1 }),
                (err) => err.code === 'GLP_INICIAL_COMBUSTIBLE_INVALIDO',
                `Debe rechazar combustible "${comb}" con código GLP_INICIAL_COMBUSTIBLE_INVALIDO`
            );
        }
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('GLP ANUAL: guardarVehiculoBorrador no impone restricción exclusiva de GASOLINA/DIESEL', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    let vehiculoParams = null;

    db.connect = async () => setupMockDb({
        tipoCertificadoClave: 'GLP_ANUAL',
        modalidad: 'ANUAL',
        onVehiculoInsert: (params) => { vehiculoParams = params; }
    });
    authService.validarAccesoPlanta = async () => true;

    try {
        await certificados.guardarVehiculoBorrador(900, {
            placa: 'ABC-123',
            combustible: 'BI COMBUSTIBLE GLP',
            marca: 'TOYOTA'
        }, { username: 'test', perfil_id: 1 });

        assert.ok(vehiculoParams, 'Debe haber guardado sin error para GLP ANUAL');
        assert.equal(vehiculoParams[12], 'BI COMBUSTIBLE GLP');
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('GNV ANUAL: conserva la opción GNV para vehículos que usan sólo GNV', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    let vehiculoParams = null;

    db.connect = async () => setupMockDb({
        tipoCertificadoClave: 'GNV_ANUAL',
        modalidad: 'ANUAL',
        onVehiculoInsert: (params) => { vehiculoParams = params; }
    });
    authService.validarAccesoPlanta = async () => true;

    try {
        await certificados.guardarVehiculoBorrador(900, {
            placa: 'GNV-100',
            combustible: 'GNV',
            marca: 'CAMION'
        }, { username: 'test', perfil_id: 1 });

        assert.ok(vehiculoParams, 'Debe haber guardado el vehículo GNV');
        assert.equal(vehiculoParams[12], 'GNV');
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('GNV ANUAL: reemplaza un combustible heredado por BI-COMBUSTIBLE GNV', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    let vehiculoParams = null;

    db.connect = async () => setupMockDb({
        tipoCertificadoClave: 'GNV_ANUAL',
        modalidad: 'ANUAL',
        onVehiculoInsert: (params) => { vehiculoParams = params; }
    });
    authService.validarAccesoPlanta = async () => true;

    try {
        await certificados.guardarVehiculoBorrador(900, {
            placa: 'GNV-200',
            combustible: 'DIESEL',
            marca: 'CAMION'
        }, { username: 'test', perfil_id: 1 });

        assert.ok(vehiculoParams, 'Debe haber guardado el vehículo GNV');
        assert.equal(vehiculoParams[12], 'BI-COMBUSTIBLE GNV');
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('GLP INICIAL: validarEmision rechaza un borrador antiguo con combustible inválido (ej. GLP o GNV)', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    const originalQuery = db.query;

    const mockDb = setupMockDb({
        tipoCertificadoClave: 'GLP_ANUAL',
        modalidad: 'INICIAL',
        combustibleGuardado: 'GLP'
    });
    db.connect = async () => mockDb;
    db.query = async (sql, params) => mockDb.query(sql, params);
    authService.validarAccesoPlanta = async () => true;

    try {
        const resultado = await certificados.validarEmision(900, { username: 'test', perfil_id: 1 });
        assert.equal(resultado.valido, false);
        assert.ok(
            resultado.errores.some(e => e.codigo === 'GLP_INICIAL_COMBUSTIBLE_INVALIDO' || (e.mensaje && e.mensaje.includes('GASOLINA o DIESEL'))),
            'Debe contener error indicando que combustible debe ser GASOLINA o DIESEL'
        );
    } finally {
        db.connect = originalConnect;
        db.query = originalQuery;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('GLP INICIAL: validarEmision aprueba borrador con combustible GASOLINA', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    const originalQuery = db.query;

    const mockDb = setupMockDb({
        tipoCertificadoClave: 'GLP_ANUAL',
        modalidad: 'INICIAL',
        combustibleGuardado: 'GASOLINA'
    });
    db.connect = async () => mockDb;
    db.query = async (sql, params) => mockDb.query(sql, params);
    authService.validarAccesoPlanta = async () => true;

    try {
        const resultado = await certificados.validarEmision(900, { username: 'test', perfil_id: 1 });
        const erroresCombustible = resultado.errores.filter(e => e.codigo === 'GLP_INICIAL_COMBUSTIBLE_INVALIDO' || (e.mensaje && e.mensaje.includes('GASOLINA o DIESEL')));
        assert.equal(erroresCombustible.length, 0, 'No debe haber errores de combustible para GASOLINA');
    } finally {
        db.connect = originalConnect;
        db.query = originalQuery;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('GLP INICIAL: plantilla HTML/PDF renderiza ítem 11 con GASOLINA y con DIESEL', () => {
    const htmlGasolina = generateGlpInicialHtml({
        cabecera: { numero_certificado: 'DG-41-000100' },
        vehiculo: { combustible: 'GASOLINA', placa: 'ABC-123' },
        glp: {},
        componentes: [],
        verificaciones: [],
        titulares: [{ nombre_razon_social: 'PROPIETARIO TEST' }]
    }, { modo: 'FINAL' });

    assert.match(htmlGasolina, /<td>Combustible<\/td>\s*<td class="val"[^>]*>GASOLINA<\/td>/);

    const htmlDiesel = generateGlpInicialHtml({
        cabecera: { numero_certificado: 'DG-41-000101' },
        vehiculo: { combustible: 'DIESEL', placa: 'XYZ-789' },
        glp: {},
        componentes: [],
        verificaciones: [],
        titulares: [{ nombre_razon_social: 'PROPIETARIO TEST' }]
    }, { modo: 'FINAL' });

    assert.match(htmlDiesel, /<td>Combustible<\/td>\s*<td class="val"[^>]*>DIESEL<\/td>/);
});

test('GLP INICIAL: plantilla HTML/PDF renderiza ítems 12 y 13 con formato de dos dígitos (cero adelante)', () => {
    const html = generateGlpInicialHtml({
        cabecera: { numero_certificado: 'DG-41-000100' },
        vehiculo: {
            combustible: 'GASOLINA',
            placa: 'ABC-123',
            ejes: '2',
            ruedas: '2',
            asientos: '2',
            pasajeros: '1'
        },
        glp: {},
        componentes: [],
        verificaciones: [],
        titulares: [{ nombre_razon_social: 'PROPIETARIO TEST' }]
    }, { modo: 'FINAL' });

    assert.match(html, /<td>N° ejes \/ N° ruedas<\/td>\s*<td class="val"[^>]*>02 \/ 02<\/td>/);
    assert.match(html, /<td>N° Asientos \/ Pasajeros<\/td>\s*<td class="val"[^>]*>02 \/ 01<\/td>/);
});
