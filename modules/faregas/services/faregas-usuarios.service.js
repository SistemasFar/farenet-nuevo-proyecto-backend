const db = require('../../../config/database');
const bcrypt = require('bcryptjs');
const authService = require('./faregas-auth.service');
const integridad = require('./faregas-cuentas-integridad.service');
const paginacion = require('./faregas-paginacion.rules');
const validacion = require('./faregas-usuarios-validacion.service');
const perfilRepository = require('./faregas-usuario-perfil.repository');
const permisosSensiblesService = require('./faregas-permisos-sensibles.service');
const {
    PERMISOS_SENSIBLES,
    PERMISOS_SENSIBLES_SET,
    PERMISOS_OBSOLETOS_SET,
    PERMISOS_FAREGAS_GESTIONABLES
} = require('./faregas-permisos-sensibles.constants');

const normalizarValorPerfil = (valor) => {
    const normalizado = String(valor ?? '').trim();
    return normalizado || null;
};

const errorPerfilHeredadoSoloLectura = (code, message, campos = []) => {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 409;
    error.detalles = campos;
    return error;
};

const compararPerfilConPersonaLegacy = async (client, datos) => {
    const { rows } = await client.query(`
        SELECT tipodocumentoidentidad_key, nombres, apellidos, nombrerazonsocial,
               pais_key, departamento_key, provincia_key, distrito_key,
               direccion, email, telefono, persona_contacto
        FROM persona
        WHERE nrodocumentoidentidad = $1
        LIMIT 1
    `, [datos.nroDocumento]);
    const persona = rows[0];
    if (!persona) {
        throw errorPerfilHeredadoSoloLectura(
            'PERSONA_FARENET_NO_EXISTE',
            'El documento no existe en FARENET. No se guardaron cambios personales; aplique la migración FAREGAS para administrar perfiles propios.'
        );
    }
    const camposPerfil = [
        ['tipoDocumentoKey', 'tipodocumentoidentidad_key'],
        ['nombres', 'nombres'],
        ['apellidos', 'apellidos'],
        ['nombreRazonSocial', 'nombrerazonsocial'],
        ['paisKey', 'pais_key'],
        ['departamentoKey', 'departamento_key'],
        ['provinciaKey', 'provincia_key'],
        ['distritoKey', 'distrito_key'],
        ['direccion', 'direccion'],
        ['email', 'email'],
        ['telefono', 'telefono'],
        ['personaContacto', 'persona_contacto']
    ];
    const modificados = camposPerfil
        .filter(([entrada, columna]) => normalizarValorPerfil(datos[entrada]) !== normalizarValorPerfil(persona[columna]))
        .map(([entrada]) => entrada);

    if (modificados.length > 0) {
        throw errorPerfilHeredadoSoloLectura(
            'PERFIL_PERSONA_FARENET_SOLO_LECTURA',
            'El esquema independiente de perfiles FAREGAS aún no está instalado y persona es de solo lectura. No se guardaron los cambios personales.',
            modificados
        );
    }
    return persona;
};

const guardarPerfilPropio = async (client, username, datos) => {
    await client.query(`
        INSERT INTO public.fg_usuario_perfil (
            usuario_username, tipo_documento_key, nro_documento,
            nombres, apellidos, nombre_razon_social,
            pais_key, departamento_key, provincia_key, distrito_key,
            direccion, email, telefono, persona_contacto,
            fecha_actualizacion
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (usuario_username) DO UPDATE SET
            tipo_documento_key = EXCLUDED.tipo_documento_key,
            nro_documento = EXCLUDED.nro_documento,
            nombres = EXCLUDED.nombres,
            apellidos = EXCLUDED.apellidos,
            nombre_razon_social = EXCLUDED.nombre_razon_social,
            pais_key = EXCLUDED.pais_key,
            departamento_key = EXCLUDED.departamento_key,
            provincia_key = EXCLUDED.provincia_key,
            distrito_key = EXCLUDED.distrito_key,
            direccion = EXCLUDED.direccion,
            email = EXCLUDED.email,
            telefono = EXCLUDED.telefono,
            persona_contacto = EXCLUDED.persona_contacto,
            fecha_actualizacion = CURRENT_TIMESTAMP
    `, [
        username, datos.tipoDocumentoKey, datos.nroDocumento,
        datos.nombres, datos.apellidos, datos.nombreRazonSocial,
        datos.paisKey, datos.departamentoKey, datos.provinciaKey, datos.distritoKey,
        datos.direccion, datos.email, datos.telefono, datos.personaContacto
    ]);
};

// El trim de los campos vive en `faregas-usuarios-validacion.service`, que es
// quien devuelve los valores ya normalizados y validados. Aquí no se normaliza
// nada por separado: lo que se guarda es exactamente lo que se comprobó.

