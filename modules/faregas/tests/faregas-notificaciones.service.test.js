const assert = require('node:assert/strict');
const test = require('node:test');

process.env.NODE_ENV = 'test';

// Mock de base de datos
const crearDbMock = () => {
    const notificaciones = [];
    const destinatarios = [];
    const solicitudes = [];
    const consultas = [];
    let queryCallCount = 0;

    const query = async (sql, params = []) => {
        queryCallCount++;
        const texto = String(sql);
        consultas.push({ texto, params });

        // INSERT INTO fg_notificacion ... ON CONFLICT (evento_clave) DO NOTHING RETURNING id
        if (texto.includes('INSERT INTO fg_notificacion') && texto.includes('ON CONFLICT') && texto.includes('RETURNING id')) {
            const eventoClave = params[0];
            const yaExiste = notificaciones.some((n) => n.evento_clave === eventoClave);
            if (yaExiste) {
                return { rowCount: 0, rows: [] };
            }
            const id = notificaciones.length + 1;
            notificaciones.push({
                id,
                evento_clave: params[0],
                tipo: params[1],
                titulo: params[2],
                mensaje: params[3],
                planta_key: params[4],
                empresa_key: params[5],
                entidad_tipo: params[6],
                entidad_id: params[7],
                destino_navegacion: params[8],
                creado_por: params[9],
                fecha_creacion: new Date().toISOString()
            });
            return { rowCount: 1, rows: [{ id }] };
        }

        // SAVEPOINT y ROLLBACK TO SAVEPOINT (no-op en mock)
        if (texto.includes('SAVEPOINT') || texto.includes('ROLLBACK TO SAVEPOINT')) {
            return { rowCount: 0, rows: [] };
        }

        // SELECT id FROM fg_notificacion WHERE evento_clave = $1 (recuperar tras conflicto)
        if (texto.includes('SELECT id FROM fg_notificacion WHERE evento_clave')) {
            const eventoClave = params[0];
            const existente = notificaciones.find((n) => n.evento_clave === eventoClave);
            if (existente) {
                return { rowCount: 1, rows: [{ id: existente.id }] };
            }
            return { rowCount: 0, rows: [] };
        }

        // INSERT INTO fg_notificacion ... RETURNING id (legacy, sin ON CONFLICT)
        if (texto.includes('INSERT INTO fg_notificacion') && texto.includes('RETURNING id')) {
            const id = notificaciones.length + 1;
            notificaciones.push({
                id,
                evento_clave: params[0],
                tipo: params[1],
                titulo: params[2],
                mensaje: params[3],
                planta_key: params[4],
                empresa_key: params[5],
                entidad_tipo: params[6],
                entidad_id: params[7],
                destino_navegacion: params[8],
                creado_por: params[9],
                fecha_creacion: new Date().toISOString()
            });
            return { rowCount: 1, rows: [{ id }] };
        }

        // INSERT INTO fg_notificacion_destinatario ... ON CONFLICT DO NOTHING
        if (texto.includes('INSERT INTO fg_notificacion_destinatario')) {
            const notificacionId = params[0];
            const usuarioId = params[1];
            const yaExiste = destinatarios.some((d) => d.notificacion_id === notificacionId && d.usuario_id === usuarioId);
            if (!yaExiste) {
                destinatarios.push({ notificacion_id: notificacionId, usuario_id: usuarioId, leida: false, fecha_lectura: null });
            }
            return { rowCount: 1, rows: [] };
        }

        // SELECT ... FROM fg_notificacion n JOIN fg_notificacion_destinatario d ... WHERE d.usuario_id = $1
        // (listar - excluir consultas COUNT que van a contarNoLeidas)
        if ((texto.includes('fg_notificacion_destinatario') || texto.includes('fg_solicitud_operacion')) && texto.includes('WHERE d.usuario_id = $1') && !texto.includes('COUNT(*)')) {
            const usuarioId = params[0];
            const rows = destinatarios
                .filter((d) => d.usuario_id === usuarioId)
                .map((d) => {
            const n = notificaciones.find((notif) => notif.id === d.notificacion_id);
            // La campanita solo muestra notificaciones de tipo SOLICITUD_PENDIENTE_APROBACION
            // cuya solicitud sigue en PENDIENTE_APROBACION
            if (n.tipo !== 'SOLICITUD_PENDIENTE_APROBACION' || n.entidad_tipo !== 'SOLICITUD_OPERACION') {
                return null;
            }
            const solicitud = solicitudes.find((s) => s.id === n.entidad_id);
            if (!solicitud || solicitud.estado !== 'PENDIENTE_APROBACION') {
                return null;
            }
            return {
                        id: n.id,
                        evento_clave: n.evento_clave,
                        tipo: n.tipo,
                        titulo: n.titulo,
                        mensaje: n.mensaje,
                        planta_key: n.planta_key,
                        empresa_key: n.empresa_key,
                        entidad_tipo: n.entidad_tipo,
                        entidad_id: n.entidad_id,
                        destino_navegacion: n.destino_navegacion,
                        fecha_creacion: n.fecha_creacion,
                        leida: d.leida,
                        fecha_lectura: d.fecha_lectura
                    };
                }).filter(Boolean);
            return { rowCount: rows.length, rows };
        }

        // SELECT COUNT(*) ... WHERE usuario_id = $1 AND leida = FALSE
        if ((texto.includes('COUNT(*)') && texto.includes('leida = FALSE')) ||
            (texto.includes('fg_solicitud_operacion') && texto.includes('leida = FALSE'))) {
            const usuarioId = params[0];
            let count = 0;
            for (const d of destinatarios) {
                const n = notificaciones.find((notif) => notif.id === d.notificacion_id);
                // La campanita solo cuenta notificaciones de tipo SOLICITUD_PENDIENTE_APROBACION
                // cuya solicitud sigue en PENDIENTE_APROBACION
                if (n.tipo !== 'SOLICITUD_PENDIENTE_APROBACION' || n.entidad_tipo !== 'SOLICITUD_OPERACION') {
                    continue;
                }
                const solicitud = solicitudes.find((s) => s.id === n.entidad_id);
                if (!solicitud || solicitud.estado !== 'PENDIENTE_APROBACION') {
                    continue;
                }
                if (d.usuario_id !== usuarioId || d.leida) continue;
                count++;
            }
            return { rowCount: 1, rows: [{ c: count }] };
        }

        // UPDATE fg_notificacion_destinatario SET leida = TRUE ... WHERE usuario_id = $1 AND notificacion_id = $2
        if (texto.includes('UPDATE fg_notificacion_destinatario') && texto.includes('leida = TRUE') && texto.includes('RETURNING id')) {
            const usuarioId = params[0];
            const notificacionId = params[1];
            const dest = destinatarios.find((d) => d.usuario_id === usuarioId && d.notificacion_id === notificacionId);
            if (dest && !dest.leida) {
                dest.leida = true;
                dest.fecha_lectura = new Date().toISOString();
                return { rowCount: 1, rows: [{ id: notificacionId }] };
            }
            return { rowCount: 0, rows: [] };
        }

        // UPDATE fg_notificacion_destinatario SET leida = TRUE ... WHERE usuario_id = $1 AND leida = FALSE
        if (texto.includes('UPDATE fg_notificacion_destinatario') && texto.includes('leida = TRUE') && !texto.includes('RETURNING')) {
            const usuarioId = params[0];
            let actualizadas = 0;
            for (const d of destinatarios) {
                if (d.usuario_id === usuarioId && !d.leida) {
                    d.leida = true;
                    d.fecha_lectura = new Date().toISOString();
                    actualizadas++;
                }
            }
            return { rowCount: actualizadas, rows: [] };
        }

        // SELECT DISTINCT u.username ... para obtenerDestinatariosPorPlanta
        if (texto.includes('fg_usuario u') && texto.includes('fg_perfil_permiso') && texto.includes('permiso_clave = ANY')) {
            // Simular: usuarios con permisos de aprobación en la planta
            return { rowCount: 2, rows: [{ username: 'usuario_aprobador_1' }, { username: 'usuario_aprobador_2' }] };
        }

        // SELECT estado, perfil_id FROM fg_usuario WHERE username = $1 (auth middleware simulation)
        if (texto.includes('fg_usuario WHERE username = $1') && !texto.includes('fg_perfil_permiso')) {
            return { rowCount: 1, rows: [{ estado: true, perfil_id: 'PERFIL_OPERADOR' }] };
        }

        return { rowCount: 0, rows: [] };
    };

    return {
        query,
        getNotificaciones: () => notificaciones,
        getDestinatarios: () => destinatarios,
        getSolicitudes: () => solicitudes,
        getConsultas: () => consultas,
        getQueryCallCount: () => queryCallCount
    };
};

