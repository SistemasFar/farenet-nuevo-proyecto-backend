const db = require('../../../config/database');

exports.obtenerTarifasPorPlanta = async (plantaKey) => {
    const query = `
        SELECT
            codigo,
            familia,
            nombre,
            tipo_certificado_clave,
            modalidad,
            precio,
            orden
        FROM fg_tarifa
        WHERE planta_key = $1
          AND activo = true
        ORDER BY familia, orden, nombre;
    `;
    const result = await db.query(query, [plantaKey]);
    
    // Convertir el precio a número para que el frontend lo reciba correctamente
    const tarifas = result.rows.map(row => ({
        ...row,
        precio: Number(row.precio)
    }));

    return tarifas;
};