exports.obtenerUsuarios = async () => {
    const perfilPropioDisponible = await perfilRepository.estaDisponible(db);
    const perfil = (columnaPropia, columnaLegacy) => perfilPropioDisponible
        ? `CASE WHEN fp.usuario_username IS NOT NULL THEN fp.${columnaPropia} ELSE p.${columnaLegacy} END`
        : `p.${columnaLegacy}`;
    const query = `
        SELECT u.username, u.perfil_id, u.estado, u.user_type, u.persona_nrodocumentoidentidad,
               ${perfil('tipo_documento_key', 'tipodocumentoidentidad_key')} as "tipoDocumentoKey",
               td.nombre as "tipoDocumentoNombre",
               ${perfil('nro_documento', 'nrodocumentoidentidad')} as "nroDocumento",
               ${perfil('nombres', 'nombres')} as nombres,
               ${perfil('apellidos', 'apellidos')} as apellidos,
               ${perfil('nombre_razon_social', 'nombrerazonsocial')} as "nombreRazonSocial",
               ${perfil('pais_key', 'pais_key')} as "paisKey", pais.nombre as "paisNombre",
               ${perfil('departamento_key', 'departamento_key')} as "departamentoKey", dep.nombre as "departamentoNombre",
               ${perfil('provincia_key', 'provincia_key')} as "provinciaKey", prov.nombre as "provinciaNombre",
               ${perfil('distrito_key', 'distrito_key')} as "distritoKey", dis.nombre as "distritoNombre",
               ${perfil('direccion', 'direccion')} as direccion,
               ${perfil('email', 'email')} as email,
               ${perfil('telefono', 'telefono')} as telefono,
               ${perfil('persona_contacto', 'persona_contacto')} as "personaContacto",
               COALESCE(
                   (SELECT json_agg(json_build_object('key', up.plantas_key, 'nombre', pl.nombre))
                    FROM fg_usuario_planta up
                    JOIN fg_planta pl ON pl.key = up.plantas_key
                    WHERE up.usuario_username = u.username),
                   '[]'::json
               ) as sedes
        FROM fg_usuario u
        LEFT JOIN persona p ON u.persona_nrodocumentoidentidad = p.nrodocumentoidentidad
        ${perfilPropioDisponible ? 'LEFT JOIN public.fg_usuario_perfil fp ON fp.usuario_username = u.username' : ''}
        LEFT JOIN tipodocumentoidentidad td ON ${perfil('tipo_documento_key', 'tipodocumentoidentidad_key')} = td.key
        LEFT JOIN pais ON ${perfil('pais_key', 'pais_key')} = pais.key
        LEFT JOIN departamento dep ON ${perfil('departamento_key', 'departamento_key')} = dep.key
        LEFT JOIN provincia prov ON ${perfil('provincia_key', 'provincia_key')} = prov.key
        LEFT JOIN distrito dis ON ${perfil('distrito_key', 'distrito_key')} = dis.key
        ORDER BY u.username
    `;
    const result = await db.query(query);
    return result.rows;
};

/**
 * Listado paginado de usuarios. Es un catalogo maestro: NO se filtra por fecha,
 * solo se pagina. Se mantiene el ORDER BY por usuario.
 */
exports.obtenerUsuariosPaginado = async (filtros = {}) => {
    const perfilPropioDisponible = await perfilRepository.estaDisponible(db);
    const { page, limit, offset } = paginacion.normalizarPaginacion(filtros);
    const condiciones = [];
    const valores = [];
    const agregar = (sql, valor) => {
        valores.push(valor);
        condiciones.push(sql.replace('?', `$${valores.length}`));
    };
    if (filtros.buscar) {
        valores.push(`%${filtros.buscar}%`);
        const patron = `$${valores.length}`;
        condiciones.push(
            `(u.username ILIKE ${patron} OR COALESCE(${perfilPropioDisponible
                ? "CASE WHEN fp.usuario_username IS NOT NULL THEN fp.nombre_razon_social ELSE p.nombrerazonsocial END"
                : 'p.nombrerazonsocial'}, '') ILIKE ${patron})`
        );
    }
    if (filtros.perfil_id) agregar('u.perfil_id = ?', filtros.perfil_id);
    if (filtros.estado === true || filtros.estado === false) agregar('u.estado = ?', filtros.estado);

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const joins = `
        FROM fg_usuario u
        LEFT JOIN persona p ON u.persona_nrodocumentoidentidad = p.nrodocumentoidentidad
        ${perfilPropioDisponible ? 'LEFT JOIN public.fg_usuario_perfil fp ON fp.usuario_username = u.username' : ''}
    `;

    const conteo = await db.query(
        `SELECT COUNT(*)::int AS total ${joins} ${where}`,
        valores
    );

    const result = await db.query(`
        SELECT u.username, u.perfil_id, u.estado, u.user_type, u.persona_nrodocumentoidentidad,
        COALESCE(
        (SELECT json_agg(json_build_object('key', up.plantas_key, 'nombre', pl.nombre))
        FROM fg_usuario_planta up
        JOIN fg_planta pl ON pl.key = up.plantas_key
        WHERE up.usuario_username = u.username),
        '[]'::json
        ) as sedes
        ${joins} ${where}
        ORDER BY u.username
        LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}
    `, [...valores, limit, offset]);

    return paginacion.respuestaPaginada(
        result.rows,
        Number(conteo.rows[0]?.total || 0),
        page,
        limit
    );
};

