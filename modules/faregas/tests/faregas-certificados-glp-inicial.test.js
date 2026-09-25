const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const service = require('../services/faregas-certificados.service');

const usuario = { username: 'OPERADOR_PRUEBA', perfil_id: 'SISTEMAS', planta_key: '201' };

const normalizar = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const lista = (items) => ({ rowCount: items.length, rows: items });

const VEHICULO_COMPLETO = {
    placa: 'ABC123',
    vin: 'HZ1110WKR295C0031',
    serie_chasis: 'HZ1110WKR295C0031',
    categoria: 'N3',
    marca: 'TOYOTA',
    modelo: 'YARIS',
    version: '1222',
    anio_fabricacion: '2010',
    numero_motor: 'HZ1110WKR295C0031',
    numero_cilindros: 4,
    cilindrada: '11110.000',
    combustible: 'BI COMBUSTIBLE/GNV',
    numero_ejes: 2,
    numero_ruedas: 4,
    numero_asientos: 5,
    numero_pasajeros: 5,
    longitud: '4.300',
    ancho: '1.690',
    alto: '1.460',
    peso_neto: '1301.000',
    peso_bruto: '1450.000',
    carga_util: '149.000'
};

const GLP_INICIAL_COMPLETO = {
    taller_autorizado_id: 2,
    expediente_tecnico: 'DDDD',
    vigencia_hasta: '2026-09-17T05:00:00.000Z',
    modalidad: 'INICIAL',
    taller_razon_social: 'TALLER AUTORIZADO SURQUILLO',
    taller_sede: 'SURQUILLO',
    combustible_posterior: 'BI-COMBUSTIBLE GLP',
    peso_neto_posterior: null,
    carga_util_posterior: null
};

const COMPONENTES_COMPLETOS = [
    {
        componente: 'CILINDRO',
        marca: 'TIAMET',
        modelo: 'CIL-10',
        numero_serie: 'SER-001',
        capacidad_litros: '10',
        mes_fabricacion: '03',
        anio_fabricacion: '2024'
    },
    { componente: 'REGULADOR', marca: 'MASE', modelo: 'REG-10' }
];

const VERIFICACIONES_COMPLETAS = ['1', '2', '3', '4', '5', '6', '7']
    .map(codigo => ({ codigo, cumple: true, observacion: null }));

/**
 * Fixture base de un certificado GLP completo. Cada test sustituye sólo la
 * parte que quiere romper, de modo que cualquier error observado proviene
 * del dato alterado y no de un falta colateral del fixture.
 */
const crearFixture = (overrides = {}) => ({
    cert: {
        id: 900,
        estado: 'BORRADOR',
        planta_key: '201',
        tipo_clave: 'GLP_ANUAL',
        tipo_certificado_clave: 'GLP_ANUAL',
        tarifa_codigo: 'GLP_INICIAL',
        modalidad: 'INICIAL',
        numero_certificado: null,
        formato_version_id: null,
        producto_chip_id: null,
        observaciones: null,
        servicio_tipo_flujo: 'CERTIFICACION',
        ...(overrides.cert || {})
    },
    vehiculo: 'vehiculo' in overrides ? overrides.vehiculo : { ...VEHICULO_COMPLETO },
    titulares: 'titulares' in overrides ? overrides.titulares : [
        { tipo_documento: 'DNI', nro_documento: '32332244', nombre_razon_social: 'SSSS' }
    ],
    ordenPago: 'ordenPago' in overrides ? overrides.ordenPago : {
        estado: 'PAGADO',
        importe_total: 80,
        importe_pagado: 80,
        saldo_pendiente: 0
    },
    facturacion: 'facturacion' in overrides ? overrides.facturacion : {
        id: 500,
        estado: 'ACEPTADO',
        nro_comprobante: 'BBB1-00000061',
        aceptada_sunat: true,
        entorno_facturador: 'DEMO',
        proveedor: 'NUBEFACT',
        serie: 'BBB1',
        numero: '61'
    },
    anulaciones: 'anulaciones' in overrides ? overrides.anulaciones : [],
    glp: 'glp' in overrides ? overrides.glp : { ...GLP_INICIAL_COMPLETO },
    componentes: 'componentes' in overrides ? overrides.componentes : COMPONENTES_COMPLETOS.map(c => ({ ...c })),
    verificaciones: 'verificaciones' in overrides
        ? overrides.verificaciones
        : VERIFICACIONES_COMPLETAS.map(v => ({ ...v }))
});

/**
 * db.query mínimo que responde sólo a las tablas que consulta validarEmision.
 * Cualquier consulta desconocida devuelve vacío para que una consulta nueva
 * no pase por alto la cobertura del fixture.
 */
