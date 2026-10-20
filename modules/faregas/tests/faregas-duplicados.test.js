const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const databasePath = require.resolve('../../../config/database');
require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: {}
};

const duplicadosService = require('../services/faregas-duplicados.service');
const { agregarMarcaDuplicado } = require('../services/faregas-duplicado-pdf.service');

test('duplicado conserva el HTML y agrega una sola marca de fondo', () => {
    const original = '<html><body><main>Certificado DG-41-012488</main></body></html>';
    const marcado = agregarMarcaDuplicado(original);

    assert.match(marcado, /data-faregas-duplicado="true"/);
    assert.match(marcado, />DUPLICADO<\/div>/);
    assert.match(marcado, /Certificado DG-41-012488/);
    assert.equal((agregarMarcaDuplicado(marcado).match(/data-faregas-duplicado/g) || []).length, 1);
});

test('busqueda normaliza placa y acepta TODOS o una modalidad GLP/GNV', () => {
    const reglas = duplicadosService._private;
    assert.equal(reglas.normalizarPlaca(' ab-c 123 '), 'ABC123');
    assert.deepEqual(reglas.normalizarTipoFiltro('TODOS'), { clave: null, modalidad: null });
    assert.deepEqual(reglas.normalizarTipoFiltro('GLP:INICIAL'), { clave: 'GLP', modalidad: 'INICIAL' });
    assert.deepEqual(reglas.normalizarTipoFiltro('GNV:ANUAL'), { clave: 'GNV', modalidad: 'ANUAL' });
    assert.throws(() => reglas.normalizarTipoFiltro('CONFORMIDAD:ANUAL'), /TIPO_CERTIFICADO_INVALIDO/);
});

test('regla comercial fija el duplicado en S/ 50 y sólo habilita comprobantes operables', () => {
    const reglas = duplicadosService._private;
    assert.equal(reglas.PRECIO_DUPLICADO, 50);
    assert.equal(reglas.facturacionOperable({ estado: 'ACEPTADO', aceptadaSunat: true }), true);
    assert.equal(reglas.facturacionOperable({ estado: 'PENDIENTE_SUNAT', entornoFacturador: 'DEMO', nroComprobante: 'BBB1-1', enlacePdf: 'https://demo/pdf' }), true);
    assert.equal(reglas.facturacionOperable({ estado: 'DISPONIBLE', facturacion_estado: 'PENDIENTE_SUNAT', entorno_facturador: 'DEMO', nro_comprobante: 'BBB1-1', enlace_pdf: 'https://demo/pdf' }), true);
    assert.equal(reglas.facturacionOperable({ estado: 'PENDIENTE_SUNAT', entornoFacturador: 'PRODUCCION', nroComprobante: 'BBB1-1', enlacePdf: 'https://prod/pdf' }), false);
});

test('comprobante de duplicado completa el snapshot fiscal desde la sede de la operación', async () => {
    let consulta = null;
    const queryable = {
        query: async (sql, params) => {
            consulta = { sql, params };
            return { rowCount: 1, rows: [{ id: '687' }] };
        }
    };

    const id = await duplicadosService._private.asegurarSnapshotOperacion(476, queryable);

    assert.equal(id, 687);
    assert.deepEqual(consulta.params, [476]);
    assert.match(consulta.sql, /fecha_documento = COALESCE/);
    assert.match(consulta.sql, /sede_nombre_snapshot = COALESCE/);
    assert.match(consulta.sql, /JOIN fg_planta p ON p\.key = o\.planta_key/);
    assert.match(consulta.sql, /f\.certificado_id IS NULL/);
});