exports.crearUsuario = async (data, _creadorUsername) => {
    const { perfil_id, estado, sedes, user_type, password, nombres, apellidos, nombreRazonSocial } = data;

    // Ninguna escritura llega a la base sin pasar por la validación. Se valida
    // sobre `data` completo y se usan los valores NORMALIZADOS que devuelve,
    // para que lo que se guarde sea exactamente lo que se comprobó.
    const datosValidados = validacion.exigirDatosValidos(data, { modo: 'crear' });
    const cleanUsername = datosValidados.username;

    const hash = bcrypt.hashSync(password, 10);
    const cleanPerfil = perfil_id === '' ? null : perfil_id;
    const estadoBool = estado === true || estado === 'true';
    const tipoUsr = user_type || 'USER';

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        if (!await perfilRepository.estaDisponible(client)) {
            throw perfilRepository.errorMigracionPendiente();
        }

        // Nuevos usuarios FAREGAS no necesitan ni crean una persona heredada.
        await client.query(`
            INSERT INTO fg_usuario (username, contrasenha, perfil_id, estado, user_type, persona_nrodocumentoidentidad)
            VALUES ($1, $2, $3, $4, $5, NULL)
        `, [cleanUsername, hash, cleanPerfil, estadoBool, tipoUsr]);
        await guardarPerfilPropio(client, cleanUsername, datosValidados);

        // 3. Asignar sedes
        if (Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                const check = await client.query('SELECT 1 FROM fg_perfil_planta WHERE perfil_clave = $1 AND planta_key = $2', [cleanPerfil, planta_key]);
                if (check.rowCount === 0) {
                    throw new Error(`Planta ${planta_key} no permitida para el perfil ${cleanPerfil}`);
                }
                await client.query('INSERT INTO fg_usuario_planta (usuario_username, plantas_key) VALUES ($1, $2)', [cleanUsername, planta_key]);
            }
        }

        // 4. Ejecutivo
        if (tipoUsr === 'EJECUTIVO') {
            const nomApe = (nombres || '') + ' ' + (apellidos || '');
            const nomToSave = nomApe.trim() || nombreRazonSocial || cleanUsername;
            await client.query(`
                INSERT INTO fg_ejecutivo (nombre, activo, username)
                VALUES ($1, $2, $3)
            `, [nomToSave, estadoBool, cleanUsername]);
        }
        
        await client.query('COMMIT');
        return { username: cleanUsername };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.actualizarUsuario = async (oldUsername, data, modificadorUsername) => {
    const { perfil_id, estado, sedes, user_type, nombres, apellidos, nombreRazonSocial } = data;

    // Mismas reglas que en la creación. `modo: 'editar'` deja pasar la contraseña
    // vacía, que es lo que el formulario ya entendía como "no cambiar".
    const datosValidados = validacion.exigirDatosValidos(data, { modo: 'editar' });
    const newUsername = datosValidados.username;

    const cleanPerfil = perfil_id === '' ? null : perfil_id;
    const estadoBool = estado === true || estado === 'true';
    const tipoUsr = user_type || 'USER';

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await integridad.bloquearCuentas(client);
        const previo = await client.query('SELECT username,perfil_id,estado FROM fg_usuario WHERE username=$1 FOR UPDATE', [oldUsername]);
        if (!previo.rowCount) throw integridad.error('USER_NOT_FOUND', 'El usuario no existe.', 404);
        await integridad.protegerCuenta(client, previo.rows[0], modificadorUsername, { estado: estadoBool, perfil: cleanPerfil });
        if (!estadoBool || cleanPerfil !== previo.rows[0].perfil_id || newUsername !== oldUsername) {
            await integridad.revocarSesiones(client, oldUsername);
        }


        if (newUsername !== oldUsername) {
            const r = await client.query('SELECT 1 FROM fg_usuario WHERE username = $1', [newUsername]);
            if (r.rowCount > 0) throw new Error('USERNAME_EXISTS');
        }

        const perfilPropioDisponible = await perfilRepository.estaDisponible(client);
        if (!perfilPropioDisponible) {
            // Compatibilidad temporal: se mantienen los cambios administrativos
            // si el perfil remitido sigue coincidiendo con persona. El formulario
            // personal continuará bloqueado hasta desplegar fg_usuario_perfil.
            await compararPerfilConPersonaLegacy(client, datosValidados);
        }

        // UPDATE
        await client.query(`
            UPDATE fg_usuario 
            SET username = $1, perfil_id = $2, estado = $3, user_type = $4
            WHERE username = $5
        `, [newUsername, cleanPerfil, estadoBool, tipoUsr, oldUsername]);
        if (perfilPropioDisponible) {
            await guardarPerfilPropio(client, newUsername, datosValidados);
        }

        // Actualizar plantas
        await client.query('DELETE FROM fg_usuario_planta WHERE usuario_username = $1', [newUsername]);
        if (Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                const check = await client.query('SELECT 1 FROM fg_perfil_planta WHERE perfil_clave = $1 AND planta_key = $2', [cleanPerfil, planta_key]);
                if (check.rowCount === 0) {
                    throw new Error(`Planta ${planta_key} no permitida para el perfil ${cleanPerfil}`);
                }
                await client.query('INSERT INTO fg_usuario_planta (usuario_username, plantas_key) VALUES ($1, $2)', [newUsername, planta_key]);
            }
        }

        // 4. Ejecutivo
        if (tipoUsr === 'EJECUTIVO') {
            const nomApe = (nombres || '') + ' ' + (apellidos || '');
            const nomToSave = nomApe.trim() || nombreRazonSocial || newUsername;
            
            const checkEjec = await client.query('SELECT id FROM fg_ejecutivo WHERE username = $1', [newUsername]);
            if (checkEjec.rowCount > 0) {
                await client.query('UPDATE fg_ejecutivo SET nombre = $1, activo = $2 WHERE username = $3', [nomToSave, estadoBool, newUsername]);
            } else {
                await client.query(`
                    INSERT INTO fg_ejecutivo (nombre, activo, username)
                    VALUES ($1, $2, $3)
                `, [nomToSave, estadoBool, newUsername]);
            }
        } else {
            // Si ya no es ejecutivo, lo desactivamos (no eliminamos historicos)
            await client.query('UPDATE fg_ejecutivo SET activo = false WHERE username = $1', [newUsername]);
        }

        await client.query('COMMIT');
        return { username: newUsername };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.cambiarPassword = async (username, password) => {
    const hash = bcrypt.hashSync(password, 10);
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const usuario = await client.query(`
            SELECT username
            FROM public.fg_usuario
            WHERE username = $1 AND estado = TRUE
            FOR UPDATE
        `, [username]);
        if (usuario.rowCount === 0) {
            const error = new Error('USER_NOT_FOUND');
            error.statusCode = 404;
            throw error;
        }
        
        const resFaregas = await client.query(`
            UPDATE fg_usuario
            SET contrasenha = $1
            WHERE username = $2 AND estado = TRUE
        `, [hash, username]);

        if (resFaregas.rowCount === 0) {
            throw new Error('USER_NOT_FOUND');
        }

        await authService.revocarSesionesUsuario(username, client);

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerPerfiles = async () => {
    const result = await db.query(`
        SELECT p.clave, p.nombre, p.visible,
               (SELECT COUNT(*) FROM fg_usuario u WHERE u.perfil_id = p.clave) as num_usuarios,
               COALESCE(
                   (SELECT json_agg(planta_key)
                    FROM fg_perfil_planta pp
                    WHERE pp.perfil_clave = p.clave),
                   '[]'::json
               ) as sedes,
               COALESCE(
                   (SELECT json_agg(permiso_clave)
                    FROM fg_perfil_permiso ppe
                    WHERE ppe.perfil_clave = p.clave),
                   '[]'::json
               ) as permisos
        FROM fg_perfil p
        ORDER BY p.clave
    `);
    return result.rows.map((perfil) => ({
        ...perfil,
        permisos: Array.isArray(perfil.permisos)
            ? perfil.permisos.filter((clave) => !PERMISOS_OBSOLETOS_SET.has(clave))
            : []
    }));
};

exports.crearPerfil = async (data, actor = null, contexto = {}) => {
    const { clave, nombre, visible, sedes, permisos, permisosSensibles } = data;
    const isVisible = visible === true || visible === 'true';
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');

        // La autorización se comprueba dentro de la transacción y contra la BD:
        // administrar perfiles exige MENU_USUARIOS, el mismo permiso que protege
        // la ruta. No hay una segunda autorización para permisos sensibles.
        const actorAutorizado = await permisosSensiblesService.verificarAutorizacionPerfiles({
            executor: client,
            actor,
            contexto,
            perfilClave: clave
        });

        // Se valida contra el catálogo ANTES de escribir cualquier fila. La
        // lista completa `permisos` incluye también las claves sensibles.
        const validados = await permisosSensiblesService.validarPermisosGestionables({
            executor: client,
            permisos,
            permisosSensibles,
            perfilClave: clave
        });
        
        await client.query(`
            INSERT INTO fg_perfil (clave, nombre, visible)
            VALUES ($1, $2, $3)
        `, [clave, nombre, isVisible]);
        
        if (Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                await client.query('INSERT INTO fg_perfil_planta (perfil_clave, planta_key) VALUES ($1, $2)', [clave, planta_key]);
            }
        }

        // Los permisos sensibles pasan por el servicio dedicado para auditar
        // cada concesión. Los demás se insertan directamente.
        const permisosNoSensibles = (validados.permisosGestionables || [])
            .filter((permiso) => !PERMISOS_SENSIBLES_SET.has(permiso));
        for (const permiso of permisosNoSensibles) {
            await client.query(
                'INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [clave, permiso]
            );
        }

        await permisosSensiblesService.aplicarPermisosSensibles({
            executor: client,
            perfilClave: clave,
            permisosSensibles: validados.permisosSensibles,
            actor,
            actorAutorizado,
            contexto
        });

        await client.query('COMMIT');
        return { clave };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.actualizarPerfil = async (clave, data, actor = null, contexto = {}) => {
    const { nombre, visible, sedes, permisos, permisosSensibles } = data;
    const isVisible = visible === true || visible === 'true';
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        await integridad.bloquearCuentas(client);
        const teniaAdminActivo = (await client.query(`SELECT 1 FROM fg_usuario u WHERE u.estado=TRUE
            AND EXISTS (SELECT 1 FROM fg_perfil_permiso pp JOIN fg_permiso p ON p.clave=pp.permiso_clave
              WHERE pp.perfil_clave=u.perfil_id AND pp.permiso_clave='MENU_USUARIOS' AND p.activo=TRUE) LIMIT 1`)).rowCount > 0;


        // Bloqueo de la fila del perfil: dos administradores que guarden a la
        // vez no pueden calcular el diff sobre estados distintos ni dejar
        // permisos sensibles a medio escribir.
        const perfilActual = await client.query(
            'SELECT 1 FROM fg_perfil WHERE clave = $1 FOR UPDATE',
            [clave]
        );
        if (perfilActual.rowCount === 0) {
            throw permisosSensiblesService._private.errorNegocio(
                'PERFIL_NO_ENCONTRADO',
                404,
                'El perfil no existe.'
            );
        }

        // Autorización única para editar perfiles. Se evalúa con los permisos
        // efectivos de la BD y dentro de la misma transacción que la escritura.
        const actorAutorizado = await permisosSensiblesService.verificarAutorizacionPerfiles({
            executor: client,
            actor,
            contexto,
            perfilClave: clave
        });

        const validados = await permisosSensiblesService.validarPermisosGestionables({
            executor: client,
            permisos,
            permisosSensibles,
            perfilClave: clave
        });

        await client.query(`
            UPDATE fg_perfil
            SET nombre = $1, visible = $2
            WHERE clave = $3
        `, [nombre, isVisible, clave]);

        await client.query('DELETE FROM fg_perfil_planta WHERE perfil_clave = $1', [clave]);
        if (Array.isArray(sedes) && sedes.length > 0) {
            for (const planta_key of sedes) {
                await client.query('INSERT INTO fg_perfil_planta (perfil_clave, planta_key) VALUES ($1, $2)', [clave, planta_key]);
            }
        }

        await client.query(`
            DELETE FROM fg_usuario_planta up
            USING fg_usuario u
            WHERE up.usuario_username = u.username
              AND u.perfil_id = $1
              AND up.plantas_key NOT IN (
                  SELECT planta_key FROM fg_perfil_planta WHERE perfil_clave = $1
              )
        `, [clave]);

        if (Array.isArray(validados.permisosGestionables)) {
            // Se reemplazan los permisos gestionables no sensibles. Los
            // sensibles se aplican después con el diff auditado, de modo que
            // marcar o desmarcar cualquiera de ellos persiste exactamente lo
            // que envió el editor. Los permisos fuera del catálogo no se tocan:
            // se conservan tal como estaban.
            await client.query(`
                DELETE FROM fg_perfil_permiso
                WHERE perfil_clave = $1
                  AND permiso_clave IN (
                      SELECT clave
                      FROM fg_permiso
                      WHERE modulo = 'MENU'
                         OR clave = ANY($2::varchar[])
                  )
                  AND NOT (permiso_clave = ANY($3::varchar[]))
                  AND NOT (permiso_clave = ANY($4::varchar[]))
            `, [clave, PERMISOS_FAREGAS_GESTIONABLES, PERMISOS_SENSIBLES, [...PERMISOS_OBSOLETOS_SET]]);

            const permisosNoSensibles = validados.permisosGestionables
                .filter((permiso) => !PERMISOS_SENSIBLES_SET.has(permiso));
            for (const permiso of permisosNoSensibles) {
                await client.query(
                    'INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [clave, permiso]
                );
            }
        }

        await permisosSensiblesService.aplicarPermisosSensibles({
            executor: client,
            perfilClave: clave,
            permisosSensibles: validados.permisosSensibles,
            actor,
            actorAutorizado,
            contexto
        });

        if (teniaAdminActivo) {
            const quedan = await client.query(`SELECT 1 FROM fg_usuario u WHERE u.estado=TRUE
                AND EXISTS (SELECT 1 FROM fg_perfil_permiso pp JOIN fg_permiso p ON p.clave=pp.permiso_clave
                  WHERE pp.perfil_clave=u.perfil_id AND pp.permiso_clave='MENU_USUARIOS' AND p.activo=TRUE) LIMIT 1`);
            if (!quedan.rowCount) throw integridad.error('ULTIMO_ADMIN', 'El cambio dejaría el sistema sin una cuenta administradora activa.');
        }

        await client.query('COMMIT');
        return { clave };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerUsuariosPorPerfil = async (clave, executor = db) => {
    const existe = await executor.query('SELECT 1 FROM fg_perfil WHERE clave=$1', [clave]);
    if (!existe.rowCount) throw integridad.error('PERFIL_NO_EXISTE', 'El perfil no existe.', 404);
    const propio = await perfilRepository.estaDisponible(executor);
    const res = await executor.query(`
        SELECT u.username, u.estado, u.user_type,
            ${propio ? 'COALESCE(up.nombres,p.nombres)' : 'p.nombres'} nombres,
            ${propio ? 'COALESCE(up.apellidos,p.apellidos)' : 'p.apellidos'} apellidos
        FROM fg_usuario u
        LEFT JOIN persona p ON p.nrodocumentoidentidad=u.persona_nrodocumentoidentidad
        ${propio ? 'LEFT JOIN fg_usuario_perfil up ON up.usuario_username=u.username' : ''}
        WHERE u.perfil_id=$1 ORDER BY u.username`, [clave]);
    return res.rows;
};

exports.eliminarPerfil = async (clave, { nuevoPerfilClave = null } = {}, actor = null, contexto = {}) => {
    if (clave === 'SISTEMAS') throw integridad.error('NO_DELETE_SISTEMAS', 'No se permite eliminar el perfil base SISTEMAS.', 403);
    if (nuevoPerfilClave !== null && (typeof nuevoPerfilClave !== 'string' || !nuevoPerfilClave.trim() || nuevoPerfilClave === clave)) {
        throw integridad.error('PERFIL_REEMPLAZO_INVALIDO', 'Seleccione un perfil de reemplazo diferente y válido.', 400);
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await integridad.bloquearCuentas(client);
        await permisosSensiblesService.verificarAutorizacionPerfiles({ executor: client, actor, contexto, perfilClave: clave });
        // Orden estable para evitar bloqueos cruzados entre perfiles.
        const perfiles = await client.query('SELECT clave FROM fg_perfil WHERE clave = ANY($1::varchar[]) ORDER BY clave FOR UPDATE', [[clave, nuevoPerfilClave].filter(Boolean)]);
        if (!perfiles.rows.some(p => p.clave === clave)) throw integridad.error('PERFIL_NO_EXISTE', 'El perfil no existe.', 404);
        if (nuevoPerfilClave && !perfiles.rows.some(p => p.clave === nuevoPerfilClave)) {
            throw integridad.error('PERFIL_REEMPLAZO_INVALIDO', 'El perfil de reemplazo no existe.', 400);
        }
        const usuarios = await exports.obtenerUsuariosPorPerfil(clave, client);
        if (usuarios.length && !nuevoPerfilClave) {
            throw Object.assign(integridad.error('PERFIL_CON_USUARIOS', 'Seleccione un perfil de reemplazo para los usuarios vinculados.'), { perfil: clave, usuarios });
        }
        if (usuarios.length) {
            // No ampliar el perfil de destino ni descartar sedes silenciosamente.
            const incompatibles = await client.query(`
                SELECT up.usuario_username, up.plantas_key FROM fg_usuario_planta up
                JOIN fg_usuario u ON u.username=up.usuario_username
                WHERE u.perfil_id=$1 AND NOT EXISTS (
                    SELECT 1 FROM fg_perfil_planta pp WHERE pp.perfil_clave=$2 AND pp.planta_key=up.plantas_key
                ) AND NOT EXISTS (
                    SELECT 1 FROM fg_perfil_permiso pp JOIN fg_permiso p ON p.clave=pp.permiso_clave AND p.activo=TRUE
                    WHERE pp.perfil_clave=$2 AND pp.permiso_clave='FAREGAS_ACCESO_GLOBAL_SEDES'
                )`, [clave, nuevoPerfilClave]);
            if (incompatibles.rowCount) throw integridad.error('PERFIL_SEDES_INCOMPATIBLES', 'El reemplazo no permite todas las sedes asignadas. Revise las sedes antes de continuar.', 409, incompatibles.rows);
            // Evalúa el resultado completo de la reasignación, no usuario por usuario.
            if (await integridad.esAdministrador(client, clave) && !await integridad.esAdministrador(client, nuevoPerfilClave)) {
                const restantes = await client.query(`SELECT 1 FROM fg_usuario u WHERE u.estado=TRUE AND u.perfil_id<>$1
                    AND EXISTS (SELECT 1 FROM fg_perfil_permiso pp JOIN fg_permiso p ON p.clave=pp.permiso_clave
                      WHERE pp.perfil_clave=u.perfil_id AND pp.permiso_clave='MENU_USUARIOS' AND p.activo=TRUE) LIMIT 1`, [clave]);
                if (!restantes.rowCount && usuarios.some(u=>u.estado)) throw integridad.error('ULTIMO_ADMIN_PERFIL', 'La reasignación dejaría el sistema sin una cuenta administradora activa.', 403);
            }
            await client.query('UPDATE fg_usuario SET perfil_id=$1 WHERE perfil_id=$2', [nuevoPerfilClave, clave]);
            for (const u of usuarios) await integridad.revocarSesiones(client, u.username);
        }
        await client.query('DELETE FROM fg_perfil_permiso WHERE perfil_clave=$1', [clave]);
        await client.query('DELETE FROM fg_perfil_planta WHERE perfil_clave=$1', [clave]);
        await client.query('DELETE FROM fg_perfil WHERE clave=$1', [clave]);
        await client.query('COMMIT');
        return { perfilEliminado: clave, usuariosReasignados: usuarios.length, nuevoPerfilClave };
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23503') throw integridad.error('PERFIL_CON_DEPENDENCIAS', 'El perfil conserva otras dependencias; no se realizaron cambios.');
        throw e;
    } finally { client.release(); }
};

exports.obtenerPlantas = async () => {
    const result = await db.query('SELECT key, nombre, activo FROM fg_planta ORDER BY nombre');
    return result.rows;
};

exports.obtenerPermisos = async () => {
    const result = await db.query(`
        SELECT clave, nombre, modulo
        FROM fg_permiso
        WHERE activo = TRUE
          AND (
              modulo = 'MENU'
              OR clave = ANY($1::varchar[])
          )
        ORDER BY modulo, nombre
    `, [PERMISOS_FAREGAS_GESTIONABLES]);
    return result.rows.filter((permiso) => !PERMISOS_OBSOLETOS_SET.has(permiso.clave));
};

/**
 * Tablas cuyo historial de negocio impide borrar un usuario, con la etiqueta que
 * se muestra al operador. La detección se completa con las FK reales de cada
 * instalación, incluso cuando una FK nueva declara borrado en cascada.
 *
 * `fg_usuario_sesion` y `fg_usuario_planta` NO aparecen: son dependencias
 * operativas del acceso, no historial, y se limpian antes de intentar el borrado.
 */
const HISTORIAL_USUARIO = [
    { tabla: 'fg_certificado', etiqueta: 'certificados' },
    { tabla: 'fg_operacion_comercial', etiqueta: 'operaciones comerciales' },
    { tabla: 'fg_chip', etiqueta: 'chips' },
    { tabla: 'fg_chip_movimiento', etiqueta: 'movimientos de chip' },
    { tabla: 'fg_vehiculo', etiqueta: 'vehículos' },
    { tabla: 'fg_ejecutivo', etiqueta: 'ejecutivos' },
    { tabla: 'fg_credito', etiqueta: 'créditos' },
    { tabla: 'fg_debito', etiqueta: 'débitos' },
    { tabla: 'fg_descuento', etiqueta: 'descuentos' },
    { tabla: 'fg_descuentocliente', etiqueta: 'descuentos de cliente' },
    { tabla: 'fg_descuentocomprobante', etiqueta: 'descuentos de comprobante' },
    { tabla: 'fg_descuentodetalle', etiqueta: 'detalles de descuento' },
    { tabla: 'fg_documento_anulacion', etiqueta: 'anulaciones de documento' },
    { tabla: 'fg_documento_electronico_operacion', etiqueta: 'documentos electrónicos' },
    { tabla: 'fg_auditoria_config', etiqueta: 'registros de auditoría' }
];

/** Nombres de columna por los que cada tabla referencia al usuario. */
const COLUMNAS_REFERENCIA = {
    fg_certificado: ['usuario_creacion', 'usuario_modificacion'],
    fg_operacion_comercial: ['usuario_creacion', 'usuario_modificacion'],
    fg_chip: ['creado_por', 'actualizado_por'],
    fg_chip_movimiento: ['usuario'],
    fg_vehiculo: ['usuario_creacion', 'usuario_modificacion'],
    fg_ejecutivo: ['username', 'usuario_creacion', 'usuario_modificacion'],
    fg_credito: ['usuario_creacion', 'usuario_modificacion'],
    fg_debito: ['usuario_creacion', 'usuario_modificacion'],
    fg_descuento: ['usuario_creacion', 'usuario_modificacion'],
    fg_descuentocliente: ['usuario_creacion', 'usuario_modificacion'],
    fg_descuentocomprobante: ['usuario_creacion', 'usuario_modificacion'],
    fg_descuentodetalle: ['usuario_creacion', 'usuario_modificacion'],
    fg_documento_anulacion: ['usuario_creacion', 'usuario_modificacion'],
    fg_documento_electronico_operacion: ['usuario_creacion'],
    fg_facturacion: ['usuario_creacion', 'usuario_modificacion'],
    fg_orden_pago: ['usuariocreacion_username', 'usuariomodi_username'],
    fg_auditoria_config: ['username']
};

/**
 * Consulta qué historial bloquea a un usuario, para poder decirlo en el mensaje
 * en vez de devolver un 500 genérico. Usa `to_regclass` para no fallar si una
 * tabla llegara a no existir en alguna instalación. Se consultan las columnas
 * presentes para tolerar diferencias entre versiones del esquema.
 */
const detectarHistorial = async (username, executor) => {
    const metadata = await executor.query(`SELECT ns.nspname esquema, rel.relname tabla, att.attname columna
        FROM pg_constraint fk JOIN pg_class rel ON rel.oid=fk.conrelid
        JOIN pg_namespace ns ON ns.oid=rel.relnamespace
        JOIN LATERAL unnest(fk.conkey) k(num) ON TRUE
        JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=k.num
        WHERE fk.contype='f' AND fk.confrelid='public.fg_usuario'::regclass`);
    const columnas = await executor.query(`SELECT table_name tabla,column_name columna FROM information_schema.columns
        WHERE table_schema='public' AND table_name=ANY($1::text[])`, [Object.keys(COLUMNAS_REFERENCIA)]);
    const grupos = new Map();
    const acceso = new Set(['fg_usuario_planta','fg_usuario_sesion','fg_usuario_perfil']);
    for (const ref of [...metadata.rows, ...columnas.rows.filter(r=>COLUMNAS_REFERENCIA[r.tabla]?.includes(r.columna)).map(r=>({...r, esquema:'public'}))]) {
        if (ref.esquema === 'public' && acceso.has(ref.tabla)) continue;
        const key = JSON.stringify([ref.esquema,ref.tabla]);
        if (!grupos.has(key)) grupos.set(key, { ...ref, columnas: new Set() });
        grupos.get(key).columnas.add(ref.columna);
    }
    const q = x => '"'+x.replace(/"/g,'""')+'"';
    const bloqueos = [];
    for (const ref of grupos.values()) {
        const condiciones = [...ref.columnas].map(c=>q(c)+' = $1').join(' OR ');
        const total = Number((await executor.query('SELECT COUNT(*)::int AS n FROM '+q(ref.esquema)+'.'+q(ref.tabla)+' WHERE '+condiciones,[username])).rows[0].n);
        if (total) bloqueos.push({ tabla: ref.tabla, etiqueta: HISTORIAL_USUARIO.find(t=>t.tabla===ref.tabla)?.etiqueta || ref.tabla, total });
    }
    return bloqueos;
};

const errorHistorial = (username, bloqueos) => {
    const error = new Error(`El usuario conserva referencias: ${bloqueos.map(b => `${b.total} ${b.etiqueta}`).join(', ')}. Puedes desactivarlo para conservar ese historial.`);
    error.code = 'USUARIO_CON_HISTORIAL';
    error.statusCode = 409;
    error.username = username;
    error.bloqueos = bloqueos;
    return error;
};

exports.desactivarUsuario = async (username, actor = null) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await integridad.bloquearCuentas(client);
        const r = await client.query('SELECT username,perfil_id,estado FROM fg_usuario WHERE username=$1 FOR UPDATE', [username]);
        if (!r.rowCount) throw integridad.error('USER_NOT_FOUND', 'El usuario no existe.', 404);
        await integridad.protegerCuenta(client, r.rows[0], actor);
        const sesiones = await integridad.revocarSesiones(client, username);
        await client.query('UPDATE fg_usuario SET estado=FALSE WHERE username=$1', [username]);
        await client.query('COMMIT');
        return { username, estado: false, sesionesCerradas: sesiones.rowCount, mensaje: 'Usuario desactivado y sesiones revocadas.' };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
};

exports.activarUsuario = async (username) => {
    const res = await db.query('UPDATE fg_usuario SET estado = true WHERE username = $1 RETURNING username, estado', [username]);
    if (!res.rowCount) throw integridad.error('USER_NOT_FOUND', 'El usuario no existe.', 404);
    return { success: true, ...res.rows[0] };
};

exports.eliminarUsuario = async (username, actor = null) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await integridad.bloquearCuentas(client);
        const r = await client.query('SELECT username,perfil_id,estado FROM fg_usuario WHERE username=$1 FOR UPDATE', [username]);
        if (!r.rowCount) throw integridad.error('USER_NOT_FOUND', 'El usuario no existe.', 404);
        await integridad.protegerCuenta(client, r.rows[0], actor);
        const bloqueos = await detectarHistorial(username, client);
        if (bloqueos.length) throw errorHistorial(username, bloqueos);
        // El savepoint permite recuperar una FK nueva sin operar una transacción abortada.
        await client.query('SAVEPOINT baja_usuario');
        await client.query('DELETE FROM fg_usuario_sesion WHERE usuario_username=$1', [username]);
        await client.query('DELETE FROM fg_usuario_planta WHERE usuario_username=$1', [username]);
        if (await perfilRepository.estaDisponible(client)) await client.query('DELETE FROM fg_usuario_perfil WHERE usuario_username=$1', [username]);
        try {
            await client.query('DELETE FROM fg_usuario WHERE username=$1', [username]);
        } catch (e) {
            if (e.code !== '23503') throw e;
            await client.query('ROLLBACK TO SAVEPOINT baja_usuario');
            throw errorHistorial(username, [{ tabla: e.table || 'referencias históricas', etiqueta: 'referencias históricas', total: 1 }]);
        }
        await client.query('COMMIT');
        return { accion: 'ELIMINADO', username, mensaje: 'Usuario eliminado de FAREGAS.' };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
};

exports._private = { HISTORIAL_USUARIO, COLUMNAS_REFERENCIA, detectarHistorial };

// MAESTROS DE PERSONA Y GEOGRAFIA
exports.getMaestrosPersona = async () => {
    const doc = await db.query("SELECT key, nombre FROM tipodocumentoidentidad ORDER BY nombre");
    const paises = await db.query("SELECT key, nombre FROM pais ORDER BY nombre");
    return {
        tiposDocumentos: doc.rows,
        paises: paises.rows
    };
};

exports.getDepartamentos = async (paisKey) => {
    const res = await db.query("SELECT key, nombre FROM departamento WHERE pais_key = $1 ORDER BY nombre", [paisKey]);
    return res.rows;
};

exports.getProvincias = async (departamentoKey) => {
    const res = await db.query("SELECT key, nombre FROM provincia WHERE departamento_key = $1 ORDER BY nombre", [departamentoKey]);
    return res.rows;
};

exports.getDistritos = async (provinciaKey) => {
    const res = await db.query("SELECT key, nombre FROM distrito WHERE provincia_key = $1 ORDER BY nombre", [provinciaKey]);
    return res.rows;
};