const crearFakeDb = (fixture) => async (sqlCrudo) => {
    const sql = normalizar(sqlCrudo);
    if (sql.includes('FROM fg_certificado c')) return lista([fixture.cert]);
    if (sql.includes('FROM fg_certificado_vehiculo')) {
        return fixture.vehiculo ? lista([fixture.vehiculo]) : { rowCount: 0, rows: [] };
    }
    if (sql.includes('FROM fg_certificado_titular')) return lista(fixture.titulares);
    if (sql.includes('FROM fg_orden_pago')) {
        return fixture.ordenPago ? lista([fixture.ordenPago]) : { rowCount: 0, rows: [] };
    }
    if (sql.includes('FROM fg_certificado_chip')) return { rowCount: 0, rows: [] };
    if (sql.includes('FROM fg_facturacion')) {
        return fixture.facturacion ? lista([fixture.facturacion]) : { rowCount: 0, rows: [] };
    }
    if (sql.includes('FROM fg_documento_anulacion')) return lista(fixture.anulaciones);
    if (sql.includes('FROM fg_certificado_glp_componente')) return lista(fixture.componentes);
    if (sql.includes('FROM fg_certificado_glp_verificacion')) return lista(fixture.verificaciones);
    if (sql.includes('FROM fg_certificado_glp')) {
        return fixture.glp ? lista([fixture.glp]) : { rowCount: 0, rows: [] };
    }
    if (sql.includes('FROM fg_certificado_conformidad')) return { rowCount: 0, rows: [] };
    if (sql.includes('FROM fg_certificado_gnv')) return { rowCount: 0, rows: [] };
    return { rowCount: 0, rows: [] };
};

const validar = async (fixture) => {
    const dbOriginal = db.query;
    const accesoOriginal = authService.validarAccesoPlanta;
    db.query = crearFakeDb(fixture);
    authService.validarAccesoPlanta = async () => true;
    try {
        return await service.validarEmision(fixture.cert.id, usuario);
    } finally {
        db.query = dbOriginal;
        authService.validarAccesoPlanta = accesoOriginal;
    }
};

const codigos = (resultado) => resultado.errores.map(e => e.codigo);

test('GLP INICIAL completo se puede emitir: la modalidad ya no bloquea por formato', async () => {
    const resultado = await validar(crearFixture());

    assert.deepEqual(resultado.errores, [], 'un GLP INICIAL completo no debe tener errores');
    assert.equal(resultado.valido, true);
});

test('el código FORMATO_INICIAL_PENDIENTE ya no existe en el servicio', () => {
    const fuente = fs.readFileSync(
        path.join(__dirname, '..', 'services', 'faregas-certificados.service.js'),
        'utf8'
    );

    assert.equal(
        fuente.includes('FORMATO_INICIAL_PENDIENTE'),
        false,
        'el bloqueo de formato GLP INICIAL debe permanecer eliminado'
    );
});

test('GLP INICIAL sin taller autorizado sigue bloqueado', async () => {
    const fixture = crearFixture({ glp: { ...GLP_INICIAL_COMPLETO, taller_autorizado_id: null } });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('CAMPO_REQUERIDO'), true);
    assert.equal(resultado.valido, false);
});

test('GLP INICIAL sin expediente tecnico sigue bloqueado', async () => {
    const fixture = crearFixture({ glp: { ...GLP_INICIAL_COMPLETO, expediente_tecnico: null } });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('CAMPO_REQUERIDO'), true);
});

test('GLP INICIAL sin vigencia sigue bloqueado', async () => {
    const fixture = crearFixture({ glp: { ...GLP_INICIAL_COMPLETO, vigencia_hasta: null } });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('CAMPO_REQUERIDO'), true);
});

test('GLP INICIAL con modalidad no permitida sigue bloqueado', async () => {
    const fixture = crearFixture({ glp: { ...GLP_INICIAL_COMPLETO, modalidad: 'SEMESTRAL' } });

    const resultado = await validar(fixture);

    const errorModalidad = resultado.errores.find(e => e.codigo === 'CAMPO_REQUERIDO' && e.campo === 'modalidad');
    assert.ok(errorModalidad, 'debe exigir modalidad INICIAL o ANUAL');
});

test('GLP INICIAL sin CILINDRO sigue bloqueado', async () => {
    const fixture = crearFixture({
        componentes: [{ componente: 'REGULADOR', marca: 'MASE', modelo: 'REG-10' }]
    });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('COMPONENTE_REQUERIDO'), true);
});

test('GLP INICIAL sin REGULADOR sigue bloqueado', async () => {
    const fixture = crearFixture({
        componentes: [COMPONENTES_COMPLETOS[0]]
    });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('COMPONENTE_REQUERIDO'), true);
});

