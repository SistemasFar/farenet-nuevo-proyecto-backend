const db = require('../../../config/database');

const FLUJOS_DE_CERTIFICADO = new Set(['CERTIFICACION', 'TALLER_INSPECCION']);

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
                precio: Number(row.precio),
                productoFacturacionId: row.producto_facturacion_id ? Number(row.producto_facturacion_id) : null,
                requiereChip: row.requiere_chip === true,
                chip: row.requiere_chip === true ? {
                    productoInventariableId: row.producto_chip_id ? Number(row.producto_chip_id) : null,
                    codigo: row.chip_codigo || null,
                    nombre: row.chip_nombre || null,
                    productoFacturacionId: row.chip_producto_facturacion_id ? Number(row.chip_producto_facturacion_id) : null,
                    codigoSku: row.chip_producto_sku || null,
                    descripcion: row.chip_producto_descripcion || null,
                    precio: row.chip_precio === null ? null : Number(row.chip_precio)
                } : null,
                importeTotal: Number(row.precio) + (row.requiere_chip === true && row.chip_precio !== null ? Number(row.chip_precio) : 0)
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
            t.precio,
            t.producto_facturacion_id,
            pf.requiere_chip,
            pf.producto_chip_id,
            pi.codigo AS chip_codigo,
            pi.nombre AS chip_nombre,
            COALESCE(pfc.id, pf.id) AS chip_producto_facturacion_id,
            COALESCE(pfc.codigo_sku, pf.codigo_sku) AS chip_producto_sku,
            COALESCE(pfc.descripcion, pf.descripcion) AS chip_producto_descripcion,
            COALESCE(pf.precio_chip, pfc.precio_unitario) AS chip_precio
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        JOIN fg_planta p ON p.key = t.planta_key
        LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
        LEFT JOIN fg_producto_inventariable pi
          ON pi.id = pf.producto_chip_id
         AND pi.activo = TRUE
         AND pi.control_stock = TRUE
         AND pi.tipo = 'CHIP_SERIALIZADO'
        LEFT JOIN fg_producto_inventariable_sede pis
          ON pis.producto_inventariable_id = pi.id
         AND pis.planta_key = t.planta_key
         AND pis.activo = TRUE
        LEFT JOIN fg_producto_facturacion pfc
          ON pfc.id = COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id)
         AND pfc.activo = TRUE
         AND pfc.es_para_venta = TRUE
         AND COALESCE(BTRIM(pfc.codigo_sku), '') <> ''
         AND COALESCE(BTRIM(pfc.descripcion), '') <> ''
         AND UPPER(BTRIM(pfc.unidad)) IN ('NIU', 'ZZ')
         AND BTRIM(pfc.tipo_afectacion_igv) = '10'
         AND (COALESCE(BTRIM(pfc.codigo_clasificacion_sunat), '') = '' OR BTRIM(pfc.codigo_clasificacion_sunat) ~ '^\\d{8}$')
        WHERE t.planta_key = $1
          AND p.activo = TRUE
          AND c.activo = TRUE
          AND s.activo = TRUE
          AND t.activo = TRUE
          AND s.tipo_flujo IN ('CERTIFICACION', 'TALLER_INSPECCION')
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
            t.producto_facturacion_id,
            s.id AS servicio_id,
            s.codigo AS servicio_codigo,
            s.nombre AS servicio_nombre,
            s.tipo_flujo,
            s.tipo_certificado_clave,
            s.modalidad,
            s.requiere_certificado,
            s.requiere_vehiculo,
            c.codigo AS categoria_codigo,
            c.nombre AS categoria_nombre,
            pf.codigo_sku AS producto_sku,
            pf.descripcion AS producto_descripcion,
            pf.unidad AS producto_unidad,
            pf.tipo_afectacion_igv AS producto_afectacion_igv,
            pf.codigo_clasificacion_sunat AS producto_codigo_sunat
            ,pf.requiere_chip
            ,pf.producto_chip_id
            ,pi.codigo AS chip_codigo
            ,pi.nombre AS chip_nombre
            ,COALESCE(pfc.id, pf.id) AS chip_producto_facturacion_id
            ,COALESCE(pfc.codigo_sku, pf.codigo_sku) AS chip_producto_sku
            ,COALESCE(pfc.descripcion, pf.descripcion) AS chip_producto_descripcion
            ,COALESCE(pfc.unidad, pf.unidad) AS chip_producto_unidad
            ,COALESCE(pfc.tipo_afectacion_igv, pf.tipo_afectacion_igv) AS chip_producto_afectacion_igv
            ,COALESCE(pfc.codigo_clasificacion_sunat, pf.codigo_clasificacion_sunat) AS chip_producto_codigo_sunat
            ,COALESCE(pf.precio_chip, pfc.precio_unitario) AS chip_precio
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        JOIN fg_planta p ON p.key = t.planta_key
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
        LEFT JOIN fg_producto_inventariable pi
          ON pi.id = pf.producto_chip_id
         AND pi.activo = TRUE
         AND pi.control_stock = TRUE
         AND pi.tipo = 'CHIP_SERIALIZADO'
        LEFT JOIN fg_producto_inventariable_sede pis
          ON pis.producto_inventariable_id = pi.id
         AND pis.planta_key = t.planta_key
         AND pis.activo = TRUE
        LEFT JOIN fg_producto_facturacion pfc
          ON pfc.id = COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id)
         AND pfc.activo = TRUE
         AND pfc.es_para_venta = TRUE
         AND COALESCE(BTRIM(pfc.codigo_sku), '') <> ''
         AND COALESCE(BTRIM(pfc.descripcion), '') <> ''
         AND UPPER(BTRIM(pfc.unidad)) IN ('NIU', 'ZZ')
         AND BTRIM(pfc.tipo_afectacion_igv) = '10'
         AND (COALESCE(BTRIM(pfc.codigo_clasificacion_sunat), '') = '' OR BTRIM(pfc.codigo_clasificacion_sunat) ~ '^\\d{8}$')
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
    if (!FLUJOS_DE_CERTIFICADO.has(tarifa.tipo_flujo)
        || tarifa.requiere_certificado !== true
        || !tarifa.tipo_certificado_clave) {
        throw new Error('SERVICIO_NO_CERTIFICACION');
    }
    return tarifa;
};

exports.construirCatalogo = construirCatalogo;