test('historial lista únicamente duplicados disponibles de la sede activa con su comprobante', async () => {
    let consulta = null;
    const queryable = {
        query: async (sql, params) => {
            consulta = { sql, params };
            return {
                rows: [{
                    id: '1', certificado_original_id: '608', operacion_id: '476',
                    facturacion_id_real: '687', numero_certificado: 'DG-41-012488',
                    placa: 'ABC123', tipo_nombre_snapshot: 'Certificado Inicial GLP',
                    fecha_emision_snapshot: '2026-10-19', fecha_limite_snapshot: '2027-10-19',
                    precio: '50.00', estado: 'DISPONIBLE', operacion_estado: 'PAGADO',
                    facturacion_estado: 'PENDIENTE_SUNAT', nro_comprobante: 'BBB1-00000185',
                    tipo_comprobante: 'BOLETA', fecha_solicitud: '2026-10-20',
                    fecha_disponible: '2026-10-20', solicitado_por: 'SUPERVISOR'
                }]
            };
        }
    };

    const historial = await duplicadosService._private.consultarHistorial('98', {
        desde: '2026-10-01', hasta: '2026-10-20', pagina: '2'
    }, queryable);

    assert.deepEqual(consulta.params, ['98', '2026-10-01', '2026-10-20', 10]);
    assert.match(consulta.sql, /d\.estado = 'DISPONIBLE'/);
    assert.match(consulta.sql, /JOIN fg_facturacion f ON f\.id = d\.facturacion_id/);
    assert.match(consulta.sql, /COUNT\(\*\) OVER\(\)/);
    assert.match(consulta.sql, /LIMIT 10 OFFSET \$4/);
    assert.equal(historial.items[0].nroComprobante, 'BBB1-00000185');
    assert.equal(historial.items[0].tipoComprobante, 'BOLETA');
    assert.equal(historial.paginacion.pagina, 2);
    assert.equal(historial.paginacion.porPagina, 10);
});

test('consulta devuelve sólo el último emitido por tipo y modalidad de la placa', async () => {
    let consulta = null;
    const queryable = {
        query: async (sql, params) => {
            consulta = { sql, params };
            return {
                rows: [{
                    certificado_id: '608', numero_certificado: 'DG-41-012488', placa: 'ABC123',
                    tipo_certificado_clave: 'GLP', modalidad: 'INICIAL', fecha_emision: '2026-10-19',
                    fecha_limite_duplicado: '2027-10-19', vigente: true, anulacion_aceptada: false,
                    planta_key: '98', planta_nombre: 'SURCO', cliente_tipo_documento: 'DNI',
                    cliente_documento: '74045612', cliente_nombre: 'GRACE', cliente_direccion: 'LIMA'
                }]
            };
        }
    };

    const candidatos = await duplicadosService._private.consultarUltimosEmitidos({
        placa: 'ABC-123', tipo: 'GLP:INICIAL', plantaKey: '98'
    }, queryable);

    assert.match(consulta.sql, /ROW_NUMBER\(\) OVER/);
    assert.match(consulta.sql, /WHERE posicion = 1/);
    assert.match(consulta.sql, /c\.estado = 'EMITIDO'/);
    assert.deepEqual(consulta.params, ['ABC123', '98', 'GLP', 'INICIAL']);
    assert.equal(candidatos[0].certificadoId, 608);
    assert.equal(candidatos[0].duplicable, true);
});

test('esquema consolidado contiene tabla, restricciones e indices del duplicado', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../database/migrations/0001_faregas_schema.sql'), 'utf8');
    assert.match(sql, /CREATE TABLE public\.fg_certificado_duplicado/);
    assert.match(sql, /precio numeric\(10,2\) DEFAULT 50\.00 NOT NULL/);
    assert.match(sql, /html_original_snapshot text NOT NULL/);
    assert.match(sql, /fk_fg_certificado_duplicado_certificado/);
    assert.match(sql, /uq_fg_certificado_duplicado_pendiente_usuario/);
});

test('solicitud nueva busca unicamente estados pendientes y permite multiples duplicados completados', () => {
    const fuente = fs.readFileSync(path.join(__dirname, '../services/faregas-duplicados.service.js'), 'utf8');
    assert.match(fuente, /estado=\$3::varchar/);
    assert.match(fuente, /CASE WHEN \$3::varchar='DISPONIBLE'/);
    assert.match(fuente, /AND d\.estado IN \('PENDIENTE_PAGO', 'PENDIENTE_COMPROBANTE'\)/);
    assert.doesNotMatch(fuente, /AND d\.estado IN \('PENDIENTE_PAGO', 'PENDIENTE_COMPROBANTE', 'DISPONIBLE'\)/);
});

