const fs = require('fs');
const p = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetBackend/modules/faregas/services/faregas-chip-certificado.service.js';
let t = fs.readFileSync(p, 'utf8');

const newMethod = `exports.reservarFisicamente = async (client, { certificadoId, username }) => {
    const certificado = await obtenerCertificado(client, certificadoId, true);
    if (!certificado.producto_chip_id) return null;

    const chip = await obtenerAsociacion(client, certificadoId, true);
    if (!chip) throw new Error('CHIP_REQUERIDO_NO_SELECCIONADO');
    if (Number(chip.producto_inventariable_id) !== Number(certificado.producto_chip_id)) throw new Error('CHIP_TIPO_INVALIDO');
    if (chip.planta_actual_key !== certificado.planta_key) throw new Error('CHIP_OTRA_SEDE');

    if (chip.estado === 'RESERVADO') return respuesta(certificado, chip); // Idempotent
    if (chip.estado !== 'DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');

    const actualizado = await client.query(\`
        UPDATE fg_chip
        SET estado = 'RESERVADO', operacion_reserva_id = NULL, reservado_en = CURRENT_TIMESTAMP,
            actualizado_por = $3, actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $1 AND producto_inventariable_id = $2 AND estado = 'DISPONIBLE'
        RETURNING id
    \`, [chip.id, certificado.producto_chip_id, username]);
    
    if (actualizado.rowCount !== 1) throw new Error('CHIP_NO_DISPONIBLE');

    await client.query(\`
        INSERT INTO fg_chip_movimiento (
            chip_id, tipo_movimiento, planta_origen_key, usuario,
            certificado_id, operacion_comercial_id, referencia, detalles
        ) VALUES ($1, 'RESERVA', $2, $3, $4, NULL, 'FACTURACION', 'Reserva automática al ingresar a Facturación de certificado')
    \`, [chip.id, certificado.planta_key, username, certificado.id]);

    chip.estado = 'RESERVADO';
    return respuesta(certificado, chip);
};

exports.consumirEnFacturacion = async (client, { certificadoId, operacionId, username }) => {`;

t = t.replace('exports.consumirEnFacturacion = async (client, { certificadoId, operacionId, username }) => {', newMethod);
fs.writeFileSync(p, t);
console.log('faregas-chip-certificado.service.js modified successfully');