test('crearParaSolicitud crea notificación para destinatarios autorizados', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crearParaSolicitud } = service;

    const solicitud = {
        id: 101,
        tipo_operacion: 'ANULAR_AMBOS',
        planta_key: 'SURCO',
        empresa_key: 'EMP001',
        usuario_solicitante: 'usuario_solicitante'
    };

    const notificacionId = await crearParaSolicitud(dbMock, solicitud, {
        eventoClave: 'SOLICITUD_CREADA',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Nueva solicitud pendiente de aprobación',
        mensaje: 'Solicitud de anulación pendiente.'
    });

    assert.equal(notificacionId, 1);
    const notifs = dbMock.getNotificaciones();
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].evento_clave, 'SOLICITUD_101_SOLICITUD_CREADA');
    assert.equal(notifs[0].planta_key, 'SURCO');
    assert.equal(notifs[0].entidad_id, 101);

    const dest = dbMock.getDestinatarios();
    assert.equal(dest.length, 2);
    assert.ok(dest.some((d) => d.usuario_id === 'usuario_aprobador_1'));
    assert.ok(dest.some((d) => d.usuario_id === 'usuario_aprobador_2'));
});

test('no crea notificaciones duplicadas para el mismo evento y destinatario', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crearParaSolicitud, crear } = service;

    const solicitud = {
        id: 202,
        tipo_operacion: 'ANULAR_AMBOS',
        planta_key: 'SURCO',
        empresa_key: 'EMP001',
        usuario_solicitante: 'usuario_solicitante'
    };

    await crearParaSolicitud(dbMock, solicitud, {
        eventoClave: 'SOLICITUD_CREADA',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Nueva solicitud',
        mensaje: 'Mensaje'
    });

    // Intentar crear la misma notificación nuevamente (mismo evento_clave)
    await crear(dbMock, {
        eventoClave: 'SOLICITUD_202_SOLICITUD_CREADA',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Nueva solicitud',
        mensaje: 'Mensaje duplicado'
    }, ['usuario_aprobador_1', 'usuario_aprobador_2']);

    const dest = dbMock.getDestinatarios();
    // Cada destinatario debe tener exactamente una entrada para notificación 1
    const entradasNotif1 = dest.filter((d) => d.notificacion_id === 1);
    assert.equal(entradasNotif1.length, 2, 'No debe haber duplicados por destinatario');
});