test('candidatos incluye conteo de duplicados emitidos anteriormente', async () => {
    let consulta = null;
    const queryable = {
        query: async (sql, params) => {
            consulta = { sql, params };
            return {
                rows: [{
                    certificado_id: '608', numero_certificado: 'DG-41-012488', placa: 'ABC123',
                    tipo_certificado_clave: 'GLP', modalidad: 'INICIAL', fecha_emision: '2026-10-19',
                    fecha_limite_duplicado: '2027-10-19', vigente: true, anulacion_aceptada: false,
                    planta_key: '98', planta_nombre: 'SURCO', cliente_tipo_documento: 'DNI',
                    cliente_documento: '74045612', cliente_nombre: 'GRACE', cliente_direccion: 'LIMA',
                    duplicados_emitidos_count: 2
                }]
            };
        }
    };

    const candidatos = await duplicadosService._private.consultarUltimosEmitidos({
        placa: 'ABC-123', tipo: 'GLP:INICIAL', plantaKey: '98'
    }, queryable);

    assert.match(consulta.sql, /duplicados_emitidos_count/);
    assert.equal(candidatos[0].duplicadosEmitidosCount, 2);
});

test('historial calcula el numero ordinal de duplicado para cada registro', async () => {
    let consulta = null;
    const queryable = {
        query: async (sql, params) => {
            consulta = { sql, params };
            return {
                rows: [{
                    id: '2', certificado_original_id: '608', operacion_id: '477',
                    facturacion_id_real: '688', numero_certificado: 'DG-41-012488',
                    numero_duplicado: 2,
                    placa: 'ABC123', tipo_nombre_snapshot: 'Certificado Inicial GLP',
                    fecha_emision_snapshot: '2026-10-19', fecha_limite_snapshot: '2027-10-19',
                    precio: '50.00', estado: 'DISPONIBLE', operacion_estado: 'PAGADO',
                    facturacion_estado: 'PENDIENTE_SUNAT', nro_comprobante: 'BBB1-00000186',
                    tipo_comprobante: 'BOLETA', fecha_solicitud: '2026-10-21',
                    fecha_disponible: '2026-10-21', solicitado_por: 'SUPERVISOR'
                }]
            };
        }
    };

    const historial = await duplicadosService._private.consultarHistorial('98', {
        desde: '2026-10-01', hasta: '2026-10-21', pagina: '1'
    }, queryable);

    assert.match(consulta.sql, /ROW_NUMBER\(\) OVER/);
    assert.match(consulta.sql, /PARTITION BY d\.certificado_original_id/);
    assert.equal(historial.items[0].numeroDuplicado, 2);
    assert.equal(historial.items[0].nroComprobante, 'BBB1-00000186');
});

