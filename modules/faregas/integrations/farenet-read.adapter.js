const db = require('../../../config/database');
const { desdeFilaFarenet } = require('../mappers/faregas-vehiculo.mapper');

// Unica frontera de Faregas que consulta tablas de Farenet. Solo lectura.
exports.buscarPersona = async (tipoDocumento, nroDocumento) => {
    const res = await db.query(`
        SELECT
            tipodocumentoidentidad_key AS "tipoDocumento",
            nrodocumentoidentidad AS "nroDocumento",
            nombrerazonsocial AS "nombreRazonSocial",
            direccion,
            telefono,
            email AS "correo"
        FROM persona
        WHERE tipodocumentoidentidad_key = $1 AND nrodocumentoidentidad = $2
    `, [tipoDocumento, nroDocumento]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

exports.buscarVehiculoPorPlaca = async (placa) => {
    const res = await db.query(`
        SELECT
            COALESCE(NULLIF(TRIM(tp.nroplaca), ''), NULLIF(TRIM(v.nroplacaantigua), '')) AS placa,
            v.categoria_key,
            c.nombre AS categoria_nombre,
            v.vehiculoclase_key,
            vc.nombre AS vehiculoclase_nombre,
            v.marca_key,
            m.nombre AS marca_nombre,
            v.modelo_key,
            mo.nombre AS modelo_nombre,
            v.aniofabricacion,
            v.nroserie,
            v.nromotor,
            v.combustible_key,
            co.nombre AS combustible_nombre,
            v.color_key,
            col.nombre AS color_nombre,
            v.carroceria_key,
            ca.nombre AS carroceria_nombre,
            v.nrocilindros,
            v.nroejes,
            v.nroruedas,
            v.nroasientos,
            v.nropasajeros,
            v.longitud,
            v.ancho,
            v.alto,
            v.pesoseco,
            v.pesobruto,
            v.cargautil,
            v.kilometraje,
            v.marcacarroceria,
            v.nropuertas,
            v.nropisos,
            v.nrosalidaemergencia
        FROM vehiculo v
        LEFT JOIN tarjetapropiedad tp ON v.tarjetapropiedad_id = tp.id
        LEFT JOIN categoria c ON v.categoria_key = c.key
        LEFT JOIN vehiculoclase vc ON v.vehiculoclase_key = vc.key
        LEFT JOIN marca m ON v.marca_key = m.key
        LEFT JOIN modelo mo ON v.modelo_key = mo.key
        LEFT JOIN combustible co ON v.combustible_key = co.key
        LEFT JOIN color col ON v.color_key = col.key
        LEFT JOIN carroceria ca ON v.carroceria_key = ca.key
        WHERE UPPER(TRIM(COALESCE(tp.nroplaca, ''))) = UPPER(TRIM($1))
           OR UPPER(TRIM(COALESCE(v.nroplacaantigua, ''))) = UPPER(TRIM($1))
           OR UPPER(TRIM(COALESCE(v.nromotor, ''))) = UPPER(TRIM($1))
        ORDER BY
            CASE
                WHEN UPPER(TRIM(COALESCE(tp.nroplaca, ''))) = UPPER(TRIM($1)) THEN 1
                WHEN UPPER(TRIM(COALESCE(v.nroplacaantigua, ''))) = UPPER(TRIM($1)) THEN 2
                ELSE 3
            END,
            v.fechmodi DESC NULLS LAST
        LIMIT 1
    `, [placa]);
    if (res.rows.length === 0) return null;
    return desdeFilaFarenet(res.rows[0]);
};
