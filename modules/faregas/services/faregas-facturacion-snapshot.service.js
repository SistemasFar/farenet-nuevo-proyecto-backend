const fechaPeruIso = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
};

/**
 * Congela únicamente datos de maestros que sí podrían cambiar después.
 * Vehículo, cliente, precios e ítems ya tienen snapshots propios y no se
 * duplican aquí.
 */
const capturarSnapshotFacturacion = async ({
    queryable,
    facturacionId,
    certificadoId,
    fechaDocumento = null
}) => {
    const result = await queryable.query(`
        UPDATE fg_facturacion f
        SET fecha_documento = COALESCE(f.fecha_documento, $3::date),
            sede_nombre_snapshot = COALESCE(f.sede_nombre_snapshot, p.nombre),
            sede_direccion_snapshot = COALESCE(f.sede_direccion_snapshot, p.direccion),
            sede_telefono_snapshot = COALESCE(f.sede_telefono_snapshot, p.telefono),
            sede_correo_snapshot = COALESCE(f.sede_correo_snapshot, p.correo),
            codigo_descuento_snapshot = COALESCE(
                f.codigo_descuento_snapshot,
                (
                    SELECT dc.codigo
                    FROM fg_descuentocomprobante cmp
                    JOIN fg_descuentocliente dc ON dc.id = cmp.descuento_cliente_id
                    WHERE cmp.certificado_id = c.id
                      AND cmp.estado = 'APLICADO'
                    ORDER BY cmp.id DESC
                    LIMIT 1
                )
            )
        FROM fg_certificado c
        JOIN fg_planta p ON p.key = c.planta_key
        WHERE f.id = $1
          AND c.id = $2
          AND f.certificado_id = c.id
        RETURNING f.*
    `, [facturacionId, certificadoId, fechaDocumento]);

    if (result.rowCount === 0) {
        const error = new Error('FACTURACION_SNAPSHOT_NO_GENERADO');
        error.code = 'FACTURACION_SNAPSHOT_NO_GENERADO';
        throw error;
    }
    return result.rows[0];
};

module.exports = {
    capturarSnapshotFacturacion,
    fechaPeruIso
};
