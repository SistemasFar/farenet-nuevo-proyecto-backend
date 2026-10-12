const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const chipCertificadoService = require('../services/faregas-chip-certificado.service');
const certificados = require('../services/faregas-certificados.service');

// faregas-facturacion.service captura validarAccesoPlanta al importarse.
// Se inyecta una autorización local para probar únicamente su precondición de pago.
const validarAccesoOriginal = authService.validarAccesoPlanta;
authService.validarAccesoPlanta = async () => true;
const facturacionService = require('../services/faregas-facturacion.service');
authService.validarAccesoPlanta = validarAccesoOriginal;

const ejecutarTransicion = async ({ actual, destino }) => {
    const originalConnect = db.connect;
    const originalAcceso = authService.validarAccesoPlanta;
    const originalReserva = chipCertificadoService.reservarFisicamente;
    let pasoActualizado = null;
    let reservaEjecutada = false;

    db.connect = async () => ({
        async query(sql, params = []) {
            const texto = String(sql);
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto)) return { rowCount: 0, rows: [] };
            if (texto.includes('SELECT estado, planta_key, paso_actual')) {
                return {
                    rowCount: 1,
                    rows: [{ estado: 'BORRADOR', planta_key: '201', paso_actual: actual }]
                };
            }
            if (texto.includes('UPDATE fg_certificado') && texto.includes('paso_actual = $2')) {
                pasoActualizado = params[1];
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Consulta inesperada: ${texto}`);
        },
        release() {}
    });
    authService.validarAccesoPlanta = async () => true;
    chipCertificadoService.reservarFisicamente = async () => {
        reservaEjecutada = true;
    };

    try {
        const resultado = await certificados.actualizarPasoBorrador(
            542,
            destino,
            { username: 'test', perfil_id: 1 }
        );
        return { resultado, pasoActualizado, reservaEjecutada };
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalAcceso;
        chipCertificadoService.reservarFisicamente = originalReserva;
    }
};

test('permite todas las transiciones consecutivas del nuevo orden', async () => {
    const transiciones = [
        ['DATOS_INICIALES', 'VEHICULO'],
        ['VEHICULO', 'PREVISUALIZACION'],
        ['PREVISUALIZACION', 'PAGO'],
        ['PAGO', 'FACTURACION']
    ];

    for (const [actual, destino] of transiciones) {
        const { resultado, pasoActualizado } = await ejecutarTransicion({ actual, destino });
        assert.equal(resultado.pasoActual, destino);
        assert.equal(pasoActualizado, destino);
    }
});

test('sigue rechazando un salto real de Datos Iniciales a Previsualización', async () => {
    await assert.rejects(
        ejecutarTransicion({ actual: 'DATOS_INICIALES', destino: 'PREVISUALIZACION' }),
        (error) => error.message === 'TRANSICION_PASO_INVALIDA'
    );
});

test('navegar hacia atrás no reduce el progreso persistido del borrador', async () => {
    const { resultado, pasoActualizado } = await ejecutarTransicion({
        actual: 'PAGO',
        destino: 'PREVISUALIZACION'
    });

    assert.equal(resultado.pasoActual, 'PAGO');
    assert.equal(pasoActualizado, 'PAGO');
});

test('la reserva física conserva su ejecución únicamente al entrar a Facturación', async () => {
    const pago = await ejecutarTransicion({ actual: 'PREVISUALIZACION', destino: 'PAGO' });
    const facturacion = await ejecutarTransicion({ actual: 'PAGO', destino: 'FACTURACION' });

    assert.equal(pago.reservaEjecutada, false);
    assert.equal(facturacion.reservaEjecutada, true);
});

test('GLP, GNV y Conformidad generan previsualización sin consultar una orden de pago', async () => {
    const originalBorrador = certificados.obtenerBorradorCompleto;
    const originalGlp = certificados.obtenerGLP;
    const originalGnv = certificados.obtenerGNV;
    const originalConformidad = certificados.obtenerConformidad;
    let tipoActual = 'GLP_ANUAL';

    certificados.obtenerBorradorCompleto = async () => ({
        id: 544,
        estado: 'BORRADOR',
        tipo: { clave: tipoActual },
        servicio: { tipoFlujo: 'CERTIFICACION' },
        vehiculo: {},
        titulares: [],
        cliente: {},
        formatoFormulario: null,
        formatoVersionId: null,
        formatoVersionAsignadaId: null,
        chipSeleccion: null,
        numeroCertificado: null,
        fechaEmision: null,
        observaciones: null
    });
    certificados.obtenerGLP = async () => ({
        glp: { modalidad: 'ANUAL' },
        componentes: [],
        verificaciones: []
    });
    certificados.obtenerGNV = async () => ({
        gnv: { modalidad: 'ANUAL' },
        componentes: [],
        verificaciones: []
    });
    certificados.obtenerConformidad = async () => ({ conformidad: {} });

    try {
        for (const tipo of ['GLP_ANUAL', 'GNV_ANUAL', 'CONFORMIDAD']) {
            tipoActual = tipo;
            const preview = await certificados.obtenerPrevisualizacion(544, {
                username: 'test',
                perfil_id: 1
            });
            assert.equal(typeof preview.html, 'string');
            assert.ok(preview.html.length > 0);
        }
    } finally {
        certificados.obtenerBorradorCompleto = originalBorrador;
        certificados.obtenerGLP = originalGlp;
        certificados.obtenerGNV = originalGnv;
        certificados.obtenerConformidad = originalConformidad;
    }
});

test('Facturación continúa bloqueada cuando no existe orden de pago', async () => {
    const originalConnect = db.connect;
    db.connect = async () => ({
        async query(sql) {
            const texto = String(sql);
            if (['BEGIN', 'ROLLBACK'].includes(texto)) return { rowCount: 0, rows: [] };
            if (texto.includes('FROM fg_certificado c') && texto.includes('JOIN fg_tipo_certificado')) {
                return {
                    rowCount: 1,
                    rows: [{ id: 544, estado: 'BORRADOR', planta_key: '201', tipo_clave: 'GLP_ANUAL' }]
                };
            }
            if (texto.includes('SELECT * FROM fg_orden_pago WHERE certificado_id')) {
                return { rowCount: 0, rows: [] };
            }
            throw new Error(`Consulta inesperada: ${texto}`);
        },
        release() {}
    });

    try {
        await assert.rejects(
            facturacionService.guardarFacturacion(544, {
                tipoComprobante: 'BOLETA',
                nroDocumento: '74045612',
                nombreRazonSocial: 'CLIENTE PRUEBA',
                direccion: 'LIMA',
                condicionPago: 'CONTADO',
                cuotas: []
            }, { username: 'test', perfil_id: 1 }),
            (error) => error.code === 'ORDEN_PAGO_FALTANTE' && error.statusCode === 409
        );
    } finally {
        db.connect = originalConnect;
    }
});