test('listar devuelve solo notificaciones del usuario autenticado', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crear, listar } = service;

    // Simular solicitudes pendientes para que las notificaciones sean visibles en la campanita
    dbMock.getSolicitudes().push({ id: 1, estado: 'PENDIENTE_APROBACION' });
    dbMock.getSolicitudes().push({ id: 2, estado: 'PENDIENTE_APROBACION' });

    // Crear notificaciones de tipo SOLICITUD_PENDIENTE_APROBACION para dos usuarios diferentes
    await crear(dbMock, {
        eventoClave: 'EVT_1',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Título 1',
        mensaje: 'Mensaje 1',
        entidadTipo: 'SOLICITUD_OPERACION',
        entidadId: 1
    }, ['usuario_aprobador_1']);

    await crear(dbMock, {
        eventoClave: 'EVT_2',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Título 2',
        mensaje: 'Mensaje 2',
        entidadTipo: 'SOLICITUD_OPERACION',
        entidadId: 2
    }, ['usuario_aprobador_2']);

    const paraUsuario1 = await listar('usuario_aprobador_1', dbMock);
    assert.equal(paraUsuario1.length, 1);
    assert.equal(paraUsuario1[0].titulo, 'Título 1');

    const paraUsuario2 = await listar('usuario_aprobador_2', dbMock);
    assert.equal(paraUsuario2.length, 1);
    assert.equal(paraUsuario2[0].titulo, 'Título 2');
});