test('GLP INICIAL con CILINDRO incompleto sigue bloqueado', async () => {
    const fixture = crearFixture({
        componentes: [
            { ...COMPONENTES_COMPLETOS[0], numero_serie: null },
            COMPONENTES_COMPLETOS[1]
        ]
    });

    const resultado = await validar(fixture);

    const erroresComponente = resultado.errores.filter(e => e.seccion === 'glp' && e.codigo === 'CAMPO_REQUERIDO');
    assert.ok(erroresComponente.length > 0, 'debe exigir la serie del cilindro');
});

test('GLP INICIAL con verificacion faltante sigue bloqueado', async () => {
    const fixture = crearFixture({
        verificaciones: VERIFICACIONES_COMPLETAS.filter(v => v.codigo !== '4').map(v => ({ ...v }))
    });

    const resultado = await validar(fixture);

    const error = resultado.errores.find(e => e.codigo === 'VERIFICACIONES_INCOMPLETAS');
    assert.ok(error, 'debe reportar verificaciones incompletas');
    assert.match(error.mensaje, /4/);
});

test('GLP INICIAL con verificacion que NO CUMPLE y sin observacion sigue bloqueado', async () => {
    const verificaciones = VERIFICACIONES_COMPLETAS.map(v => (
        v.codigo === '2' ? { ...v, cumple: false, observacion: null } : { ...v }
    ));
    const fixture = crearFixture({ verificaciones });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('VERIFICACION_NO_CUMPLE'), true);
    assert.equal(codigos(resultado).includes('CAMPO_REQUERIDO'), true);
});

test('GLP INICIAL con verificacion que NO CUMPLE exige la observacion que la justifica', async () => {
    const verificaciones = VERIFICACIONES_COMPLETAS.map(v => (
        v.codigo === '2' ? { ...v, cumple: false, observacion: 'Falla el corte de gas' } : { ...v }
    ));
    const fixture = crearFixture({ verificaciones });

    const resultado = await validar(fixture);

    // La no conformidad siempre se reporta, pero con observacion ya no exige
    // un CAMPO_REQUERIDO adicional: el certificado puede emitirse declarandola.
    assert.equal(codigos(resultado).includes('VERIFICACION_NO_CUMPLE'), true);
    assert.equal(codigos(resultado).includes('CAMPO_REQUERIDO'), false);
});

test('GLP INICIAL sin titulares sigue bloqueado', async () => {
    const fixture = crearFixture({ titulares: [] });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('TITULAR_REQUERIDO'), true);
});

test('GLP INICIAL con titular incompleto sigue bloqueado', async () => {
    const fixture = crearFixture({ titulares: [{ tipo_documento: 'DNI', nro_documento: null }] });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('CAMPO_REQUERIDO'), true);
});

test('GLP INICIAL con saldo pendiente sigue bloqueado', async () => {
    const fixture = crearFixture({
        ordenPago: { estado: 'PENDIENTE', importe_total: 80, importe_pagado: 0, saldo_pendiente: 80 }
    });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('PAGO_INCOMPLETO'), true);
});

test('GLP INICIAL sin orden de pago sigue bloqueado', async () => {
    const fixture = crearFixture({ ordenPago: null });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('ORDEN_PAGO_FALTANTE'), true);
});

test('GLP INICIAL sin datos de GLP sigue bloqueado', async () => {
    const fixture = crearFixture({ glp: null });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('SECCION_FALTANTE'), true);
});

test('GLP ANUAL no fue afectado por el cambio', async () => {
    const fixture = crearFixture({ glp: { ...GLP_INICIAL_COMPLETO, modalidad: 'ANUAL' } });

    const resultado = await validar(fixture);

    assert.deepEqual(resultado.errores, []);
});

test('el vehiculo GLP sigue siendo obligatorio en INICIAL', async () => {
    const fixture = crearFixture({ vehiculo: null });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('SECCION_FALTANTE'), true);
});

test('un formato dinamico TALLER_INSPECCION no hereda las reglas de captura GLP', async () => {
    const fixture = crearFixture({
        cert: {
            tipo_clave: 'GLP_ANUAL',
            servicio_tipo_flujo: 'TALLER_INSPECCION',
            formato_version_id: 77
        },
        glp: null,
        componentes: [],
        verificaciones: []
    });

    const resultado = await validar(fixture);

    assert.equal(
        resultado.errores.some(e => e.seccion === 'glp'),
        false,
        'un formato dinamico no debe emitir errores de la seccion glp'
    );
});

test('un certificado que no esta en BORRADOR sigue rechazandose', async () => {
    const fixture = crearFixture({ cert: { estado: 'EMITIDO' } });

    const resultado = await validar(fixture);

    assert.equal(codigos(resultado).includes('ESTADO_INVALIDO'), true);
});
