const db = require('../../../config/database');

exports.registrarAuditoria = async (client, { username, entidad, accion, identificador, detalles, planta_key, ip_direccion }) => {
    await client.query(`
        INSERT INTO fg_auditoria_config 
        (username, entidad, accion, identificador, detalles, planta_key, ip_direccion)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [username, entidad, accion, identificador, JSON.stringify(detalles), planta_key, ip_direccion]);
};

exports.getSedes = async () => {
    const result = await db.query(`
        SELECT p.key, p.nombre, p.direccion, p.telefono, p.activo,
        (SELECT COUNT(*) FROM fg_tarifa t WHERE t.planta_key = p.key AND t.activo = true) as total_tarifas
        FROM fg_planta p
        ORDER BY p.activo DESC, p.nombre ASC
    `);
    return result.rows;
};

exports.crearSede = async (sede, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const check = await client.query('SELECT key FROM fg_planta WHERE key = $1', [sede.key]);
        if (check.rows.length > 0) throw new Error('Ya existe una sede con ese código (key).');

        await client.query(`
            INSERT INTO fg_planta (key, nombre, direccion, telefono, activo)
            VALUES ($1, $2, $3, $4, $5)
        `, [sede.key, sede.nombre, sede.direccion, sede.telefono, false]);

        await this.registrarAuditoria(client, {
            username, entidad: 'SEDE', accion: 'CREAR_SEDE', identificador: sede.key,
            detalles: { despues: { ...sede, activo: false } },
            planta_key: sede.key, ip_direccion
        });

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.editarSede = async (key, sede, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const check = await client.query('SELECT * FROM fg_planta WHERE key = $1', [key]);
        if (check.rows.length === 0) throw new Error('Sede no encontrada.');
        const anterior = check.rows[0];

        await client.query(`
            UPDATE fg_planta SET nombre = $1, direccion = $2, telefono = $3
            WHERE key = $4
        `, [sede.nombre, sede.direccion, sede.telefono, key]);

        await this.registrarAuditoria(client, {
            username, entidad: 'SEDE', accion: 'EDITAR_SEDE', identificador: key,
            detalles: { 
                antes: { nombre: anterior.nombre, direccion: anterior.direccion, telefono: anterior.telefono },
                despues: { nombre: sede.nombre, direccion: sede.direccion, telefono: sede.telefono }
            },
            planta_key: key, ip_direccion
        });

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.cambiarEstadoSede = async (key, activo, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const check = await client.query('SELECT * FROM fg_planta WHERE key = $1', [key]);
        if (check.rows.length === 0) throw new Error('Sede no encontrada.');
        const anterior = check.rows[0];

        await client.query(`
            UPDATE fg_planta SET activo = $1 WHERE key = $2
        `, [activo, key]);

        await this.registrarAuditoria(client, {
            username, entidad: 'SEDE', accion: activo ? 'ACTIVAR_SEDE' : 'DESACTIVAR_SEDE', identificador: key,
            detalles: { 
                antes: { nombre: anterior.nombre, activo: anterior.activo },
                despues: { nombre: anterior.nombre, activo: activo }
            },
            planta_key: key, ip_direccion
        });

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

// SERVICIOS

exports.getServicios = async () => {
    const result = await db.query(`
        SELECT 
            id, codigo, nombre, familia, tipo_certificado_clave, modalidad, 
            requiere_certificado, requiere_vehiculo, activo, orden
        FROM fg_servicio
        ORDER BY orden ASC, familia ASC, nombre ASC
    `);
    return result.rows;
};

exports.crearServicio = async (servicio, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const check = await client.query('SELECT codigo FROM fg_servicio WHERE codigo = $1', [servicio.codigo]);
        if (check.rows.length > 0) throw new Error('Ya existe un servicio con ese código.');

        const res = await client.query(`
            INSERT INTO fg_servicio (
                codigo, nombre, familia, tipo_certificado_clave, modalidad, 
                requiere_certificado, requiere_vehiculo, activo, orden
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
        `, [
            servicio.codigo, servicio.nombre, servicio.familia, servicio.tipo_certificado_clave, 
            servicio.modalidad, servicio.requiere_certificado, servicio.requiere_vehiculo, true, servicio.orden
        ]);

        await this.registrarAuditoria(client, {
            username, 
            entidad: 'SERVICIO', 
            accion: 'CREAR_SERVICIO', 
            identificador: servicio.codigo,
            detalles: { despues: { ...servicio, activo: true } },
            planta_key: null, 
            ip_direccion
        });

        await client.query('COMMIT');
        return res.rows[0].id;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.editarServicio = async (id, servicio, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const check = await client.query('SELECT * FROM fg_servicio WHERE id = $1', [id]);
        if (check.rows.length === 0) throw new Error('Servicio no encontrado.');
        const anterior = check.rows[0];

        await client.query(`
            UPDATE fg_servicio SET 
                nombre = $1, 
                familia = $2, 
                tipo_certificado_clave = $3, 
                modalidad = $4, 
                requiere_certificado = $5, 
                requiere_vehiculo = $6, 
                orden = $7
            WHERE id = $8
        `, [
            servicio.nombre, servicio.familia, servicio.tipo_certificado_clave, 
            servicio.modalidad, servicio.requiere_certificado, servicio.requiere_vehiculo, servicio.orden, id
        ]);

        await this.registrarAuditoria(client, {
            username, 
            entidad: 'SERVICIO', 
            accion: 'EDITAR_SERVICIO', 
            identificador: anterior.codigo,
            detalles: { 
                antes: { 
                    nombre: anterior.nombre, familia: anterior.familia, tipo_certificado_clave: anterior.tipo_certificado_clave, 
                    modalidad: anterior.modalidad, requiere_certificado: anterior.requiere_certificado, 
                    requiere_vehiculo: anterior.requiere_vehiculo, orden: anterior.orden
                },
                despues: { 
                    nombre: servicio.nombre, familia: servicio.familia, tipo_certificado_clave: servicio.tipo_certificado_clave, 
                    modalidad: servicio.modalidad, requiere_certificado: servicio.requiere_certificado, 
                    requiere_vehiculo: servicio.requiere_vehiculo, orden: servicio.orden
                }
            },
            planta_key: null, 
            ip_direccion
        });

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.cambiarEstadoServicio = async (id, activo, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const check = await client.query('SELECT * FROM fg_servicio WHERE id = $1', [id]);
        if (check.rows.length === 0) throw new Error('Servicio no encontrado.');
        const anterior = check.rows[0];

        await client.query('UPDATE fg_servicio SET activo = $1 WHERE id = $2', [activo, id]);

        await this.registrarAuditoria(client, {
            username, 
            entidad: 'SERVICIO', 
            accion: activo ? 'ACTIVAR_SERVICIO' : 'DESACTIVAR_SERVICIO', 
            identificador: anterior.codigo,
            detalles: { 
                antes: { nombre: anterior.nombre, activo: anterior.activo },
                despues: { nombre: anterior.nombre, activo: activo }
            },
            planta_key: null, 
            ip_direccion
        });

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};