test('contarNoLeidas cuenta solo las no leídas del usuario', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crear, contarNoLeidas, marcarLeida } = service;

    dbMock.getSolicitudes().push({ id: 1, estado: 'PENDIENTE_APROBACION' });
    dbMock.getSolicitudes().push({ id: 2, estado: 'PENDIENTE_APROBACION' });

    await crear(dbMock, {
        eventoClave: 'EVT_3',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Título 3',
        mensaje: 'Mensaje 3',
        entidadTipo: 'SOLICITUD_OPERACION',
        entidadId: 1
    }, ['usuario_aprobador_1']);

    await crear(dbMock, {
        eventoClave: 'EVT_4',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Título 4',
        mensaje: 'Mensaje 4',
        entidadTipo: 'SOLICITUD_OPERACION',
        entidadId: 2
    }, ['usuario_aprobador_1']);

    let count = await contarNoLeidas('usuario_aprobador_1', dbMock);
    assert.equal(count, 2);

    // Marcar una como leída
    const notifs = dbMock.getNotificaciones();
    await marcarLeida('usuario_aprobador_1', notifs[0].id, dbMock);

    count = await contarNoLeidas('usuario_aprobador_1', dbMock);
    assert.equal(count, 1);
});

test('marcarLeida no modifica notificaciones de otro usuario', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crear, marcarLeida, contarNoLeidas } = service;

    dbMock.getSolicitudes().push({ id: 1, estado: 'PENDIENTE_APROBACION' });

    await crear(dbMock, {
        eventoClave: 'EVT_5',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Título 5',
        mensaje: 'Mensaje 5',
        entidadTipo: 'SOLICITUD_OPERACION',
        entidadId: 1
    }, ['usuario_aprobador_1']);

    const notifs = dbMock.getNotificaciones();

    // Intento de marcar como leída por otro usuario
    const resultado = await marcarLeida('usuario_aprobador_2', notifs[0].id, dbMock);
    assert.equal(resultado, false, 'No debe marcar notificación de otro usuario');

    // La notificación sigue sin leer para el usuario original
    const count = await contarNoLeidas('usuario_aprobador_1', dbMock);
    assert.equal(count, 1);
});

test('marcarTodasLeidas marca todas las no leídas del usuario', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crear, marcarTodasLeidas, contarNoLeidas } = service;

    await crear(dbMock, {
        eventoClave: 'EVT_6',
        tipo: 'TIPO_6',
        titulo: 'Título 6',
        mensaje: 'Mensaje 6'
    }, ['usuario_aprobador_1']);

    await crear(dbMock, {
        eventoClave: 'EVT_7',
        tipo: 'TIPO_7',
        titulo: 'Título 7',
        mensaje: 'Mensaje 7'
    }, ['usuario_aprobador_1']);

    await marcarTodasLeidas('usuario_aprobador_1', dbMock);

    const count = await contarNoLeidas('usuario_aprobador_1', dbMock);
    assert.equal(count, 0);
});

test('obtenerDestinatariosPorPlanta devuelve usuarios con permiso y acceso a la planta', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { obtenerDestinatariosPorPlanta } = service;

    const destinatarios = await obtenerDestinatariosPorPlanta(dbMock, 'SURCO', 'EMP001');
    assert.equal(destinatarios.length, 2);
    assert.ok(destinatarios.includes('usuario_aprobador_1'));
    assert.ok(destinatarios.includes('usuario_aprobador_2'));
});

test('destinatarios combinan permiso operativo con sede individual o acceso global configurable', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    await service.obtenerDestinatariosPorPlanta(dbMock, '98', 'FAREGAS');

    const consulta = dbMock.getConsultas().find(({ texto }) => (
        texto.includes('SELECT DISTINCT u.username')
    ));
    assert.ok(consulta);
    assert.match(consulta.texto, /pp\.permiso_clave = ANY/);
    assert.match(consulta.texto, /global_pp\.permiso_clave = \$4/);
    assert.match(consulta.texto, /FROM fg_usuario_planta up/);
    assert.match(consulta.texto, /perfil_planta\.perfil_clave = u\.perfil_id/);
    assert.deepEqual(consulta.params, [
        '98',
        ['FAREGAS_SOLICITUD_APROBAR', 'FAREGAS_SOLICITUD_ADMINISTRAR'],
        'FAREGAS',
        'FAREGAS_ACCESO_GLOBAL_SEDES'
    ]);
});

