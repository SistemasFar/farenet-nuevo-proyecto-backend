const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

process.env.FAREGAS_CREDENTIAL_VAULT_KEY = process.env.FAREGAS_CREDENTIAL_VAULT_KEY || 'b109039e9ab07d7a37a5cec432c149cb587e33e2c41f4eca12d87d2ec8fa8544';

const dbPath = require.resolve('../../../config/database');
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        connect: async () => { throw new Error('TEST_NO_DEBE_USAR_POSTGRESQL'); },
        query: async () => { throw new Error('TEST_NO_DEBE_USAR_POSTGRESQL'); },
    },
};
const dbMock = require(dbPath);

const inventarioService = require('../services/faregas-credenciales-inventario.service');
const usuariosController = require('../controllers/faregas-usuarios.controller');
const usuariosService = require('../services/faregas-usuarios.service');
const auditoriaService = require('../services/faregas-auditoria.service');

test('consultarCredencialAsignada protege a gibarra sin consultar hash ni exponer credencial', async () => {
    const res = await inventarioService.consultarCredencialAsignada('gibarra', dbMock);
    assert.equal(res.disponible, false);
    assert.equal(res.vigente, false);
    assert.equal(res.puedeRestablecer, false);
    assert.equal(res.estadoCredencial, 'Protegida (Excluida)');
    assert.match(res.motivo, /gibarra es una cuenta administrativa protegida/i);
});

test('registrarActualizacionCredencial rechaza modificar cuenta protegida gibarra', async () => {
    await assert.rejects(
        async () => {
            await inventarioService.registrarActualizacionCredencial(dbMock, {
                username: 'gibarra',
                responsable: 'otro_admin'
            });
        },
        (err) => {
            assert.equal(err.code, 'USUARIO_PROTEGIDO');
            return true;
        }
    );
});

test('consultarCredencialAsignada para jsturt consulta fuente dinámica en PostgreSQL y no depende de clave histórica', async () => {
    const fakeClient = {
        query: async (sql, params) => {
            const statement = String(sql);
            if (/FROM public\.fg_usuario_credencial/i.test(statement)) {
                return {
                    rowCount: 1,
                    rows: [{
                        username: 'jsturt',
                        estado_credencial: 'Contraseña actualizada / Vigente',
                        tipo_operacion: 'ACTUALIZACION_PASSWORD',
                        fecha_modificacion: new Date('2026-11-19T21:13:27.505Z'),
                        responsable: 'gibarra',
                        cambiada_posteriormente: true,
                        necesita_restablecimiento: false,
                        observaciones: 'Contraseña actualizada por gibarra el 19/11/2026; credencial anterior invalidada.'
                    }]
                };
            }
            if (/FROM fg_usuario u/i.test(statement)) {
                return {
                    rowCount: 1,
                    rows: [{
                        username: 'jsturt',
                        contrasenha: '$2b$10$fzIn4ix/6OY1tBlMUM4IfeHlVaMRSG7epwGfasiHkxq2TPT2IApOK',
                        estado: true,
                        perfil_id: 'CONTADOR',
                        nombre_completo: 'JORDAN FRANCIS STURT ARCIA',
                        sedes: 'SURCO, ATE'
                    }]
                };
            }
            return { rowCount: 0, rows: [] };
        }
    };

    const res = await inventarioService.consultarCredencialAsignada('jsturt', fakeClient);
    assert.equal(res.disponible, false);
    assert.equal(res.vigente, true);
    assert.equal(res.puedeRestablecer, true);
    assert.equal(res.responsableRestablecimiento, 'gibarra');
    assert.equal(res.estadoCredencial, 'Contraseña actualizada / Vigente');
    assert.match(res.motivo, /activa y vigente/i);
    assert.ok(res.fechaUltimoRestablecimiento);
    assert.equal(res.nombreCompleto, 'JORDAN FRANCIS STURT ARCIA');
});