test('crearSolicitud genera nueva operacion cuando los duplicados anteriores estan DISPONIBLE', async () => {
    const dbMock = require('../../../config/database');
    const authService = require('../services/faregas-auth.service');
    const certificadosService = require('../services/faregas-certificados.service');

    const queriesEjecutadas = [];
    const clientMock = {
        query: async (sql, params) => {
            queriesEjecutadas.push({ sql, params });
            if (sql.includes('SELECT d.id') && sql.includes('fg_certificado_duplicado')) {
                // Simula que NO hay duplicados pendientes (los anteriores estan DISPONIBLE)
                return { rowCount: 0, rows: [] };
            }
            if (sql.includes('INSERT INTO fg_operacion_comercial')) {
                return { rowCount: 1, rows: [{ id: '991' }] };
            }
            if (sql.includes('INSERT INTO fg_operacion_detalle')) {
                return { rowCount: 1, rows: [{ id: '1201' }] };
            }
            if (sql.includes('INSERT INTO fg_certificado_duplicado')) {
                return { rowCount: 1, rows: [{ id: '2' }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };

    dbMock.connect = async () => clientMock;
    dbMock.query = async (sql, params) => {
        queriesEjecutadas.push({ sql, params });
        if (sql.includes('SELECT c.id, c.planta_key') && sql.includes('FROM fg_certificado')) {
            return {
                rowCount: 1,
                rows: [{
                    id: '608', planta_key: '98', tipo_certificado_clave: 'GLP', placa: 'ABC123', modalidad: 'INICIAL'
                }]
            };
        }
        if (sql.includes('WITH candidatos AS') && sql.includes('FROM fg_certificado c')) {
            return {
                rowCount: 1,
                rows: [{
                    certificado_id: '608', numero_certificado: 'DG-41-012488', placa: 'ABC123',
                    tipo_certificado_clave: 'GLP', modalidad: 'INICIAL', fecha_emision: '2026-10-19',
                    fecha_limite_duplicado: '2027-10-19', vigente: true, anulacion_aceptada: false,
                    planta_key: '98', planta_nombre: 'SURCO', cliente_tipo_documento: 'DNI',
                    cliente_documento: '74045612', cliente_nombre: 'JUAN PEREZ', cliente_direccion: 'LIMA',
                    duplicados_emitidos_count: 1
                }]
            };
        }
        if (sql.includes('SELECT d.*, c.numero_certificado') && sql.includes('FROM fg_certificado_duplicado d')) {
            return {
                rowCount: 1,
                rows: [{
                    id: '2', certificado_original_id: '608', operacion_id: '991',
                    facturacion_id_real: null, numero_certificado: 'DG-41-012488',
                    numero_duplicado: 2,
                    placa: 'ABC123', tipo_nombre_snapshot: 'Certificado Inicial GLP',
                    fecha_emision_snapshot: '2026-10-19', fecha_limite_snapshot: '2027-10-19',
                    precio: '50.00', estado: 'PENDIENTE_PAGO', operacion_estado: 'BORRADOR',
                    facturacion_estado: null, nro_comprobante: null, tipo_comprobante: null,
                    fecha_solicitud: '2026-10-20', fecha_disponible: null, solicitado_por: 'OPERADOR',
                    planta_key: '98'
                }]
            };
        }
        return { rowCount: 1, rows: [] };
    };

    authService.validarAccesoPlanta = async () => true;
    certificadosService.obtenerPrevisualizacion = async () => ({ html: '<html><body>Certificado original</body></html>' });

    const solicitud = await duplicadosService.crearSolicitud(608, { username: 'OPERADOR', perfil_id: 1, planta_key: '98' });

    assert.equal(solicitud.id, 2);
    assert.equal(solicitud.estado, 'PENDIENTE_PAGO');
    assert.equal(solicitud.operacionId, 991);
    assert.equal(solicitud.numeroDuplicado, 2);

    // Verifica que se insertó una nueva operación comercial y detalle
    assert.ok(queriesEjecutadas.some(q => q.sql.includes('INSERT INTO fg_operacion_comercial')));
    assert.ok(queriesEjecutadas.some(q => q.sql.includes('INSERT INTO fg_certificado_duplicado')));
});

test('crearSolicitud no genera nueva operacion cuando existe una solicitud PENDIENTE (idempotencia y doble click)', async () => {
    const dbMock = require('../../../config/database');
    const authService = require('../services/faregas-auth.service');
    const certificadosService = require('../services/faregas-certificados.service');

    const queriesEjecutadas = [];
    const clientMock = {
        query: async (sql, params) => {
            queriesEjecutadas.push({ sql, params });
            if (sql.includes('SELECT d.id') && sql.includes('fg_certificado_duplicado')) {
                // Simula que YA existe una solicitud pendiente de pago
                return { rowCount: 1, rows: [{ id: '2' }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };

    dbMock.connect = async () => clientMock;
    dbMock.query = async (sql, params) => {
        queriesEjecutadas.push({ sql, params });
        if (sql.includes('SELECT c.id, c.planta_key') && sql.includes('FROM fg_certificado')) {
            return {
                rowCount: 1,
                rows: [{
                    id: '608', planta_key: '98', tipo_certificado_clave: 'GLP', placa: 'ABC123', modalidad: 'INICIAL'
                }]
            };
        }
        if (sql.includes('WITH candidatos AS') && sql.includes('FROM fg_certificado c')) {
            return {
                rowCount: 1,
                rows: [{
                    certificado_id: '608', numero_certificado: 'DG-41-012488', placa: 'ABC123',
                    tipo_certificado_clave: 'GLP', modalidad: 'INICIAL', fecha_emision: '2026-10-19',
                    fecha_limite_duplicado: '2027-10-19', vigente: true, anulacion_aceptada: false,
                    planta_key: '98', planta_nombre: 'SURCO', cliente_tipo_documento: 'DNI',
                    cliente_documento: '74045612', cliente_nombre: 'JUAN PEREZ', cliente_direccion: 'LIMA',
                    duplicados_emitidos_count: 1
                }]
            };
        }
        if (sql.includes('SELECT d.*, c.numero_certificado') && sql.includes('FROM fg_certificado_duplicado d')) {
            return {
                rowCount: 1,
                rows: [{
                    id: '2', certificado_original_id: '608', operacion_id: '991',
                    facturacion_id_real: null, numero_certificado: 'DG-41-012488',
                    numero_duplicado: 2,
                    placa: 'ABC123', tipo_nombre_snapshot: 'Certificado Inicial GLP',
                    fecha_emision_snapshot: '2026-10-19', fecha_limite_snapshot: '2027-10-19',
                    precio: '50.00', estado: 'PENDIENTE_PAGO', operacion_estado: 'BORRADOR',
                    facturacion_estado: null, nro_comprobante: null, tipo_comprobante: null,
                    fecha_solicitud: '2026-10-20', fecha_disponible: null, solicitado_por: 'OPERADOR',
                    planta_key: '98'
                }]
            };
        }
        return { rowCount: 1, rows: [] };
    };

    authService.validarAccesoPlanta = async () => true;
    certificadosService.obtenerPrevisualizacion = async () => ({ html: '<html><body>Certificado original</body></html>' });

    const solicitud = await duplicadosService.crearSolicitud(608, { username: 'OPERADOR', perfil_id: 1, planta_key: '98' });

    assert.equal(solicitud.id, 2);
    assert.equal(solicitud.estado, 'PENDIENTE_PAGO');
    // Verifica que NO se ejecutó ningún INSERT de nueva operacion
    assert.ok(!queriesEjecutadas.some(q => q.sql.includes('INSERT INTO fg_operacion_comercial')));
});

test('procesar rechaza solicitud con pagos vacios (PAGOS_REQUERIDOS)', async () => {
    const dbMock = require('../../../config/database');
    const authService = require('../services/faregas-auth.service');

    const duplicadoMock = {
        id: '1', certificado_original_id: '608', operacion_id: '991',
        planta_key: '98', precio: '50.00', estado: 'PENDIENTE_PAGO',
        operacion_estado: 'BORRADOR', numero_certificado: 'DG-41-012488'
    };

    dbMock.query = async (sql) => {
        if (sql.includes('SELECT d.*, c.numero_certificado')) {
            return { rowCount: 1, rows: [duplicadoMock] };
        }
        return { rowCount: 1, rows: [] };
    };
    dbMock.connect = async () => ({
        query: async (sql) => {
            if (sql.includes('SELECT d.*, c.numero_certificado')) {
                return { rowCount: 1, rows: [duplicadoMock] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    });
    authService.validarAccesoPlanta = async () => true;

    await assert.rejects(
        () => duplicadosService.procesar(1, { pagos: [], facturacion: { condicionPago: 'CONTADO' } }, { username: 'USER', planta_key: '98', perfil_id: 1 }),
        /PAGOS_REQUERIDOS/
    );
});

test('procesar rechaza pago incompleto (PAGO_INCOMPLETO) y exceso de pago (PAGO_EXCEDE_TOTAL)', async () => {
    const dbMock = require('../../../config/database');
    const authService = require('../services/faregas-auth.service');

    const duplicadoMock = {
        id: '1', certificado_original_id: '608', operacion_id: '991',
        planta_key: '98', precio: '50.00', estado: 'PENDIENTE_PAGO',
        operacion_estado: 'BORRADOR', numero_certificado: 'DG-41-012488'
    };

    dbMock.query = async (sql) => {
        if (sql.includes('SELECT d.*, c.numero_certificado')) {
            return { rowCount: 1, rows: [duplicadoMock] };
        }
        return { rowCount: 1, rows: [] };
    };
    dbMock.connect = async () => ({
        query: async (sql) => {
            if (sql.includes('SELECT d.*, c.numero_certificado')) {
                return { rowCount: 1, rows: [duplicadoMock] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    });
    authService.validarAccesoPlanta = async () => true;

    // Pago incompleto: S/ 20.00 de S/ 50.00
    await assert.rejects(
        () => duplicadosService.procesar(1, {
            pagos: [{ tipo: 'EFECTIVO', importe: 20 }],
            facturacion: { condicionPago: 'CONTADO' }
        }, { username: 'USER', planta_key: '98', perfil_id: 1 }),
        /PAGO_INCOMPLETO/
    );

    // Exceso de pago: S/ 60.00 de S/ 50.00
    await assert.rejects(
        () => duplicadosService.procesar(1, {
            pagos: [{ tipo: 'EFECTIVO', importe: 30 }, { tipo: 'TARJETA', importe: 30 }],
            facturacion: { condicionPago: 'CONTADO' }
        }, { username: 'USER', planta_key: '98', perfil_id: 1 }),
        /PAGO_EXCEDE_TOTAL/
    );
});

test('procesar acepta pago mixto (Efectivo S/ 20, Tarjeta S/ 20, Banco S/ 10), registra pagos y emite un solo comprobante', async () => {
    const dbMock = require('../../../config/database');
    const authService = require('../services/faregas-auth.service');
    const clientesService = require('../services/faregas-clientes.service');

    let pagosGuardados = null;
    let facturacionGuardada = null;
    let comprobanteEmitido = false;

    const mockPagosService = {
        guardarPagosOperacion: async (operacionId, data) => {
            pagosGuardados = data;
            return { orden: { estado: 'PAGADO', saldo_pendiente: 0 } };
        }
    };

    const mockFacturacionService = {
        guardarFacturacionOperacion: async (operacionId, data) => {
            facturacionGuardada = data;
            return { id: 701 };
        },
        emitirFacturacionOperacion: async () => {
            comprobanteEmitido = true;
            return {
                estado: 'ACEPTADO',
                aceptadaSunat: true,
                nroComprobante: 'BBB1-00000188',
                tipoComprobante: 'BOLETA'
            };
        }
    };

    const duplicadoMock = {
        id: '1', certificado_original_id: '608', operacion_id: '991',
        planta_key: '98', precio: '50.00', estado: 'PENDIENTE_PAGO',
        operacion_estado: 'BORRADOR', numero_certificado: 'DG-41-012488',
        facturacion_id_real: '701', nro_comprobante: 'BBB1-00000188',
        tipo_comprobante: 'BOLETA', facturacion_estado: 'ACEPTADO',
        aceptada_sunat: true
    };

    dbMock.query = async (sql) => {
        if (sql.includes('SELECT d.*, c.numero_certificado')) {
            return { rowCount: 1, rows: [duplicadoMock] };
        }
        if (sql.includes('SELECT id FROM fg_facturacion WHERE operacion_id=$1')) {
            return { rowCount: 1, rows: [{ id: '701' }] };
        }
        if (sql.includes('UPDATE fg_facturacion')) {
            return { rowCount: 1, rows: [{ id: '701' }] };
        }
        if (sql.includes('UPDATE fg_certificado_duplicado')) {
            duplicadoMock.estado = 'DISPONIBLE';
            return { rowCount: 1, rows: [] };
        }
        return { rowCount: 1, rows: [] };
    };
    dbMock.connect = async () => ({
        query: async (sql) => {
            if (sql.includes('SELECT d.*, c.numero_certificado')) {
                return { rowCount: 1, rows: [duplicadoMock] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    });
    authService.validarAccesoPlanta = async () => true;
    clientesService.asegurarCliente = async () => ({ id: 50 });

    const resultado = await duplicadosService.procesar(1, {
        pagos: [
            { tipo: 'EFECTIVO', importe: 20 },
            { tipo: 'TARJETA', importe: 20, tarjetaKey: 'VISA', nroOperacion: '112233' },
            { tipo: 'BANCO', importe: 10, nroOperacion: '998877', fechaDeposito: '2026-10-20' }
        ],
        facturacion: {
            tipoComprobante: 'BOLETA',
            tipoDocumentoCliente: 'DNI',
            nroDocumento: '74045612',
            nombreRazonSocial: 'JUAN PEREZ',
            direccion: 'AV. PRINCIPAL 123',
            condicionPago: 'CONTADO'
        }
    }, { username: 'OPERADOR', perfil_id: 1, planta_key: '98' }, {
        pagosService: mockPagosService,
        facturacionService: mockFacturacionService
    });

    // Validar pagos registrados
    assert.equal(pagosGuardados.importeTotal, 50);
    assert.equal(pagosGuardados.pagos.length, 3);
    assert.equal(pagosGuardados.pagos[0].importe, 20);
    assert.equal(pagosGuardados.pagos[1].importe, 20);
    assert.equal(pagosGuardados.pagos[2].importe, 10);

    // Validar comprobante unico
    assert.equal(comprobanteEmitido, true);
    assert.equal(facturacionGuardada.tipoComprobante, 'BOLETA');
    assert.equal(resultado.estado, 'DISPONIBLE');
    assert.equal(resultado.nroComprobante, 'BBB1-00000188');
});

test('obtenerDuplicadoAutorizado recupera los pagos registrados de la operacion', async () => {
    const dbMock = require('../../../config/database');
    const authService = require('../services/faregas-auth.service');

    dbMock.query = async (sql) => {
        if (sql.includes('SELECT d.*, c.numero_certificado')) {
            return {
                rowCount: 1,
                rows: [{
                    id: '1', certificado_original_id: '608', operacion_id: '991',
                    planta_key: '98', precio: '50.00', estado: 'PENDIENTE_PAGO',
                    operacion_estado: 'BORRADOR', numero_certificado: 'DG-41-012488'
                }]
            };
        }
        if (sql.includes('FROM fg_orden_pago o') && sql.includes('JOIN fg_pago p')) {
            return {
                rowCount: 2,
                rows: [
                    { id: '10', importe: '20.00', tipoContadoKey: 'efectivo' },
                    { id: '11', importe: '30.00', tipoContadoKey: 'tarjeta', tarjetaKey: 'VISA', nroOperacionTarjeta: '123456' }
                ]
            };
        }
        return { rowCount: 1, rows: [] };
    };
    authService.validarAccesoPlanta = async () => true;

    const duplicado = await duplicadosService.obtener(1, { username: 'OPERADOR', perfil_id: 1, planta_key: '98' });

    assert.equal(duplicado.id, 1);
    assert.equal(duplicado.pagos.length, 2);
    assert.equal(duplicado.pagos[0].tipo, 'EFECTIVO');
    assert.equal(duplicado.pagos[0].importe, 20);
    assert.equal(duplicado.pagos[1].tipo, 'TARJETA');
    assert.equal(duplicado.pagos[1].importe, 30);
});