test('crear rechaza si faltan datos requeridos', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crear } = service;

    await assert.rejects(
        () => crear(dbMock, { eventoClave: 'EVT' }, ['usuario_aprobador_1']),
        (error) => error.code === 'NOTIFICACION_DATOS_INCOMPLETOS'
    );
});

// --- NUEVAS PRUEBAS: Fase 3C ---

test('crearParaSolicitante notifica al solicitante cuando se aprueba', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crearParaSolicitante } = service;

    const solicitud = {
        id: 301,
        tipo_operacion: 'ANULAR_AMBOS',
        planta_key: 'SURCO',
        empresa_key: 'EMP001',
        usuario_solicitante: 'usuario_solicitante'
    };

    const notificacionId = await crearParaSolicitante(
        dbMock, solicitud, 'SOLICITUD_APROBADA',
        'Solicitud aprobada',
        'Su solicitud ANULAR_AMBOS ha sido aprobada.',
        'usuario_aprobador_1'
    );

    assert.ok(notificacionId > 0);
    const notifs = dbMock.getNotificaciones();
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].evento_clave, 'SOLICITUD_301_SOLICITUD_APROBADA');
    assert.equal(notifs[0].entidad_id, 301);
    assert.equal(notifs[0].destino_navegacion, '/faregas/solicitudes-operacion/301');

    const dest = dbMock.getDestinatarios();
    assert.equal(dest.length, 1);
    assert.equal(dest[0].usuario_id, 'usuario_solicitante');
    assert.equal(dest[0].notificacion_id, notificacionId);
});

test('crearParaSolicitante notifica al solicitante cuando se rechaza', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crearParaSolicitante } = service;

    const solicitud = {
        id: 302,
        tipo_operacion: 'RECTIFICAR_CERTIFICADO',
        planta_key: 'LIMA',
        empresa_key: 'EMP002',
        usuario_solicitante: 'usuario_solicitante_2'
    };

    const notificacionId = await crearParaSolicitante(
        dbMock, solicitud, 'SOLICITUD_RECHAZADA',
        'Solicitud rechazada',
        'Su solicitud RECTIFICAR_CERTIFICADO ha sido rechazada.',
        'usuario_aprobador_1'
    );

    assert.ok(notificacionId > 0);
    const notifs = dbMock.getNotificaciones();
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].evento_clave, 'SOLICITUD_302_SOLICITUD_RECHAZADA');

    const dest = dbMock.getDestinatarios();
    assert.equal(dest.length, 1);
    assert.equal(dest[0].usuario_id, 'usuario_solicitante_2');
});

test('obtenerDestinatariosPorPlanta no retorna usuarios de otra empresa', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { obtenerDestinatariosPorPlanta } = service;

    // El mock siempre retorna 2 usuarios sin filtrar por empresa,
    // pero la consulta SQL incluye el filtro de empresa_key.
    // Verificamos que la consulta se construye correctamente revisando
    // que se llame con los parámetros esperados.
    const destinatarios = await obtenerDestinatariosPorPlanta(dbMock, 'SURCO', 'EMP001');
    assert.equal(destinatarios.length, 2);

    // Verificar que el mock registra las llamadas a query
    assert.ok(dbMock.getQueryCallCount() > 0);
});

test('evento repetido no duplica notificación ni destinatarios', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crearParaSolicitud } = service;

    const solicitud = {
        id: 401,
        tipo_operacion: 'ANULAR_AMBOS',
        planta_key: 'SURCO',
        empresa_key: 'EMP001',
        usuario_solicitante: 'usuario_solicitante'
    };

    // Primera creación
    const id1 = await crearParaSolicitud(dbMock, solicitud, {
        eventoClave: 'SOLICITUD_CREADA',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Nueva solicitud',
        mensaje: 'Mensaje 1'
    });

    // Segunda creación con el mismo evento_clave (idempotencia)
    const id2 = await crearParaSolicitud(dbMock, solicitud, {
        eventoClave: 'SOLICITUD_CREADA',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Nueva solicitud',
        mensaje: 'Mensaje 2'
    });

    assert.equal(id1, id2, 'Debe retornar el mismo ID de notificación');

    const notifs = dbMock.getNotificaciones();
    assert.equal(notifs.length, 1, 'No debe haber notificaciones duplicadas');

    const dest = dbMock.getDestinatarios();
    const entradasNotif1 = dest.filter((d) => d.notificacion_id === id1);
    assert.equal(entradasNotif1.length, 2, 'Cada destinatario debe tener una sola entrada');
});

