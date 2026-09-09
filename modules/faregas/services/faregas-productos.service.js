const db = require('../../../config/database');
const configService = require('./faregas-config.service');

exports.listar = async ({ buscar, estado, paraVenta, unidad, categoriaId } = {}) => {
    const condiciones = [];
    const valores = [];
    const agregar = (sql, valor) => {
        valores.push(valor);
        condiciones.push(sql.replace('?', `$${valores.length}`));
    };

    if (buscar) {
        valores.push(`%${buscar}%`);
        const codigoParam = `$${valores.length}`;
        valores.push(`%${buscar}%`);
        const descripcionParam = `$${valores.length}`;
        condiciones.push(`(p.codigo_sku ILIKE ${codigoParam} OR p.descripcion ILIKE ${descripcionParam})`);
    }
    if (estado === true || estado === false) agregar('p.activo = ?', estado);
    if (paraVenta === true || paraVenta === false) agregar('p.es_para_venta = ?', paraVenta);
    if (unidad) agregar('p.unidad = ?', unidad);
    if (categoriaId) agregar('p.categoria_id = ?', categoriaId);

    const result = await db.query(`
        SELECT p.id, p.codigo_sku, p.descripcion, p.tipo_producto, p.categoria_dms,
               p.categoria_id, c.codigo AS categoria_codigo, c.nombre AS categoria_nombre,
               p.cuenta_por_cobrar, p.unidad, p.precio_unitario, p.precio_referencia,
               p.valor_referencial_unitario, p.codigo_clasificacion_sunat,
               p.tipo_afectacion_igv, p.porcentaje_isc, p.disponible_pos,
               p.es_para_venta, p.es_para_compra, p.tiene_icbper, p.activo,
               p.fecha_creacion, p.fecha_modificacion
        FROM fg_producto_facturacion p
        LEFT JOIN fg_categoria_servicio c ON c.id = p.categoria_id
        ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
        ORDER BY p.codigo_sku ASC
    `, valores);
    return result.rows.map((producto) => ({
        ...producto,
        precio_unitario: producto.precio_unitario === null ? null : Number(producto.precio_unitario),
        precio_referencia: producto.precio_referencia === null ? null : Number(producto.precio_referencia),
        valor_referencial_unitario: producto.valor_referencial_unitario === null ? null : Number(producto.valor_referencial_unitario),
        porcentaje_isc: producto.porcentaje_isc === null ? null : Number(producto.porcentaje_isc)
    }));
};

const validarCategoriaActiva = async (client, categoriaId) => {
    const categoria = await client.query(
        'SELECT id, codigo, nombre FROM fg_categoria_servicio WHERE id = $1 AND activo = TRUE',
        [categoriaId]
    );
    if (categoria.rowCount === 0) throw new Error('CATEGORIA_NO_DISPONIBLE');
    return categoria.rows[0];
};

exports.crear = async (producto, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await validarCategoriaActiva(client, producto.categoria_id);
        const result = await client.query(`
            INSERT INTO fg_producto_facturacion (
                codigo_sku, descripcion, tipo_producto, categoria_dms, categoria_id,
                cuenta_por_cobrar, unidad, precio_unitario, precio_referencia,
                valor_referencial_unitario, codigo_clasificacion_sunat,
                tipo_afectacion_igv, porcentaje_isc, disponible_pos,
                es_para_venta, es_para_compra, tiene_icbper, activo
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9,
                $10, $11, $12, $13, $14, $15, $16, $17, $18
            ) RETURNING id
        `, [
            producto.codigo_sku, producto.descripcion, producto.tipo_producto,
            producto.categoria_dms, producto.categoria_id,
            producto.cuenta_por_cobrar, producto.unidad,
            producto.precio_unitario, producto.precio_referencia,
            producto.valor_referencial_unitario, producto.codigo_clasificacion_sunat,
            producto.tipo_afectacion_igv, producto.porcentaje_isc,
            producto.disponible_pos, producto.es_para_venta,
            producto.es_para_compra, producto.tiene_icbper, producto.activo
        ]);
        await configService.registrarAuditoria(client, {
            username, entidad: 'PRODUCTO_FACTURACION', accion: 'CREAR_PRODUCTO',
            identificador: producto.codigo_sku,
            detalles: { despues: producto }, planta_key: null, ip_direccion
        });
        await client.query('COMMIT');
        return result.rows[0].id;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw new Error('SKU_DUPLICADO');
        throw error;
    } finally {
        client.release();
    }
};

exports.editar = async (id, producto, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query('SELECT * FROM fg_producto_facturacion WHERE id = $1 FOR UPDATE', [id]);
        if (actual.rowCount === 0) throw new Error('PRODUCTO_NO_ENCONTRADO');
        await validarCategoriaActiva(client, producto.categoria_id);
        await client.query(`
            UPDATE fg_producto_facturacion SET
                descripcion = $1, tipo_producto = $2, categoria_dms = $3,
                categoria_id = $4, cuenta_por_cobrar = $5, unidad = $6,
                precio_unitario = $7, precio_referencia = $8,
                valor_referencial_unitario = $9,
                codigo_clasificacion_sunat = $10, tipo_afectacion_igv = $11,
                porcentaje_isc = $12, disponible_pos = $13,
                es_para_venta = $14, es_para_compra = $15, tiene_icbper = $16,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $17
        `, [
            producto.descripcion, producto.tipo_producto, producto.categoria_dms,
            producto.categoria_id, producto.cuenta_por_cobrar,
            producto.unidad, producto.precio_unitario,
            producto.precio_referencia, producto.valor_referencial_unitario,
            producto.codigo_clasificacion_sunat, producto.tipo_afectacion_igv,
            producto.porcentaje_isc, producto.disponible_pos,
            producto.es_para_venta, producto.es_para_compra,
            producto.tiene_icbper, id
        ]);
        await configService.registrarAuditoria(client, {
            username, entidad: 'PRODUCTO_FACTURACION', accion: 'EDITAR_PRODUCTO',
            identificador: actual.rows[0].codigo_sku,
            detalles: { antes: actual.rows[0], despues: { ...actual.rows[0], ...producto } },
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

exports.cambiarEstado = async (id, activo, username, ip_direccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query('SELECT * FROM fg_producto_facturacion WHERE id = $1 FOR UPDATE', [id]);
        if (actual.rowCount === 0) throw new Error('PRODUCTO_NO_ENCONTRADO');
        await client.query(`
            UPDATE fg_producto_facturacion
            SET activo = $1, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [activo, id]);
        await configService.registrarAuditoria(client, {
            username, entidad: 'PRODUCTO_FACTURACION',
            accion: activo ? 'ACTIVAR_PRODUCTO' : 'DESACTIVAR_PRODUCTO',
            identificador: actual.rows[0].codigo_sku,
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