test('enriquecerUsuariosConCredenciales consulta registro dinámico de credenciales', async () => {
    const fakeClient = {
        query: async (sql) => {
            const statement = String(sql);
            if (/FROM public\.fg_usuario_credencial/i.test(statement)) {
                return {
                    rowCount: 1,
                    rows: [{
                        username: 'jsturt',
                        estado_credencial: 'Restablecida (Individual)',
                        tipo_operacion: 'RESTABLECIMIENTO_INDIVIDUAL',
                        fecha_modificacion: new Date('2026-11-19T21:13:27.505Z'),
                        responsable: 'gibarra',
                        cambiada_posteriormente: true,
                        necesita_restablecimiento: false,
                        observaciones: 'Contraseña restablecida por gibarra'
                    }]
                };
            }
            return { rowCount: 0, rows: [] };
        }
    };

    const lista = [
        { username: 'jsturt', estado: true },
        { username: 'gibarra', estado: true }
    ];

    const enriquecidos = await inventarioService.enriquecerUsuariosConCredenciales(lista, fakeClient);
    assert.equal(enriquecidos.length, 2);

    const jsturt = enriquecidos.find(u => u.username === 'jsturt');
    assert.equal(jsturt.estadoCredencial, 'Restablecida (Individual)');
    assert.equal(jsturt.responsableRestablecimiento, 'gibarra');
    assert.equal(jsturt.cambiadaPosteriormente, true);

    const gibarra = enriquecidos.find(u => u.username === 'gibarra');
    assert.equal(gibarra.estadoCredencial, 'Protegida (Excluida)');
    assert.equal(gibarra.responsableRestablecimiento, null);
});

test('generarBufferExcelInventario genera un XLSX dinámico válido sin exponer contraseñas en claro', async () => {
    const fakeClient = {
        query: async () => ({
            rowCount: 2,
            rows: [
                {
                    username: 'gibarra',
                    cuenta_activa: true,
                    perfil: 'ADMINISTRADOR',
                    nombre_completo: 'GUSTAVO IBARRA',
                    documento: 'DNI 00000001',
                    estado_credencial: 'Protegida (Excluida)',
                    tipo_operacion: 'PROTEGIDA',
                    fecha_modificacion: null,
                    responsable: 'SISTEMA',
                    cambiada_posteriormente: false,
                    necesita_restablecimiento: false,
                    observaciones: 'Cuenta protegida'
                },
                {
                    username: 'jsturt',
                    cuenta_activa: true,
                    perfil: 'CONTADOR',
                    nombre_completo: 'JORDAN FRANCIS STURT ARCIA',
                    documento: 'DNI 12345678',
                    estado_credencial: 'Restablecida (Individual)',
                    tipo_operacion: 'RESTABLECIMIENTO_INDIVIDUAL',
                    fecha_modificacion: new Date('2026-11-19T21:13:27.505Z'),
                    responsable: 'gibarra',
                    cambiada_posteriormente: true,
                    necesita_restablecimiento: false,
                    observaciones: 'Contraseña restablecida por gibarra'
                }
            ]
        })
    };

    const buffer = await inventarioService.generarBufferExcelInventario(fakeClient, {
        solicitante: 'gibarra'
    });

    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 1000);

    // Descomprimir XLSX con PizZip y verificar que contiene los datos dinámicos y NO contraseñas
    const PizZip = require('pizzip');
    const zip = new PizZip(buffer);
    const sheetXml = zip.file('xl/worksheets/sheet1.xml').asText();

    assert.ok(sheetXml.includes('jsturt'));
    assert.ok(sheetXml.includes('gibarra'));
    assert.ok(sheetXml.includes('Restablecida (Individual)'));
    assert.ok(sheetXml.includes('Protegida (Excluida)'));
    assert.equal(sheetXml.includes('contrasenha'), false);
    assert.equal(sheetXml.includes('password'), false);
});