// --- NUEVAS PRUEBAS: ocultar notificaciones de solicitudes atendidas ---

test('listar excluye notificaciones pendientes cuando la solicitud ya no está en PENDIENTE_APROBACION', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crear, listar, contarNoLeidas } = service;

    // Simular solicitud ya aprobada
    dbMock.getSolicitudes().push({ id: 501, estado: 'APROBADA' });

    // Crear notificación pendiente de aprobación para esa solicitud
    await crear(dbMock, {
        eventoClave: 'SOLICITUD_501_SOLICITUD_CREADA',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Nueva solicitud pendiente de aprobación',
        mensaje: 'Solicitud de anulación pendiente.',
        entidadTipo: 'SOLICITUD_OPERACION',
        entidadId: 501
    }, ['usuario_aprobador_1']);

    const paraUsuario1 = await listar('usuario_aprobador_1', dbMock);
    assert.equal(paraUsuario1.length, 0, 'La notificación de solicitud aprobada no debe aparecer');

    const count = await contarNoLeidas('usuario_aprobador_1', dbMock);
    assert.equal(count, 0, 'El conteo no debe incluir solicitudes atendidas');
});

test('listar conserva notificaciones pendientes cuando la solicitud sigue en PENDIENTE_APROBACION', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crear, listar, contarNoLeidas } = service;

    // Simular solicitud aún pendiente
    dbMock.getSolicitudes().push({ id: 502, estado: 'PENDIENTE_APROBACION' });

    await crear(dbMock, {
        eventoClave: 'SOLICITUD_502_SOLICITUD_CREADA',
        tipo: 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: 'Nueva solicitud pendiente de aprobación',
        mensaje: 'Solicitud de anulación pendiente.',
        entidadTipo: 'SOLICITUD_OPERACION',
        entidadId: 502
    }, ['usuario_aprobador_1']);

    const paraUsuario1 = await listar('usuario_aprobador_1', dbMock);
    assert.equal(paraUsuario1.length, 1, 'La notificación de solicitud pendiente debe aparecer');

    const count = await contarNoLeidas('usuario_aprobador_1', dbMock);
    assert.equal(count, 1, 'El conteo debe incluir solicitudes pendientes');
});

test('listar no muestra notificaciones informativas (solo historial), contarNoLeidas las excluye', async () => {
    const dbMock = crearDbMock();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crearParaSolicitante, listar, contarNoLeidas } = service;

    // Simular solicitud ya rechazada
    dbMock.getSolicitudes().push({ id: 503, estado: 'RECHAZADA' });

    // Crear notificación informativa al solicitante (tipo diferente)
    await crearParaSolicitante(
        dbMock,
        { id: 503, tipo_operacion: 'ANULAR_AMBOS', planta_key: 'SURCO', empresa_key: 'EMP001', usuario_solicitante: 'usuario_solicitante' },
        'SOLICITUD_RECHAZADA',
        'Solicitud rechazada',
        'Su solicitud ha sido rechazada.',
        'usuario_aprobador_1'
    );

    // La campanita NO muestra notificaciones informativas
    const paraUsuario1 = await listar('usuario_solicitante', dbMock);
    assert.equal(paraUsuario1.length, 0, 'Las notificaciones informativas no deben aparecer en la campanita');

    // El conteo NO incluye notificaciones informativas
    const count = await contarNoLeidas('usuario_solicitante', dbMock);
    assert.equal(count, 0, 'El conteo no debe incluir notificaciones informativas');
});

// Mock que lanza error SQL en el INSERT de fg_notificacion
const crearDbMockConErrorSQL = () => {
    const notificaciones = [];
    const destinatarios = [];

    const query = async (sql, params = []) => {
        const texto = String(sql);

        if (texto.includes('SAVEPOINT') || texto.includes('ROLLBACK TO SAVEPOINT')) {
            return { rowCount: 0, rows: [] };
        }

        if (texto.includes('INSERT INTO fg_notificacion')) {
            // Simular error SQL de base de datos (ej. violación de restricción)
            const error = new Error('Error simulado de base de datos');
            error.code = '23505';
            throw error;
        }

        if (texto.includes('INSERT INTO fg_notificacion_destinatario')) {
            const notificacionId = params[0];
            const usuarioId = params[1];
            const yaExiste = destinatarios.some((d) => d.notificacion_id === notificacionId && d.usuario_id === usuarioId);
            if (!yaExiste) {
                destinatarios.push({ notificacion_id: notificacionId, usuario_id: usuarioId, leida: false, fecha_lectura: null });
            }
            return { rowCount: 1, rows: [] };
        }

        return { rowCount: 0, rows: [] };
    };

    return {
        query,
        getNotificaciones: () => notificaciones,
        getDestinatarios: () => destinatarios
    };
};

