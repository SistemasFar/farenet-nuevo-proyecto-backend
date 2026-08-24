const db = require('../../../config/database');

const construirCatalogo = (sede, rows) => {
    const categorias = new Map();

    for (const row of rows) {
        if (!categorias.has(row.categoria_codigo)) {
            categorias.set(row.categoria_codigo, {
                codigo: row.categoria_codigo,
                nombre: row.categoria_nombre,
                orden: Number(row.categoria_orden),
                servicios: []
            });
        }

        categorias.get(row.categoria_codigo).servicios.push({
            id: Number(row.servicio_id),
            codigo: row.servicio_codigo,
            nombre: row.servicio_nombre,
            orden: Number(row.servicio_orden),
            tipo_flujo: row.tipo_flujo,
            requiere_certificado: Boolean(row.requiere_certificado),
            requiere_vehiculo: Boolean(row.requiere_vehiculo),
            tipo_certificado_clave: row.tipo_certificado_clave,
            modalidad: row.modalidad,
            tarifa: {
                id: Number(row.tarifa_id),
                codigo: row.tarifa_codigo,
                precio: Number(row.precio)
            }
        });
    }

    return {
        sede: { key: sede.key, nombre: sede.nombre },
        categorias: [...categorias.values()]
    };
};

exports.obtenerCatalogoPorPlanta = async (plantaKey, queryable = db) => {
    const sedeResult = await queryable.query(
        'SELECT key, nombre FROM fg_planta WHERE key = $1 AND activo = TRUE',
        [plantaKey]
    );
    if (sedeResult.rowCount === 0) return null;

    const result = await queryable.query(`
        SELECT
            c.codigo AS categoria_codigo,
            c.nombre AS categoria_nombre,
            c.orden AS categoria_orden,
            s.id AS servicio_id,
            s.codigo AS servicio_codigo,
            s.nombre AS servicio_nombre,
            s.orden AS servicio_orden,
            s.tipo_flujo,
            s.requiere_certificado,
            s.requiere_vehiculo,
            s.tipo_certificado_clave,
            s.modalidad,
            t.id AS tarifa_id,
            t.codigo AS tarifa_codigo,
            t.precio
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        JOIN fg_planta p ON p.key = t.planta_key
        WHERE t.planta_key = $1
          AND p.activo = TRUE
          AND c.activo = TRUE
          AND s.activo = TRUE
          AND t.activo = TRUE
          AND s.tipo_flujo = 'CERTIFICACION'
        ORDER BY c.orden, s.orden, s.nombre
    `, [plantaKey]);

    return construirCatalogo(sedeResult.rows[0], result.rows);
};

exports.obtenerTarifaOperativaPorCodigo = async (plantaKey, tarifaCodigo, queryable = db) => {
    const result = await queryable.query(`
        SELECT
            t.id,
            t.codigo,
            t.precio,
            s.id AS servicio_id,
            s.codigo AS servicio_codigo,
            s.tipo_flujo,
            s.tipo_certificado_clave,
            s.modalidad,
            s.requiere_certificado,
            s.requiere_vehiculo,
            c.codigo AS categoria_codigo,
            c.nombre AS categoria_nombre
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        JOIN fg_planta p ON p.key = t.planta_key
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        WHERE t.planta_key = $1
          AND t.codigo = $2
          AND p.activo = TRUE
          AND c.activo = TRUE
          AND s.activo = TRUE
          AND t.activo = TRUE
        LIMIT 1
    `, [plantaKey, tarifaCodigo]);

    if (result.rowCount === 0) return null;
    return { ...result.rows[0], precio: Number(result.rows[0].precio) };
};

exports.validarTarifaCertificacion = (tarifa) => {
    if (!tarifa) throw new Error('TARIFA_NO_CONFIGURADA');
    if (tarifa.tipo_flujo !== 'CERTIFICACION') {
        throw new Error('SERVICIO_NO_CERTIFICACION');
    }
    return tarifa;
};

exports.construirCatalogo = construirCatalogo;
