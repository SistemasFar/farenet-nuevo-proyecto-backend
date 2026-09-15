const db = require('./config/database');

async function checkBug() {
    try {
        const client = await db.connect();
        
        const q = `
        WITH active_services AS (
            SELECT 
                ta.planta_key,
                t.clave AS tipo_base,
                CASE WHEN t.clave = 'CONFORMIDAD' THEN 'UNICA' ELSE s.modalidad END AS modalidad,
                json_agg(json_build_object(
                    'servicioId', s.id,
                    'codigo', s.codigo,
                    'nombre', s.nombre,
                    'formatoId', s.formato_id
                ) ORDER BY s.codigo) AS operaciones
            FROM fg_servicio s
            JOIN fg_tarifa ta ON ta.servicio_id = s.id
            JOIN fg_tipo_certificado t ON t.clave = s.tipo_certificado_clave
            WHERE s.activo = TRUE 
              AND s.requiere_certificado = TRUE 
              AND ta.activo = TRUE 
            GROUP BY ta.planta_key, t.clave, CASE WHEN t.clave = 'CONFORMIDAD' THEN 'UNICA' ELSE s.modalidad END
        ),
        required_combinations AS (
            SELECT
                a.planta_key,
                p.nombre AS planta_nombre,
                a.tipo_base,
                t.codigo AS tipo_codigo,
                a.modalidad,
                CASE WHEN a.tipo_base = 'CONFORMIDAD' THEN 'CONFORMIDAD' ELSE split_part(a.tipo_base, '_', 1) || '_' || a.modalidad END AS tipo_clave,
                CASE WHEN a.tipo_base = 'CONFORMIDAD' THEN 'Conformidad' ELSE split_part(a.tipo_base, '_', 1) || ' ' || initcap(lower(a.modalidad)) END AS tipo_nombre,
                a.operaciones
            FROM active_services a
            JOIN fg_planta p ON p.key = a.planta_key
            JOIN fg_tipo_certificado t ON t.clave = a.tipo_base
            WHERE p.activo = TRUE
        ),
        existing_ranges AS (
            SELECT c.id, c.planta_key,
                   CASE WHEN c.tipo_certificado_clave = 'CONFORMIDAD' THEN 'CONFORMIDAD' ELSE split_part(c.tipo_certificado_clave, '_', 1) || '_' || c.modalidad END AS tipo_clave,
                   c.tipo_certificado_clave, c.modalidad,
                   c.nro_inicio, c.nro_actual, c.nro_maximo,
                   c.activo, (c.nro_maximo - c.nro_actual) AS disponibles,
                   (c.nro_actual >= c.nro_maximo) AS agotado,
                   c.fecha_asignacion, c.fecha_cierre
            FROM fg_correlativo_certificado c
        ),
        final_results AS (
            SELECT 
                er.id,
                req.planta_key AS "plantaKey",
                req.planta_nombre AS "plantaNombre",
                req.tipo_clave AS "tipoClave",
                req.tipo_base AS "tipoBase",
                req.modalidad,
                req.tipo_codigo AS "tipoCodigo",
                req.tipo_nombre AS "tipoNombre",
                er.nro_inicio AS "nroInicio",
                er.nro_actual AS "nroActual",
                er.nro_maximo AS "nroMaximo",
                COALESCE(er.activo, FALSE) AS activo,
                COALESCE(er.disponibles, 0) AS disponibles,
                COALESCE(er.agotado, FALSE) AS agotado,
                er.fecha_asignacion AS "fechaAsignacion",
                er.fecha_cierre AS "fechaCierre",
                CASE WHEN er.id IS NULL THEN true ELSE false END AS "sinRango",
                req.operaciones AS "operacionesAsociadas"
            FROM required_combinations req
            LEFT JOIN existing_ranges er 
                ON er.planta_key = req.planta_key 
                AND er.tipo_certificado_clave = req.tipo_base 
                AND er.modalidad = req.modalidad
                AND er.activo = TRUE
            
            UNION ALL
            
            SELECT 
                c.id, c.planta_key AS "plantaKey", p.nombre AS "plantaNombre",
                CASE WHEN c.tipo_certificado_clave = 'CONFORMIDAD' THEN 'CONFORMIDAD' ELSE split_part(c.tipo_certificado_clave, '_', 1) || '_' || c.modalidad END AS "tipoClave",
                c.tipo_certificado_clave AS "tipoBase", c.modalidad,
                t.codigo AS "tipoCodigo",
                CASE WHEN c.tipo_certificado_clave = 'CONFORMIDAD' THEN 'Conformidad' ELSE split_part(c.tipo_certificado_clave, '_', 1) || ' ' || initcap(lower(c.modalidad)) END AS "tipoNombre",
                c.nro_inicio AS "nroInicio", c.nro_actual AS "nroActual", c.nro_maximo AS "nroMaximo",
                c.activo, (c.nro_maximo - c.nro_actual) AS disponibles,
                (c.nro_actual >= c.nro_maximo) AS agotado,
                c.fecha_asignacion AS "fechaAsignacion", c.fecha_cierre AS "fechaCierre",
                false AS "sinRango",
                COALESCE(a.operaciones, '[]'::json) AS "operacionesAsociadas"
            FROM fg_correlativo_certificado c
            JOIN fg_planta p ON p.key = c.planta_key
            JOIN fg_tipo_certificado t ON t.clave = c.tipo_certificado_clave
            LEFT JOIN active_services a 
                ON a.planta_key = c.planta_key 
                AND a.tipo_base = c.tipo_certificado_clave 
                AND a.modalidad = c.modalidad
            WHERE c.activo = FALSE
        )
        SELECT * FROM final_results
        WHERE "plantaKey" = '201'
        `;
        const res = await client.query(q);
        console.log(JSON.stringify(res.rows, null, 2));

        client.release();
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
checkBug();