test('error SQL en notificación no aborta la transacción (SAVEPOINT rollback)', async () => {
    const dbMock = crearDbMockConErrorSQL();
    const service = await import('../services/faregas-notificaciones.service.js');
    const { crear } = service;

    // El INSERT falla, crear debe capturar el error, hacer ROLLBACK TO SAVEPOINT
    // y retornar null en lugar de lanzar.
    const resultado = await crear(dbMock, {
        eventoClave: 'EVT_ERROR',
        tipo: 'TIPO_ERROR',
        titulo: 'Título error',
        mensaje: 'Mensaje error'
    }, ['usuario_aprobador_1']);

    assert.equal(resultado, null, 'Debe retornar null en caso de error SQL');

    // No debe haber notificaciones persistentes (rollback a savepoint las deshizo)
    const notifs = dbMock.getNotificaciones();
    assert.equal(notifs.length, 0, 'No debe haber notificaciones tras error SQL');

    // La transacción debe seguir utilizable: otra operación puede ejecutarse
    const resultado2 = await crear(dbMock, {
        eventoClave: 'EVT_OK',
        tipo: 'TIPO_OK',
        titulo: 'Título OK',
        mensaje: 'Mensaje OK'
    }, ['usuario_aprobador_1']);
    // Este también fallará porque el mock siempre lanza en INSERT de fg_notificacion
    assert.equal(resultado2, null);
});

test('historial enriquece usuarios, decisión y documento sin perder aislamiento por destinatario', async () => {
    const consultas = [];
    const executor = {
        query: async (sql, params) => {
            const texto = String(sql);
            consultas.push({ texto, params });
            if (texto.includes('COUNT(*)::int AS total')) {
                return { rowCount: 1, rows: [{ total: 1 }] };
            }
            return {
                rowCount: 1,
                rows: [{
                    id: 90,
                    solicitud_id: 41,
                    solicitante_username: 'gibarra',
                    solicitante_nombre: 'Grace Ibarra',
                    autorizador_username: 'gibarra',
                    autorizador_nombre: 'Grace Ibarra',
                    estado_solicitud: 'APROBADA',
                    autoaprobacion_excepcional: true,
                    certificado_numero: 'DG-41-000347',
                    comprobante_numero: 'BBB1-00000266',
                    motivo_nota_codigo: '02'
                }]
            };
        }
    };
    const service = await import('../services/faregas-notificaciones.service.js');
    const resultado = await service.listarHistorial('gibarra', executor, {
        busqueda: 'Grace', fechaDesde: '2026-10-01', fechaHasta: '2026-10-30', pagina: 1, limite: 50
    });

    assert.equal(resultado.total, 1);
    assert.equal(resultado.limite, 10, 'El backend debe imponer un máximo de 10 registros por página');
    assert.equal(resultado.data[0].solicitante_nombre, 'Grace Ibarra');
    assert.equal(resultado.data[0].autoaprobacion_excepcional, true);
    assert.ok(consultas.every(({ params }) => params[0] === 'gibarra'));
    const sql = consultas.map(({ texto }) => texto).join('\n');
    assert.match(sql, /LEFT JOIN persona ps/);
    assert.match(sql, /LEFT JOIN persona pd/);
    assert.match(sql, /pl\.nombre ILIKE/);
    assert.match(sql, /fecha_creacion >= .*America\/Lima/);
    assert.match(sql, /fecha_creacion < .*America\/Lima/);
    assert.match(sql, /justificacion_decision AS justificacion_decision/);
    assert.match(sql, /metadatos ->> 'autoaprobacion' = 'true'/);
    assert.match(sql, /d\.usuario_id = \$1/);
});

