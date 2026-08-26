const db = require('../../../config/database');

const TIPOS_FLUJO = new Set(['CERTIFICACION', 'SERVICIO_COMPLEMENTARIO']);

const validarConfiguracionServicio = async (client, servicio) => {
    if (!TIPOS_FLUJO.has(servicio.tipo_flujo)) throw new Error('TIPO_FLUJO_INVALIDO');

    if (servicio.tipo_flujo === 'CERTIFICACION') {
        if (!servicio.requiere_certificado) throw new Error('CERTIFICACION_REQUIERE_CERTIFICADO');

        const combinacionValida =
            ((servicio.tipo_certificado_clave === 'GNV_ANUAL' || servicio.tipo_certificado_clave === 'GLP_ANUAL')
                && ['INICIAL', 'ANUAL'].includes(servicio.modalidad))
            || (servicio.tipo_certificado_clave === 'CONFORMIDAD' && servicio.modalidad === null);
        if (!combinacionValida) throw new Error('CERTIFICADO_BASE_INCOMPATIBLE');

        const tipo = await client.query(
            'SELECT 1 FROM fg_tipo_certificado WHERE clave = $1 AND activo = TRUE',
            [servicio.tipo_certificado_clave]
        );
        if (tipo.rowCount === 0) throw new Error('CERTIFICADO_BASE_NO_DISPONIBLE');
    }

    if (servicio.tipo_flujo === 'SERVICIO_COMPLEMENTARIO' && servicio.requiere_certificado) {
        throw new Error('SERVICIO_COMPLEMENTARIO_NO_GENERA_CERTIFICADO');
    }
};

exports.validarConfiguracionServicio = validarConfiguracionServicio;

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
        p.empresa_key, e.nombre AS empresa_nombre,
        (SELECT COUNT(*) FROM fg_tarifa t WHERE t.planta_key = p.key AND t.activo = true) as total_tarifas
        FROM fg_planta p
        JOIN fg_empresa e ON e.key = p.empresa_key
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
            INSERT INTO fg_planta (key, nombre, direccion, telefono, activo, empresa_key)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [sede.key, sede.nombre, sede.direccion, sede.telefono, false, sede.empresa_key || 'FAREGAS']);

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

// EMPRESAS

exports.getEmpresas = async () => {
    const result = await db.query(`
        SELECT e.key, e.nombre, e.ruc, e.direccion, e.telefono,
               e.cuenta_banco_nacion, e.activo,
               COUNT(p.key)::int AS total_sedes
        FROM fg_empresa e
        LEFT JOIN fg_planta p ON p.empresa_key = e.key
        GROUP BY e.key, e.nombre, e.ruc, e.direccion, e.telefono,
                 e.cuenta_banco_nacion, e.activo
        ORDER BY e.activo DESC, e.nombre ASC
    `);
    return result.rows;
};