test('actualizarUsuario ejecuta actualización transaccional de fg_usuario_credencial', async () => {
    const queries = [];
    const mockClient = {
        query: async (sql, params) => {
            queries.push({ sql: String(sql), params });
            if (/to_regclass/i.test(sql)) return { rowCount: 1, rows: [{ disponible: true }] };
            if (/FROM fg_usuario_perfil/i.test(sql)) return { rowCount: 0, rows: [] };
            if (/UPDATE fg_usuario/i.test(sql)) return { rowCount: 1, rows: [] };
            if (/DELETE FROM fg_usuario_planta/i.test(sql)) return { rowCount: 1, rows: [] };
            if (/INSERT INTO public\.fg_usuario_credencial/i.test(sql)) return { rowCount: 1, rows: [] };
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };

    dbMock.connect = async () => mockClient;

    await usuariosService.actualizarUsuario('testuser', {
        username: 'testuser',
        perfil_id: 'CONTADOR',
        estado: true,
        password: 'NuevaClaveSegura#2026',
        confirmPassword: 'NuevaClaveSegura#2026',
        tipoDocumentoKey: 'dni',
        nroDocumento: '12345678',
        nombres: 'TEST',
        apellidos: 'USUARIO',
        nombreRazonSocial: '',
        paisKey: 'PE',
        departamentoKey: '15',
        provinciaKey: '1501',
        distritoKey: '150101',
        direccion: 'AVENIDA PRUEBA 123',
        email: 'test@example.pe',
        telefono: '987654321',
        sedes: []
    }, 'admin_responsable');

    const credQuery = queries.find(q => /INSERT INTO public\.fg_usuario_credencial/i.test(q.sql));
    assert.ok(credQuery, 'Debe ejecutar inserción/actualización en fg_usuario_credencial');
    assert.equal(credQuery.params[0], 'testuser');
    assert.equal(credQuery.params[1], 'Contraseña actualizada / Vigente');
    assert.equal(credQuery.params[2], 'ACTUALIZACION_PASSWORD');
    assert.equal(credQuery.params[3], 'admin_responsable');
    assert.equal(credQuery.params[4], true); // cambiadaPosteriormente

    const custodiaQuery = queries.find(q => /INSERT INTO public\.fg_credencial_custodia/i.test(q.sql));
    assert.ok(custodiaQuery, 'Debe guardar la credencial cifrada en fg_credencial_custodia');
    assert.equal(custodiaQuery.params[0], 'testuser');
    assert.equal(custodiaQuery.params[6], 'EDICION_USUARIO');
    assert.equal(custodiaQuery.params[7], 'admin_responsable');
});

test('generarCredencialTemporal rechaza cuenta protegida gibarra', async () => {
    await assert.rejects(
        async () => {
            await usuariosService.generarCredencialTemporal('gibarra', 'admin');
        },
        (err) => {
            assert.equal(err.code, 'USUARIO_PROTEGIDO');
            return true;
        }
    );
});

test('generarCredencialTemporal genera clave segura y actualiza fg_usuario y fg_usuario_credencial', async () => {
    const queries = [];
    const mockClient = {
        query: async (sql, params) => {
            queries.push({ sql: String(sql), params });
            if (/SELECT username, estado, perfil_id FROM fg_usuario/i.test(sql)) {
                return { rowCount: 1, rows: [{ username: 'usuario_prueba', estado: true, perfil_id: 'CONTADOR' }] };
            }
            if (/UPDATE fg_usuario SET contrasenha/i.test(sql)) {
                return { rowCount: 1, rows: [] };
            }
            if (/UPDATE fg_usuario_sesion/i.test(sql)) {
                return { rowCount: 0, rows: [] };
            }
            if (/INSERT INTO public\.fg_usuario_credencial/i.test(sql)) {
                return { rowCount: 1, rows: [] };
            }
            if (/SELECT.*FROM fg_usuario u/i.test(sql)) {
                return { rowCount: 1, rows: [{ nombre_completo: 'USUARIO PRUEBA', sedes: 'SURCO' }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };

    dbMock.connect = async () => mockClient;

    const res = await usuariosService.generarCredencialTemporal('usuario_prueba', 'admin_operador');
    assert.equal(res.username, 'usuario_prueba');
    assert.ok(res.password, 'Debe devolver la contraseña generada');
    assert.ok(res.password.length >= 16, 'Debe cumplir longitud segura');
    assert.equal(res.responsable, 'admin_operador');

    const updateQuery = queries.find(q => /UPDATE fg_usuario SET contrasenha/i.test(q.sql));
    assert.ok(updateQuery, 'Debe actualizar contrasenha en fg_usuario');
    assert.ok(bcrypt.compareSync(res.password, updateQuery.params[0]), 'El hash debe coincidir con la clave generada');

    const credQuery = queries.find(q => /INSERT INTO public\.fg_usuario_credencial/i.test(q.sql));
    assert.ok(credQuery, 'Debe registrar en fg_usuario_credencial');
    assert.equal(credQuery.params[0], 'usuario_prueba');
    assert.equal(credQuery.params[1], 'Contraseña actualizada / Vigente');
    assert.equal(credQuery.params[3], 'admin_operador');

    const custodiaQuery = queries.find(q => /INSERT INTO public\.fg_credencial_custodia/i.test(q.sql));
    assert.ok(custodiaQuery, 'Debe registrar la credencial temporal en fg_credencial_custodia');
    assert.equal(custodiaQuery.params[0], 'usuario_prueba');
    assert.equal(custodiaQuery.params[6], 'RESTABLECIMIENTO_TEMPORAL');
    assert.equal(custodiaQuery.params[7], 'admin_operador');
});

test('controller.generarCredencialTemporal responde 403 para gibarra y 200 con datos para usuario permitido', async () => {
    let eventoAudit = null;
    const originalAudit = auditoriaService.registrarEvento;
    const originalGenerar = usuariosService.generarCredencialTemporal;

    auditoriaService.registrarEvento = async (evt) => { eventoAudit = evt; };
    usuariosService.generarCredencialTemporal = async (username, responsable) => ({
        username,
        password: 'Fg7!TemporalTestClave#2026',
        nombreCompleto: 'USUARIO PRUEBA',
        perfil: 'CONTADOR',
        sede: 'SURCO',
        fechaModificacion: '2026-11-19T21:00:00.000Z',
        responsable
    });

    try {
        // Caso gibarra
        const resGibarra = {
            statusCode: 200,
            status(c) { this.statusCode = c; return this; },
            json(d) { this.data = d; return this; }
        };
        await usuariosController.generarCredencialTemporal({
            params: { username: 'gibarra' },
            user: { username: 'admin' }
        }, resGibarra);
        assert.equal(resGibarra.statusCode, 403);
        assert.equal(resGibarra.data.codigo, 'USUARIO_PROTEGIDO');

        // Caso usuario permitido
        const resUsuario = {
            statusCode: 200,
            status(c) { this.statusCode = c; return this; },
            json(d) { this.data = d; return this; }
        };
        await usuariosController.generarCredencialTemporal({
            params: { username: 'usuario_prueba' },
            user: { username: 'admin_operador' }
        }, resUsuario);
        assert.equal(resUsuario.statusCode, 200);
        assert.equal(resUsuario.data.success, true);
        assert.equal(resUsuario.data.password, 'Fg7!TemporalTestClave#2026');
        assert.ok(eventoAudit);
        assert.equal(eventoAudit.evento, 'PASSWORD_ACTUALIZADO');
    } finally {
        auditoriaService.registrarEvento = originalAudit;
        usuariosService.generarCredencialTemporal = originalGenerar;
    }
});

test('controller.revelarCredencialCustodiada exige reautenticación, audita y entrega credencial protegida', async () => {
    const authService = require('../services/faregas-auth.service');
    const custodiaService = require('../services/faregas-credencial-custodia.service');

    const originalValidar = authService.validarFaregas;
    const originalDescifrar = custodiaService.obtenerCredencialDescifrada;
    const originalAudit = auditoriaService.registrarEvento;

    let auditRegistrado = null;
    auditoriaService.registrarEvento = async (evt) => { auditRegistrado = evt; };

    try {
        // 1. Rechaza gibarra
        const resGibarra = {
            statusCode: 200,
            status(c) { this.statusCode = c; return this; },
            json(d) { this.data = d; return this; }
        };
        await usuariosController.revelarCredencialCustodiada({
            params: { username: 'gibarra' },
            user: { username: 'admin' },
            body: { passwordAdmin: 'AdminPass#123' }
        }, resGibarra);
        assert.equal(resGibarra.statusCode, 403);
        assert.equal(resGibarra.data.codigo, 'USUARIO_PROTEGIDO');

        // 2. Rechaza si falta passwordAdmin
        const resSinPass = {
            statusCode: 200,
            status(c) { this.statusCode = c; return this; },
            json(d) { this.data = d; return this; }
        };
        await usuariosController.revelarCredencialCustodiada({
            params: { username: 'testuser' },
            user: { username: 'admin' },
            body: {}
        }, resSinPass);
        assert.equal(resSinPass.statusCode, 400);
        assert.equal(resSinPass.data.codigo, 'PASSWORD_ADMIN_REQUERIDA');

        // 3. Rechaza si passwordAdmin es incorrecta
        authService.validarFaregas = async () => ({ valido: false });
        const resReauthFail = {
            statusCode: 200,
            status(c) { this.statusCode = c; return this; },
            json(d) { this.data = d; return this; }
        };
        await usuariosController.revelarCredencialCustodiada({
            params: { username: 'testuser' },
            user: { username: 'admin' },
            body: { passwordAdmin: 'ClaveIncorrecta' }
        }, resReauthFail);
        assert.equal(resReauthFail.statusCode, 401);
        assert.equal(resReauthFail.data.codigo, 'REAUTENTICACION_FALLIDA');
        assert.equal(auditRegistrado.evento, 'CREDENCIAL_REVELACION_FALLIDA');

        // 4. Acepta y entrega cuando reautenticación es correcta
        authService.validarFaregas = async () => ({ valido: true, usuario: { username: 'admin' } });
        custodiaService.obtenerCredencialDescifrada = async () => ({
            username: 'testuser',
            password: 'ClaveCustodiadaDescifrada#2026',
            creadoPor: 'admin',
            fechaActualizacion: new Date()
        });

        const resExito = {
            statusCode: 200,
            headers: {},
            set(k, v) { this.headers[k] = v; },
            status(c) { this.statusCode = c; return this; },
            json(d) { this.data = d; return this; }
        };
        await usuariosController.revelarCredencialCustodiada({
            params: { username: 'testuser' },
            user: { username: 'admin' },
            body: { passwordAdmin: 'AdminPassCorrecta#2026' }
        }, resExito);

        assert.equal(resExito.statusCode, 200);
        assert.equal(resExito.data.success, true);
        assert.equal(resExito.data.password, 'ClaveCustodiadaDescifrada#2026');
        assert.equal(resExito.headers['Cache-Control'], 'no-store, no-cache, must-revalidate, private');
        assert.equal(auditRegistrado.evento, 'CREDENCIAL_REVELADA');
        assert.ok(!auditRegistrado.mensaje.includes('ClaveCustodiadaDescifrada#2026'), 'Auditoría nunca debe contener la clave en claro');
    } finally {
        authService.validarFaregas = originalValidar;
        custodiaService.obtenerCredencialDescifrada = originalDescifrar;
        auditoriaService.registrarEvento = originalAudit;
    }
});
