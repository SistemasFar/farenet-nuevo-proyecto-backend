const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const auth = require('../services/faregas-auth.service');
const service = require('../services/faregas-certificados.service');

test('lista por defecto todos los certificados del día para permitir acciones sobre emitidos', async () => {
    const queryOriginal = db.query;
    const plantasOriginal = auth.getPlantasPorUsuario;
    const consultas = [];
    auth.getPlantasPorUsuario = async () => [{ key: '201' }];
    db.query = async (sql, params) => {
        consultas.push({ sql, params });
        if (/COUNT\(DISTINCT c.id\)/i.test(sql)) return { rows: [{ count: '1' }] };
        return { rows: [{ id: 44, estado: 'BORRADOR', pasoActual: 'PAGO' }] };
    };
    try {
        const result = await service.obtenerBorradores(1, 10, 'ABC123', {
            username: 'operador', perfil_id: 'OPERADOR', planta_key: '201'
        });
        assert.equal(result.total, 1);
        assert.equal(result.data[0].id, 44);
        assert.equal(consultas[0].params[0], '201');
        assert.doesNotMatch(consultas[0].sql, /c\.estado = 'BORRADOR'/);
        assert.match(consultas[0].sql, /CURRENT_DATE/);
        assert.match(consultas[0].sql, /COALESCE\(c\.fecha_emision, c\.fecha_creacion::date\) >= CURRENT_DATE/);
        assert.match(consultas[1].sql, /WHEN c\.estado = 'EMITIDO' THEN COALESCE\(/);
        assert.match(consultas[1].sql, /SELECT MAX\(a\.fecha_evento\)/);
        assert.match(consultas[1].sql, /a\.evento = 'CERTIFICADO_EMITIDO'/);
        assert.match(consultas[1].sql, /a\.certificado_id = c\.id/);
        assert.match(consultas[1].sql, /c\.fecha_emision::timestamp/);
        assert.match(consultas[1].sql, /ELSE COALESCE\(c\.fecha_modificacion, c\.fecha_creacion\)/);
        assert.match(consultas[1].sql, /c\.id DESC/);
        assert.doesNotMatch(consultas[1].sql, /substring\s*\(\s*c\.numero_certificado/i);

        const indiceOrderByPrincipal = consultas[1].sql.lastIndexOf('ORDER BY CASE');
        const indiceLimitPrincipal = consultas[1].sql.lastIndexOf('LIMIT $');
        const indiceOffsetPrincipal = consultas[1].sql.indexOf('OFFSET $');
        assert.ok(indiceOrderByPrincipal >= 0);
        assert.ok(indiceOrderByPrincipal < indiceLimitPrincipal);
        assert.ok(indiceOrderByPrincipal < indiceOffsetPrincipal);

        assert.match(consultas[1].sql, /to_char\(c\.fecha_emision, 'DD\/MM\/YYYY'\) AS "fechaEmision"/);
        assert.equal(consultas[1].params[1], '%ABC123%');
    } finally {
        db.query = queryOriginal;
        auth.getPlantasPorUsuario = plantasOriginal;
    }
});

test('aplica un rango histórico inclusivo y rechaza rangos de fechas inválidos', async () => {
    const queryOriginal = db.query;
    const plantasOriginal = auth.getPlantasPorUsuario;
    const consultas = [];
    auth.getPlantasPorUsuario = async () => [{ key: '201' }];
    db.query = async (sql, params) => {
        consultas.push({ sql, params });
        if (/COUNT\(DISTINCT c.id\)/i.test(sql)) return { rows: [{ count: '1' }] };
        return { rows: [{ id: 45, estado: 'BORRADOR', pasoActual: 'PAGO' }] };
    };
    try {
        await service.obtenerBorradores(1, 10, '', {
            username: 'operador', perfil_id: 'OPERADOR', planta_key: '201'
        }, { fechaDesde: '2026-07-01', fechaHasta: '2026-08-24' });
        assert.match(consultas[0].sql, /COALESCE\(c\.fecha_emision, c\.fecha_creacion::date\) >= \$2::date/);
        assert.match(consultas[0].sql, /COALESCE\(c\.fecha_emision, c\.fecha_creacion::date\) < \(\$3::date \+ INTERVAL '1 day'\)/);
        assert.deepEqual(consultas[0].params, ['201', '2026-07-01', '2026-08-24']);

        await assert.rejects(
            service.obtenerBorradores(1, 10, '', {
                username: 'operador', perfil_id: 'OPERADOR', planta_key: '201'
            }, { fechaDesde: '2026-08-24', fechaHasta: '2026-08-01' }),
            /RANGO_FECHAS_INVALIDO/
        );
    } finally {
        db.query = queryOriginal;
        auth.getPlantasPorUsuario = plantasOriginal;
    }
});

test('impide recuperar un borrador perteneciente a una sede no autorizada', async () => {
    const queryOriginal = db.query;
    const accesoOriginal = auth.validarAccesoPlanta;
    db.query = async () => ({ rowCount: 1, rows: [{ id: 9, planta_key: '999', estado: 'BORRADOR' }] });
    auth.validarAccesoPlanta = async () => false;
    try {
        await assert.rejects(
            service.obtenerBorradorCompleto(9, { username: 'operador', perfil_id: 'OPERADOR' }),
            /PLANTA_NO_AUTORIZADA/
        );
    } finally {
        db.query = queryOriginal;
        auth.validarAccesoPlanta = accesoOriginal;
    }
});

test('persiste una transición consecutiva y rechaza saltarse pasos', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = auth.validarAccesoPlanta;
    const actualizaciones = [];
    let pasoActual = 'PAGO';
    const client = {
        query: async (sql, params) => {
            if (/SELECT estado, planta_key, paso_actual/i.test(sql)) {
                return { rowCount: 1, rows: [{ estado: 'BORRADOR', planta_key: '201', paso_actual: pasoActual }] };
            }
            if (/UPDATE fg_certificado/i.test(sql)) {
                actualizaciones.push(params);
                pasoActual = params[1];
            }
            return { rowCount: 0, rows: [] };
        },
        release: () => undefined
    };
    db.connect = async () => client;
    auth.validarAccesoPlanta = async () => true;
    try {
        const result = await service.actualizarPasoBorrador(7, 'VEHICULO', {
            username: 'operador', perfil_id: 'OPERADOR'
        });
        assert.equal(result.pasoActual, 'VEHICULO');
        assert.equal(actualizaciones.length, 1);
        await assert.rejects(
            service.actualizarPasoBorrador(7, 'VERIFICACION_EMISION', {
                username: 'operador', perfil_id: 'OPERADOR'
            }),
            /TRANSICION_PASO_INVALIDA/
        );
    } finally {
        db.connect = connectOriginal;
        auth.validarAccesoPlanta = accesoOriginal;
    }
});

test('permite guardar el vehículo después del pago y solo lo bloquea al iniciar facturación', async () => {
    const connectOriginal = db.connect;
    const accesoOriginal = auth.validarAccesoPlanta;
    const consultas = [];
    let facturacionIniciada = false;
    const client = {
        query: async (sql) => {
            consultas.push(sql);
            if (/SELECT estado, planta_key FROM fg_certificado/i.test(sql)) {
                return { rowCount: 1, rows: [{ estado: 'BORRADOR', planta_key: '201' }] };
            }
            if (/FROM fg_facturacion/i.test(sql)) {
                return facturacionIniciada
                    ? { rowCount: 1, rows: [{ '?column?': 1 }] }
                    : { rowCount: 0, rows: [] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => undefined
    };
    db.connect = async () => client;
    auth.validarAccesoPlanta = async () => true;
    try {
        await service.guardarVehiculoBorrador(163, { placa: 'ABC123' }, {
            username: 'operador', perfil_id: 'OPERADOR'
        });
        const consultaBloqueo = consultas.find((sql) => /FROM fg_facturacion/i.test(sql));
        assert.ok(consultaBloqueo);
        assert.doesNotMatch(consultaBloqueo, /fg_orden_pago/i);

        facturacionIniciada = true;
        await assert.rejects(
            service.guardarVehiculoBorrador(163, { placa: 'ABC123' }, {
                username: 'operador', perfil_id: 'OPERADOR'
            }),
            /DATOS_PREVIOS_NO_EDITABLES/
        );
    } finally {
        db.connect = connectOriginal;
        auth.validarAccesoPlanta = accesoOriginal;
    }
});

test('guarda los datos técnicos de taller usando la key de sede y conserva el resto del snapshot', async () => {
    const queryOriginal = db.query;
    const accesoOriginal = auth.validarAccesoPlanta;
    const consultas = [];
    let accesoValidado = null;

    db.query = async (sql, params) => {
        consultas.push({ sql: String(sql), params });
        if (/SELECT c\.id, c\.planta_key, c\.estado, c\.formato_datos_snapshot/i.test(sql)) {
            return {
                rowCount: 1,
                rows: [{
                    id: 244,
                    planta_key: '201',
                    estado: 'BORRADOR',
                    formato_datos_snapshot: { certificado: { titulo: 'LUHANEXO' } }
                }]
            };
        }
        if (/UPDATE fg_certificado/i.test(sql)) return { rowCount: 1, rows: [] };
        throw new Error(`Consulta inesperada: ${sql}`);
    };
    auth.validarAccesoPlanta = async (username, perfilId, plantaKey) => {
        accesoValidado = { username, perfilId, plantaKey };
        return { key: plantaKey };
    };

    try {
        await service.guardarTaller(244, {
            nombre: 'HOLA',
            direccion: 'DD',
            telefono: '999999999',
            ciudad: 'AAA',
            representanteLegal: 'AAAAA',
            numeroAutorizacion: 'AAAA',
            observaciones: 'AAAA',
            fechaProximaInspeccion: '2026-09-16'
        }, {
            username: 'operador',
            perfil_id: 'OPERADOR'
        });

        assert.deepEqual(accesoValidado, {
            username: 'operador',
            perfilId: 'OPERADOR',
            plantaKey: '201'
        });
        assert.equal(consultas.length, 2);
        assert.doesNotMatch(consultas[0].sql, /p\.codigo/i);
        const snapshot = consultas[1].params[0];
        assert.equal(snapshot.certificado.titulo, 'LUHANEXO');
        assert.equal(snapshot.taller.nombre, 'HOLA');
        assert.equal(snapshot.taller.numero_autorizacion, 'AAAA');
        assert.equal(snapshot.inspeccion.fecha_proxima_inspeccion, '2026-09-16');
    } finally {
        db.query = queryOriginal;
        auth.validarAccesoPlanta = accesoOriginal;
    }
});

test('construye el formulario técnico con las variables de la versión HTML de la operación', async () => {
    const queryOriginal = db.query;
    const accesoOriginal = auth.validarAccesoPlanta;
    db.query = async (sql) => {
        if (/FROM fg_certificado c/i.test(sql) && /formato_version_resuelta_id/i.test(sql)) {
            return {
                rowCount: 1,
                rows: [{
                    id: 247,
                    estado: 'BORRADOR',
                    paso_actual: 'VEHICULO',
                    planta_key: '201',
                    tipo_certificado_clave: 'GNV_ANUAL',
                    tipo_nombre: 'GNV anual',
                    servicio_codigo: '12222',
                    servicio_nombre: 'CERTIFICADO X',
                    servicio_modalidad: 'INICIAL',
                    servicio_tipo_flujo: 'TALLER_INSPECCION',
                    servicio_formato_id: 37,
                    formato_nombre: 'Certificado Conformidad (12222)',
                    formato_version_resuelta_id: 32,
                    formato_version: 1,
                    formato_version_estado: 'BORRADOR',
                    formato_version_motor: 'HTML_DINAMICO',
                    formato_version_configuracion: {
                        html: '<p><span data-faregas-var="taller.nombre">{{taller.nombre}}</span></p><p>{{personalizado.codigo_interno}}</p>',
                        variables_usadas: ['certificado.numero', 'taller.nombre'],
                        variables_personalizadas: [{ key: 'personalizado.codigo_interno', label: 'Código interno' }]
                    },
                    formato_datos_snapshot: {
                        taller: { nombre: 'TALLER GUARDADO' },
                        personalizado: { codigo_interno: 'ABC-9' }
                    }
                }]
            };
        }
        if (/FROM fg_certificado_vehiculo/i.test(sql)) return { rowCount: 0, rows: [] };
        if (/FROM fg_certificado_titular/i.test(sql)) return { rowCount: 0, rows: [] };
        throw new Error(`Consulta inesperada: ${sql}`);
    };
    auth.validarAccesoPlanta = async () => true;

    try {
        const result = await service.obtenerBorradorCompleto(247, {
            username: 'operador', perfil_id: 'OPERADOR'
        });
        assert.equal(result.servicio.tipoFlujo, 'TALLER_INSPECCION');
        assert.equal(result.formatoFormulario.versionEstado, 'BORRADOR');
        assert.deepEqual(result.formatoFormulario.campos.map((campo) => campo.key), [
            'taller.nombre',
            'personalizado.codigo_interno'
        ]);
        assert.equal(result.formatoFormulario.valores['taller.nombre'], 'TALLER GUARDADO');
        assert.equal(result.formatoFormulario.valores['personalizado.codigo_interno'], 'ABC-9');
    } finally {
        db.query = queryOriginal;
        auth.validarAccesoPlanta = accesoOriginal;
    }
});

test('guarda valores dinámicos por su clave sin borrar otros grupos del formato', async () => {
    const queryOriginal = db.query;
    const accesoOriginal = auth.validarAccesoPlanta;
    let snapshotGuardado;
    db.query = async (sql, params) => {
        if (/SELECT c\.id, c\.planta_key, c\.estado, c\.formato_datos_snapshot/i.test(sql)) {
            return {
                rowCount: 1,
                rows: [{
                    id: 248,
                    planta_key: '201',
                    estado: 'BORRADOR',
                    formato_datos_snapshot: { certificado: { referencia: 'NO-BORRAR' } }
                }]
            };
        }
        if (/UPDATE fg_certificado/i.test(sql)) {
            snapshotGuardado = params[0];
            return { rowCount: 1, rows: [] };
        }
        throw new Error(`Consulta inesperada: ${sql}`);
    };
    auth.validarAccesoPlanta = async () => true;

    try {
        await service.guardarTaller(248, {
            valores: {
                'taller.nombre': 'TALLER DINÁMICO',
                'personalizado.codigo_interno': 'XYZ-1'
            }
        }, { username: 'operador', perfil_id: 'OPERADOR' });

        assert.equal(snapshotGuardado.certificado.referencia, 'NO-BORRAR');
        assert.equal(snapshotGuardado.taller.nombre, 'TALLER DINÁMICO');
        assert.equal(snapshotGuardado.personalizado.codigo_interno, 'XYZ-1');
    } finally {
        db.query = queryOriginal;
        auth.validarAccesoPlanta = accesoOriginal;
    }
});