exports.crearEmpresa = async (empresa, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query(`
            INSERT INTO fg_empresa (
                key, nombre, ruc, direccion, telefono,
                cuenta_banco_nacion, activo
            ) VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        `, [empresa.key, empresa.nombre, empresa.ruc, empresa.direccion, empresa.telefono, empresa.cuenta_banco_nacion]);
        await this.registrarAuditoria(client, {
            username, entidad: 'EMPRESA', accion: 'CREAR_EMPRESA', identificador: empresa.key,
            detalles: { despues: { ...empresa, activo: true } },
            planta_key: null, ip_direccion
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw new Error('EMPRESA_DUPLICADA');
        throw error;
    } finally {
        client.release();
    }
};

exports.editarEmpresa = async (key, empresa, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query('SELECT * FROM fg_empresa WHERE key = $1 FOR UPDATE', [key]);
        if (actual.rowCount === 0) throw new Error('EMPRESA_NO_ENCONTRADA');
        await client.query(`
            UPDATE fg_empresa
            SET nombre = $1, ruc = $2, direccion = $3, telefono = $4,
                cuenta_banco_nacion = $5, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE key = $6
        `, [empresa.nombre, empresa.ruc, empresa.direccion, empresa.telefono, empresa.cuenta_banco_nacion, key]);
        await this.registrarAuditoria(client, {
            username, entidad: 'EMPRESA', accion: 'EDITAR_EMPRESA', identificador: key,
            detalles: { antes: actual.rows[0], despues: { ...actual.rows[0], ...empresa } },
            planta_key: null, ip_direccion
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.cambiarEstadoEmpresa = async (key, activo, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query('SELECT * FROM fg_empresa WHERE key = $1 FOR UPDATE', [key]);
        if (actual.rowCount === 0) throw new Error('EMPRESA_NO_ENCONTRADA');
        await client.query(`
            UPDATE fg_empresa
            SET activo = $1, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE key = $2
        `, [activo, key]);
        await this.registrarAuditoria(client, {
            username, entidad: 'EMPRESA', accion: activo ? 'ACTIVAR_EMPRESA' : 'DESACTIVAR_EMPRESA',
            identificador: key,
            detalles: { antes: { activo: actual.rows[0].activo }, despues: { activo } },
            planta_key: null, ip_direccion
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.asignarEmpresaSede = async (plantaKey, empresaKey, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const planta = await client.query('SELECT * FROM fg_planta WHERE key = $1 FOR UPDATE', [plantaKey]);
        if (planta.rowCount === 0) throw new Error('SEDE_NO_ENCONTRADA');
        const empresa = await client.query('SELECT key, nombre FROM fg_empresa WHERE key = $1 AND activo = TRUE', [empresaKey]);
        if (empresa.rowCount === 0) throw new Error('EMPRESA_NO_DISPONIBLE');
        await client.query('UPDATE fg_planta SET empresa_key = $1 WHERE key = $2', [empresaKey, plantaKey]);
        await this.registrarAuditoria(client, {
            username, entidad: 'SEDE', accion: 'ASIGNAR_EMPRESA', identificador: plantaKey,
            detalles: {
                antes: { empresa_key: planta.rows[0].empresa_key },
                despues: { empresa_key: empresaKey, empresa_nombre: empresa.rows[0].nombre }
            },
            planta_key: plantaKey, ip_direccion
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
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
            s.id, s.codigo, s.nombre, s.familia, s.categoria_id,
            c.codigo AS categoria_codigo, c.nombre AS categoria_nombre,
            s.tipo_flujo, s.tipo_certificado_clave, s.modalidad, s.requiere_certificado,
            s.requiere_vehiculo, s.activo, s.orden
        FROM fg_servicio s
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        ORDER BY s.orden ASC, c.orden ASC, s.nombre ASC
    `);
    return result.rows;
};

const obtenerCategoriaActiva = async (client, categoriaId) => {
    const result = await client.query(
        'SELECT id, codigo, nombre FROM fg_categoria_servicio WHERE id = $1 AND activo = TRUE',
        [categoriaId]
    );
    if (result.rowCount === 0) throw new Error('CATEGORIA_NO_DISPONIBLE');
    return result.rows[0];
};

exports.crearServicio = async (servicio, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const check = await client.query('SELECT codigo FROM fg_servicio WHERE codigo = $1', [servicio.codigo]);
        if (check.rows.length > 0) throw new Error('Ya existe un servicio con ese código.');
        const categoria = await obtenerCategoriaActiva(client, servicio.categoria_id);
        await validarConfiguracionServicio(client, servicio);

        const res = await client.query(`
            INSERT INTO fg_servicio (
                codigo, nombre, familia, categoria_id, tipo_flujo, tipo_certificado_clave,
                modalidad, requiere_certificado, requiere_vehiculo, activo, orden
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
        `, [
            servicio.codigo, servicio.nombre, categoria.codigo, categoria.id,
            servicio.tipo_flujo, servicio.tipo_certificado_clave, servicio.modalidad,
            servicio.requiere_certificado, servicio.requiere_vehiculo, true, servicio.orden
        ]);

        await this.registrarAuditoria(client, {
            username, 
            entidad: 'SERVICIO', 
            accion: 'CREAR_SERVICIO', 
            identificador: servicio.codigo,
            detalles: { despues: { ...servicio, familia: categoria.codigo, activo: true } },
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
        const categoria = await obtenerCategoriaActiva(client, servicio.categoria_id);
        await validarConfiguracionServicio(client, servicio);

        await client.query(`
            UPDATE fg_servicio SET 
                nombre = $1, 
                familia = $2, 
                categoria_id = $3,
                tipo_flujo = $4,
                tipo_certificado_clave = $5,
                modalidad = $6,
                requiere_certificado = $7,
                requiere_vehiculo = $8,
                orden = $9
            WHERE id = $10
        `, [
            servicio.nombre, categoria.codigo, categoria.id, servicio.tipo_flujo, servicio.tipo_certificado_clave,
            servicio.modalidad, servicio.requiere_certificado,
            servicio.requiere_vehiculo, servicio.orden, id
        ]);

        await this.registrarAuditoria(client, {
            username, 
            entidad: 'SERVICIO', 
            accion: 'EDITAR_SERVICIO', 
            identificador: anterior.codigo,
            detalles: { 
                antes: { 
                    nombre: anterior.nombre, familia: anterior.familia, categoria_id: anterior.categoria_id, tipo_flujo: anterior.tipo_flujo, tipo_certificado_clave: anterior.tipo_certificado_clave,
                    modalidad: anterior.modalidad, requiere_certificado: anterior.requiere_certificado, 
                    requiere_vehiculo: anterior.requiere_vehiculo, orden: anterior.orden
                },
                despues: { 
                    nombre: servicio.nombre, familia: categoria.codigo, categoria_id: categoria.id, tipo_flujo: servicio.tipo_flujo, tipo_certificado_clave: servicio.tipo_certificado_clave,
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

// CATEGORÍAS

exports.getCategorias = async ({ soloActivas = false } = {}) => {
    const result = await db.query(`
        SELECT id, codigo, nombre, descripcion, activo, orden,
               fecha_creacion, fecha_modificacion
        FROM fg_categoria_servicio
        ${soloActivas ? 'WHERE activo = TRUE' : ''}
        ORDER BY orden ASC, nombre ASC
    `);
    return result.rows;
};

exports.crearCategoria = async (categoria, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`
            INSERT INTO fg_categoria_servicio
                (codigo, nombre, descripcion, activo, orden)
            VALUES ($1, $2, $3, TRUE, $4)
            RETURNING id
        `, [categoria.codigo, categoria.nombre, categoria.descripcion, categoria.orden]);
        await this.registrarAuditoria(client, {
            username, entidad: 'CATEGORIA', accion: 'CREAR_CATEGORIA',
            identificador: categoria.codigo,
            detalles: { despues: { ...categoria, activo: true } },
            planta_key: null, ip_direccion
        });
        await client.query('COMMIT');
        return result.rows[0].id;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw new Error('Ya existe una categoría con ese código.');
        throw error;
    } finally {
        client.release();
    }
};

exports.editarCategoria = async (id, categoria, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query('SELECT * FROM fg_categoria_servicio WHERE id = $1 FOR UPDATE', [id]);
        if (actual.rowCount === 0) throw new Error('Categoría no encontrada.');
        await client.query(`
            UPDATE fg_categoria_servicio
            SET nombre = $1, descripcion = $2, orden = $3, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $4
        `, [categoria.nombre, categoria.descripcion, categoria.orden, id]);
        await this.registrarAuditoria(client, {
            username, entidad: 'CATEGORIA', accion: 'EDITAR_CATEGORIA',
            identificador: actual.rows[0].codigo,
            detalles: {
                antes: actual.rows[0],
                despues: { ...actual.rows[0], ...categoria }
            },
            planta_key: null, ip_direccion
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.cambiarEstadoCategoria = async (id, activo, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query('SELECT * FROM fg_categoria_servicio WHERE id = $1 FOR UPDATE', [id]);
        if (actual.rowCount === 0) throw new Error('Categoría no encontrada.');
        if (!activo) {
            const relacionados = await client.query(
                'SELECT COUNT(*)::int total FROM fg_servicio WHERE categoria_id = $1 AND activo = TRUE',
                [id]
            );
            if (relacionados.rows[0].total > 0) {
                throw new Error('No se puede desactivar una categoría con servicios activos.');
            }
        }
        await client.query(`
            UPDATE fg_categoria_servicio
            SET activo = $1, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [activo, id]);
        await this.registrarAuditoria(client, {
            username, entidad: 'CATEGORIA',
            accion: activo ? 'ACTIVAR_CATEGORIA' : 'DESACTIVAR_CATEGORIA',
            identificador: actual.rows[0].codigo,
            detalles: {
                antes: { activo: actual.rows[0].activo },
                despues: { activo }
            },
            planta_key: null, ip_direccion
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
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

exports.obtenerSedesPorServicio = async () => {
    const query = `
        SELECT t.servicio_id, json_agg(json_build_object(
            'key', p.key, 
            'nombre', p.nombre,
            'tarifa_id', t.id,
            'precio', t.precio,
            'producto_facturacion_id', t.producto_facturacion_id,
            'activo', t.activo
        )) AS sedes
        FROM fg_tarifa t
        JOIN fg_planta p ON t.planta_key = p.key
        WHERE p.activo = true
        GROUP BY t.servicio_id
    `;
    const result = await require('../../../config/database').query(query);
    const dict = {};
    result.rows.forEach(row => {
        dict[row.servicio_id] = row.sedes;
    });
    return dict;
};
