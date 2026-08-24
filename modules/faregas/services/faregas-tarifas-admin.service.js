const db = require('../../../config/database');
const configService = require('./faregas-config.service');

const serializarTarifa = (row) => ({
    id: row.id,
    planta_key: row.planta_key,
    sede_nombre: row.sede_nombre,
    servicio_id: row.servicio_id,
    servicio_codigo: row.servicio_codigo,
    servicio_nombre: row.servicio_nombre,
    categoria_codigo: row.categoria_codigo,
    categoria_nombre: row.categoria_nombre,
    precio: Number(row.precio),
    producto_facturacion_id: row.producto_facturacion_id,
    producto_sku: row.producto_sku,
    producto_descripcion: row.producto_descripcion,
    producto_unidad: row.producto_unidad,
    producto_afectacion_igv: row.producto_afectacion_igv,
    producto_cuenta_por_cobrar: row.producto_cuenta_por_cobrar,
    producto_precio_referencia: row.producto_precio_referencia === null ? null : Number(row.producto_precio_referencia),
    producto_activo: row.producto_activo,
    activo: row.activo
});

exports.listarSedes = async () => {
    const result = await db.query(`
        SELECT p.key, p.nombre, p.direccion, p.activo,
               COUNT(t.id) FILTER (WHERE t.activo = TRUE) AS total_tarifas_activas
        FROM fg_planta p
        LEFT JOIN fg_tarifa t ON t.planta_key = p.key
        GROUP BY p.key, p.nombre, p.direccion, p.activo
        ORDER BY p.activo DESC, p.nombre ASC
    `);
    return result.rows.map((row) => ({ ...row, total_tarifas_activas: Number(row.total_tarifas_activas) }));
};

exports.listar = async ({ plantaKey, buscar, categoria, activo } = {}) => {
    const valores = [plantaKey];
    const condiciones = ['t.planta_key = $1'];
    if (buscar) {
        valores.push(`%${buscar}%`);
        condiciones.push(`(s.codigo ILIKE $${valores.length} OR s.nombre ILIKE $${valores.length})`);
    }
    if (categoria) {
        valores.push(categoria);
        condiciones.push(`c.codigo = $${valores.length}`);
    }
    if (activo === true || activo === false) {
        valores.push(activo);
        condiciones.push(`t.activo = $${valores.length}`);
    }
    const result = await db.query(`
        SELECT t.id, t.planta_key, p.nombre AS sede_nombre,
               t.servicio_id, s.codigo AS servicio_codigo, s.nombre AS servicio_nombre,
               c.codigo AS categoria_codigo, c.nombre AS categoria_nombre,
               t.precio, t.producto_facturacion_id,
               pf.codigo_sku AS producto_sku, pf.descripcion AS producto_descripcion,
               pf.unidad AS producto_unidad, pf.tipo_afectacion_igv AS producto_afectacion_igv,
               pf.cuenta_por_cobrar AS producto_cuenta_por_cobrar,
               pf.precio_referencia AS producto_precio_referencia,
               pf.activo AS producto_activo, t.activo
        FROM fg_tarifa t
        JOIN fg_planta p ON p.key = t.planta_key
        JOIN fg_servicio s ON s.id = t.servicio_id
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
        WHERE ${condiciones.join(' AND ')}
        ORDER BY c.orden, s.orden, s.nombre
    `, valores);
    return result.rows.map(serializarTarifa);
};

exports.listarServiciosDisponibles = async (plantaKey) => {
    const result = await db.query(`
        SELECT s.id, s.codigo, s.nombre, s.familia, s.tipo_flujo, s.tipo_certificado_clave,
               s.modalidad, s.orden, c.codigo AS categoria_codigo,
               c.nombre AS categoria_nombre
        FROM fg_servicio s
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        WHERE s.activo = TRUE AND c.activo = TRUE
          AND NOT EXISTS (
              SELECT 1 FROM fg_tarifa t
              WHERE t.planta_key = $1 AND t.servicio_id = s.id
          )
        ORDER BY c.orden, s.orden, s.nombre
    `, [plantaKey]);
    return result.rows;
};

exports.buscarProductos = async (texto) => {
    const result = await db.query(`
        SELECT id, codigo_sku, descripcion, unidad, tipo_afectacion_igv,
               cuenta_por_cobrar, precio_referencia, activo
        FROM fg_producto_facturacion
        WHERE activo = TRUE
          AND (codigo_sku ILIKE $1 OR descripcion ILIKE $1)
        ORDER BY CASE WHEN codigo_sku = $2 THEN 0 ELSE 1 END, codigo_sku
        LIMIT 30
    `, [`%${texto}%`, texto]);
    return result.rows.map((row) => ({
        ...row,
        precio_referencia: row.precio_referencia === null ? null : Number(row.precio_referencia)
    }));
};

const obtenerProducto = async (client, productoId, productoAnteriorId = null) => {
    if (productoId === null) return null;
    const result = await client.query(`
        SELECT id, codigo_sku, descripcion, activo
        FROM fg_producto_facturacion WHERE id = $1
    `, [productoId]);
    if (result.rowCount === 0) throw new Error('PRODUCTO_NO_ENCONTRADO');
    if (!result.rows[0].activo && Number(productoAnteriorId) !== Number(productoId)) {
        throw new Error('PRODUCTO_INACTIVO');
    }
    return result.rows[0];
};

