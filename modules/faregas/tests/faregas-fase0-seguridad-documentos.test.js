const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.NODE_ENV = 'test';

const documentosService = require('../services/faregas-documentos-electronicos.service');
const certificadosService = require('../services/faregas-certificados.service');
const authService = require('../services/faregas-auth.service');
const db = require('../../../config/database');
const { derivarDatosNotaCredito } = require('../services/faregas-notas-credito-fiscal.service');

const { validarDatosNota, validarPermisoAnulacionComprobante, validarPermisoNotaCredito } = documentosService._private;

test('un perfil sin permiso recibe el error 403 de anulación fiscal', async () => {
    const executor = { query: async () => ({ rowCount: 0, rows: [] }) };
    await assert.rejects(
        validarPermisoAnulacionComprobante(executor, { perfil_id: 'OPERADOR' }),
        (error) => error.code === 'FAREGAS_ANULACION_NO_AUTORIZADA' && error.statusCode === 403
    );
});

test('el permiso explícito habilita la validación de anulación sin omitir sede', async () => {
    let parametros;
    const executor = {
        query: async (_sql, values) => {
            parametros = values;
            return { rowCount: 1, rows: [{ '?column?': 1 }] };
        }
    };
    await validarPermisoAnulacionComprobante(executor, { perfil_id: 'SISTEMAS' });
    assert.deepEqual(parametros, ['SISTEMAS']);
});

test('la nota de crédito también exige su permiso efectivo', async () => {
    const executor = { query: async () => ({ rowCount: 0, rows: [] }) };
    await assert.rejects(
        validarPermisoNotaCredito(executor, { perfil_id: 'OPERADOR' }),
        (error) => error.code === 'PERMISO_DENEGADO_NOTA_CREDITO' && error.statusCode === 403
    );
});

test('la nota de crédito sólo admite motivos 01, 02 y 03 y debe ser total', () => {
    const snapshot = {
        tipo_de_comprobante: 2,
        serie: 'BBB1',
        numero: 10,
        fecha_de_emision: '22-10-2026',
        cliente_tipo_de_documento: 1,
        cliente_numero_de_documento: '74045612',
        cliente_denominacion: 'CLIENTE DE PRUEBA',
        moneda: 1,
        total_gravada: 100,
        total_inafecta: 0,
        total_exonerada: 0,
        total_igv: 18,
        total_otros_cargos: 0,
        total_gratuita: 0,
        total_descuento: 0,
        total: 118,
        items: [{
            unidad_de_medida: 'ZZ', codigo: '0391', descripcion: 'CERTIFICADO', cantidad: 1,
            valor_unitario: 100, precio_unitario: 118, descuento: 0, subtotal: 100,
            tipo_de_igv: 1, igv: 18, total: 118
        }]
    };
    const facturacion = { tipo_comprobante: 'BOLETA', serie: 'BBB1', numero: 10, importe_total: 118 };
    const datos = { motivoCodigo: '01', sustento: 'Anulación solicitada' };
    const fiscales = derivarDatosNotaCredito({ snapshot, ...datos });
    assert.equal(validarDatosNota('CREDITO', datos, facturacion, fiscales, 0).importeTotal, 118);
    assert.throws(
        () => validarDatosNota('CREDITO', { ...datos, motivoCodigo: '04' }, facturacion, fiscales, 0),
        (error) => error.code === 'MOTIVO_NOTA_CREDITO_NO_PERMITIDO_O_INVALIDO'
    );
    assert.throws(
        () => validarDatosNota('CREDITO', datos, facturacion, fiscales, 118),
        (error) => error.code === 'NOTA_CREDITO_EXCEDE_COMPROBANTE'
    );
});

test('la migración incremental retira privilegios fiscales sólo a OPERADOR', () => {
    const migration = fs.readFileSync(path.join(
        __dirname,
        '../database/migrations_history/20261022_faregas_fase0_seguridad_documentos.sql'
    ), 'utf8');
    assert.match(migration, /FAREGAS_ANULAR_COMPROBANTE/);
    assert.match(migration, /WHERE perfil_clave = 'OPERADOR'/);
    assert.match(migration, /'FAREGAS_NOTA_CREDITO'/);
    assert.doesNotMatch(migration, /DELETE FROM fg_certificado|DELETE FROM fg_facturacion|DELETE FROM fg_pago/);
});

test('el panel obtiene por separado estado técnico, fiscal y nota de crédito', () => {
    const source = fs.readFileSync(path.join(__dirname, '../services/faregas-certificados.service.js'), 'utf8');
    assert.match(source, /c\.estado,/);
    assert.match(source, /f\.estado AS "estadoFacturacion"/);
    assert.match(source, /anulacion\.estado AS "estadoAnulacion"/);
    assert.match(source, /nota_credito\.estado AS "estadoNotaCredito"/);
});

const ejecutarConBorradorSimulado = async ({ estado = 'BORRADOR', paso = 'DATOS_INICIALES', conFacturacion = false }, operacion) => {
    const connectOriginal = db.connect;
    const accesoOriginal = authService.validarAccesoPlanta;
    const consultas = [];
    const client = {
        query: async (sql) => {
            const texto = String(sql);
            consultas.push(texto);
            if (texto.includes('SELECT estado, planta_key, paso_actual')) {
                return {
                    rowCount: 1,
                    rows: [{ estado, planta_key: '201', paso_actual: paso, numero_certificado: null }]
                };
            }
            if (texto.includes('SELECT 1 FROM fg_facturacion')) {
                return { rowCount: conFacturacion ? 1 : 0, rows: conFacturacion ? [{ '?column?': 1 }] : [] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => undefined
    };
    db.connect = async () => client;
    authService.validarAccesoPlanta = async () => ({ key: '201' });
    try {
        return await operacion(consultas);
    } finally {
        db.connect = connectOriginal;
        authService.validarAccesoPlanta = accesoOriginal;
    }
};

test('anular borrador propio continúa permitido sin tocar correlativos', async () => {
    await ejecutarConBorradorSimulado({}, async (consultas) => {
        const resultado = await certificadosService.anularBorrador(77, {
            username: 'operador', perfil_id: 'OPERADOR', planta_key: '201'
        });
        assert.equal(resultado.estado, 'ANULADO');
        const actualizacion = consultas.find((sql) => sql.includes("SET estado = 'ANULADO'"));
        assert.ok(actualizacion);
        assert.doesNotMatch(actualizacion, /numero_certificado|correlativo/i);
    });
});

test('el endpoint de borradores no puede anular un certificado emitido', async () => {
    await ejecutarConBorradorSimulado({ estado: 'EMITIDO' }, async () => {
        await assert.rejects(
            certificadosService.anularBorrador(78, {
                username: 'operador', perfil_id: 'OPERADOR', planta_key: '201'
            }),
            /CERTIFICADO_NO_EDITABLE/
        );
    });
});

test('un borrador con facturación iniciada no puede anularse', async () => {
    await ejecutarConBorradorSimulado({ conFacturacion: true }, async () => {
        await assert.rejects(
            certificadosService.anularBorrador(79, {
                username: 'operador', perfil_id: 'OPERADOR', planta_key: '201'
            }),
            /FACTURACION_YA_INICIADA/
        );
    });
});
