const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const certificados = require('../services/faregas-certificados.service');
const sedeRangos = require('../services/faregas-correlativos-sede.service');
const generateGlpAnualHtml = require('../templates/glp-anual.template');

test('GLP anual exige capacidad/año sin modelo ni mes en el cilindro', () => {
    const { camposRequeridosComponenteGlp } = certificados._private;
    const anualCilindro = camposRequeridosComponenteGlp('ANUAL', 'CILINDRO').map(([campo]) => campo);
    const inicialCilindro = camposRequeridosComponenteGlp('INICIAL', 'CILINDRO').map(([campo]) => campo);
    const anualRegulador = camposRequeridosComponenteGlp('ANUAL', 'REGULADOR').map(([campo]) => campo);

    assert.deepEqual(anualCilindro, ['marca', 'numero_serie', 'capacidad_litros', 'anio_fabricacion']);
    assert.deepEqual(inicialCilindro, ['marca', 'numero_serie', 'capacidad_litros', 'anio_fabricacion', 'mes_fabricacion']);
    assert.equal(inicialCilindro.includes('modelo'), false);
    assert.deepEqual(anualRegulador, ['marca', 'numero_serie', 'modelo']);
});

const ejecutarGuardadoGlp = async ({
    combustibleOriginal = 'GASOLINA',
    combustiblePosterior = 'BI-COMBUSTIBLE GLP',
    modalidad = 'INICIAL',
    expedienteTecnico = 'EXP-1'
} = {}) => {
    const originalConnect = db.connect;
    const originalAcceso = authService.validarAccesoPlanta;
    let parametrosGuardados = null;

    db.connect = async () => ({
        async query(sql, params = []) {
            const texto = String(sql);
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto)) return { rowCount: 0, rows: [] };
            if (texto.includes('SELECT estado, planta_key, tipo_certificado_clave')) {
                return { rowCount: 1, rows: [{ estado: 'BORRADOR', planta_key: '160', tipo_certificado_clave: 'GLP_ANUAL' }] };
            }
            if (texto.includes("FROM fg_taller_autorizado WHERE sede = 'SURQUILLO'")) {
                return { rowCount: 1, rows: [{ id: 160, razon_social: 'TALLER SURQUILLO', sede: 'SURQUILLO', direccion: 'PRUEBA', codigo_autorizacion: 'GLP-160' }] };
            }
            if (texto.includes('SELECT modalidad FROM fg_certificado_glp')) {
                return { rowCount: 0, rows: [] };
            }
            if (texto.includes('SELECT combustible') && texto.includes('FROM fg_certificado_vehiculo')) {
                return { rowCount: 1, rows: [{ combustible: combustibleOriginal }] };
            }
            if (texto.includes('INSERT INTO fg_certificado_glp')) {
                parametrosGuardados = params;
                parametrosGuardados.sql = texto;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Consulta inesperada: ${texto}`);
        },
        release() {}
    });
    authService.validarAccesoPlanta = async () => true;

    try {
        await certificados.guardarGLP(801, {
            vigenciaHasta: '2027-10-09',
            expedienteTecnico,
            modalidad,
            combustiblePosterior,
            pesoNetoPosterior: '1450',
            cargaUtilPosterior: '149'
        }, { username: 'test', perfil_id: 1 });
        return parametrosGuardados;
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalAcceso;
    }
};

test('GLP INICIAL rechaza combustibles equivalentes con distinta puntuación', async () => {
    await assert.rejects(
        ejecutarGuardadoGlp({ combustibleOriginal: 'BI COMBUSTIBLE/GLP' }),
        (error) => error.code === 'GLP_COMBUSTIBLE_SIN_CAMBIO'
    );
});

test('GLP INICIAL permite un combustible original distinto', async () => {
    const parametros = await ejecutarGuardadoGlp({ combustibleOriginal: 'GASOLINA' });
    assert.ok(parametros);
    assert.equal(parametros[8], 'INICIAL');
    assert.equal(parametros[9], 'BI-COMBUSTIBLE GLP');
});

test('GLP ANUAL ignora una entrada manual nueva y preserva de forma explícita el valor histórico en conflicto', async () => {
    const parametros = await ejecutarGuardadoGlp({
        modalidad: 'ANUAL',
        expedienteTecnico: 'DG-41-0066495'
    });

    assert.equal(parametros[2], null);
    assert.match(parametros.sql, /WHEN EXCLUDED\.modalidad = 'ANUAL' THEN fg_certificado_glp\.expediente_tecnico/);
    assert.equal(certificados._private.requiereExpedienteTecnicoGlp('ANUAL'), false);
    assert.equal(certificados._private.requiereExpedienteTecnicoGlp('INICIAL'), false);
});

test('la plantilla GLP ANUAL usa siempre el número oficial y no el expediente manual legado', () => {
    const html = generateGlpAnualHtml({
        cabecera: { numero_certificado: 'DG-41-000151' },
        vehiculo: {},
        glp: { expediente_tecnico: 'DG-41-0066495' },
        componentes: [],
        verificaciones: [],
        titulares: []
    }, { modo: 'FINAL' });

    assert.match(html, /expediente técnico <strong>N° DG-41-000151<\/strong>/);
    assert.doesNotMatch(html, /DG-41-0066495/);
});

test('la previsualización sin correlativo muestra estado pendiente y no reutiliza el valor manual legado', () => {
    const html = generateGlpAnualHtml({
        cabecera: {},
        vehiculo: {},
        glp: { expediente_tecnico: 'DG-41-0066495' },
        componentes: [],
        verificaciones: [],
        titulares: []
    }, { modo: 'PREVIEW' });

    assert.match(html, /expediente técnico <strong>N° PENDIENTE DE EMISIÓN<\/strong>/);
    assert.doesNotMatch(html, /DG-41-0066495/);
});

test('la emisión GLP ANUAL consume un solo correlativo y sincroniza certificado y expediente', async () => {
    const originalConnect = db.connect;
    const originalQuery = db.query;
    const originalValidarEmision = certificados.validarEmision;
    const originalValidarAcceso = authService.validarAccesoCertificado;
    const originalConsumirNumero = sedeRangos.consumirNumero;
    let consumos = 0;
    let expedientePersistido = null;
    let certificadoPersistido = null;

    db.query = async () => ({ rowCount: 0, rows: [] });
    db.connect = async () => ({
        async query(sql, params = []) {
            const texto = String(sql);
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto)) return { rowCount: 0, rows: [] };
            if (texto.includes('FROM fg_certificado c') && texto.includes('FOR UPDATE OF c')) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: 802,
                        estado: 'BORRADOR',
                        planta_key: '160',
                        tipo_clave: 'GLP_ANUAL',
                        tipo_codigo: '41',
                        ancho_correlativo: 6,
                        modalidad_correlativo: 'ANUAL',
                        servicio_tipo_flujo: 'CERTIFICACION',
                        servicio_formato_id: null,
                        formato_version_id: null,
                        numero_certificado: null
                    }]
                };
            }
            if (texto.includes('UPDATE fg_certificado_glp')) {
                expedientePersistido = params[1];
                return { rowCount: 1, rows: [] };
            }
            if (texto.includes('UPDATE fg_certificado') && texto.includes("estado = 'EMITIDO'")) {
                certificadoPersistido = params[0];
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Consulta inesperada: ${texto}`);
        },
        release() {}
    });
    certificados.validarEmision = async () => ({ valido: true, errores: [] });
    authService.validarAccesoCertificado = async () => true;
    sedeRangos.consumirNumero = async () => {
        consumos += 1;
        return { migrada: true, nro: 151 };
    };

    try {
        const resultado = await certificados.emitirCertificado(802, { username: 'test', perfil_id: 1 });
        assert.equal(resultado.numero_certificado, 'DG-41-000151');
        assert.equal(consumos, 1);
        assert.equal(expedientePersistido, 'DG-41-000151');
        assert.equal(certificadoPersistido, 'DG-41-000151');
    } finally {
        db.connect = originalConnect;
        db.query = originalQuery;
        certificados.validarEmision = originalValidarEmision;
        authService.validarAccesoCertificado = originalValidarAcceso;
        sedeRangos.consumirNumero = originalConsumirNumero;
    }
});

test('GLP INICIAL: la plantilla usa el número oficial y en preview muestra estado pendiente', () => {
    const generateGlpInicialHtml = require('../templates/glp-inicial.template');
    const htmlPreview = generateGlpInicialHtml({
        cabecera: {},
        vehiculo: {},
        glp: {},
        componentes: [],
        verificaciones: [],
        titulares: []
    }, { modo: 'PREVIEW' });
    assert.match(htmlPreview, /expediente técnico <strong>N\.º PENDIENTE DE EMISIÓN<\/strong>/);

    const htmlFinal = generateGlpInicialHtml({
        cabecera: { numero_certificado: 'DG-41-000200' },
        vehiculo: {},
        glp: {},
        componentes: [],
        verificaciones: [],
        titulares: []
    }, { modo: 'FINAL' });
    assert.match(htmlFinal, /expediente técnico <strong>N\.º DG-41-000200<\/strong>/);
});