exports.crear = async (tarifa, username, ipDireccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const planta = await client.query('SELECT key, nombre FROM fg_planta WHERE key = $1', [tarifa.planta_key]);
        if (planta.rowCount === 0) throw new Error('SEDE_NO_ENCONTRADA');
        const servicio = await client.query(`
            SELECT s.*, c.codigo AS categoria_codigo
            FROM fg_servicio s JOIN fg_categoria_servicio c ON c.id = s.categoria_id
            WHERE s.id = $1 AND s.activo = TRUE AND c.activo = TRUE
        `, [tarifa.servicio_id]);
        if (servicio.rowCount === 0) throw new Error('SERVICIO_NO_DISPONIBLE');
        const producto = await obtenerProducto(client, tarifa.producto_facturacion_id);
        const s = servicio.rows[0];
        const result = await client.query(`
            INSERT INTO fg_tarifa (
                planta_key, codigo, familia, nombre, tipo_certificado_clave,
                modalidad, precio, activo, orden, servicio_id, producto_facturacion_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            RETURNING id
        `, [
            tarifa.planta_key, s.codigo, s.categoria_codigo, s.nombre,
            s.tipo_certificado_clave, s.modalidad, tarifa.precio, tarifa.activo,
            s.orden, s.id, tarifa.producto_facturacion_id
        ]);
        await configService.registrarAuditoria(client, {
            username, entidad: 'TARIFA', accion: 'CREAR_TARIFA',
            identificador: `${tarifa.planta_key}:${s.codigo}`,
            detalles: { despues: {
                sede: planta.rows[0], servicio: { id: s.id, codigo: s.codigo, nombre: s.nombre },
                precio: tarifa.precio, producto: producto && { id: producto.id, sku: producto.codigo_sku },
                activo: tarifa.activo
            } }, planta_key: tarifa.planta_key, ip_direccion: ipDireccion
        });
        await client.query('COMMIT');
        return result.rows[0].id;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw new Error('TARIFA_DUPLICADA');
        throw error;
    } finally {
        client.release();
    }
};

exports.editar = async (id, cambios, username, ipDireccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actualResult = await client.query(`
            SELECT t.*, s.codigo AS servicio_codigo, s.nombre AS servicio_nombre,
                   p.nombre AS sede_nombre, pf.codigo_sku AS producto_sku
            FROM fg_tarifa t
            JOIN fg_servicio s ON s.id = t.servicio_id
            JOIN fg_planta p ON p.key = t.planta_key
            LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
            WHERE t.id = $1 FOR UPDATE OF t
        `, [id]);
        if (actualResult.rowCount === 0) throw new Error('TARIFA_NO_ENCONTRADA');
        const actual = actualResult.rows[0];
        const producto = await obtenerProducto(client, cambios.producto_facturacion_id, actual.producto_facturacion_id);
        await client.query(`
            UPDATE fg_tarifa
            SET precio = $1, producto_facturacion_id = $2, activo = $3
            WHERE id = $4
        `, [cambios.precio, cambios.producto_facturacion_id, cambios.activo, id]);
        const antes = {
            sede: { key: actual.planta_key, nombre: actual.sede_nombre },
            servicio: { id: actual.servicio_id, codigo: actual.servicio_codigo, nombre: actual.servicio_nombre },
            precio: Number(actual.precio),
            producto: actual.producto_facturacion_id ? { id: actual.producto_facturacion_id, sku: actual.producto_sku } : null,
            activo: actual.activo
        };
        const despues = {
            ...antes, precio: cambios.precio,
            producto: producto ? { id: producto.id, sku: producto.codigo_sku } : null,
            activo: cambios.activo
        };
        await configService.registrarAuditoria(client, {
            username, entidad: 'TARIFA', accion: 'EDITAR_TARIFA',
            identificador: `${actual.planta_key}:${actual.servicio_codigo}`,
            detalles: { antes, despues }, planta_key: actual.planta_key, ip_direccion: ipDireccion
        });
        if (Number(actual.producto_facturacion_id || 0) !== Number(cambios.producto_facturacion_id || 0)) {
            await configService.registrarAuditoria(client, {
                username, entidad: 'TARIFA',
                accion: actual.producto_facturacion_id ? 'CAMBIAR_SKU_TARIFA' : 'ASIGNAR_SKU_TARIFA',
                identificador: `${actual.planta_key}:${actual.servicio_codigo}`,
                detalles: { antes: antes.producto, despues: despues.producto },
                planta_key: actual.planta_key, ip_direccion: ipDireccion
            });
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.cambiarEstado = async (id, activo, username, ipDireccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query(`
            SELECT t.id, t.planta_key, t.activo, s.codigo AS servicio_codigo
            FROM fg_tarifa t JOIN fg_servicio s ON s.id = t.servicio_id
            WHERE t.id = $1 FOR UPDATE OF t
        `, [id]);
        if (actual.rowCount === 0) throw new Error('TARIFA_NO_ENCONTRADA');
        await client.query('UPDATE fg_tarifa SET activo = $1 WHERE id = $2', [activo, id]);
        await configService.registrarAuditoria(client, {
            username, entidad: 'TARIFA', accion: activo ? 'ACTIVAR_TARIFA' : 'DESACTIVAR_TARIFA',
            identificador: `${actual.rows[0].planta_key}:${actual.rows[0].servicio_codigo}`,
            detalles: { antes: { activo: actual.rows[0].activo }, despues: { activo } },
            planta_key: actual.rows[0].planta_key, ip_direccion: ipDireccion
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
