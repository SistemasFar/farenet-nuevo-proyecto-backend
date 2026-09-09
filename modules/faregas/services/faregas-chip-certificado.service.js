const { normalizarNumeroChip, esNumeroChipCertificadoValido } = require('./faregas-chips.rules');

const ESTADOS_OPERACION_RESERVABLES = new Set(['PENDIENTE_PAGO', 'PAGADO']);

const obtenerAsociaciones = async (client, certificadoId) => {
    const result = await client.query(`
        SELECT c.id, c.numero_chip, c.estado, c.planta_actual_key,
               c.operacion_reserva_id
        FROM fg_certificado_chip cc
        JOIN fg_chip c ON c.id = cc.chip_id
        WHERE cc.certificado_id = $1
        ORDER BY c.id
        FOR UPDATE OF c
    `, [certificadoId]);
    return result.rows;
};

const obtenerOperacion = async (client, certificadoId, plantaKey) => {
    const result = await client.query(`
        SELECT oc.id, oc.planta_key, oc.estado
        FROM fg_orden_pago op
        JOIN fg_operacion_comercial oc ON oc.id = op.operacion_id
        WHERE op.certificado_id = $1
        FOR UPDATE OF oc
    `, [certificadoId]);
    if (!result.rowCount) throw new Error('OPERACION_CHIP_FALTANTE');

    const operacion = result.rows[0];
    if (operacion.planta_key !== plantaKey) throw new Error('OPERACION_CHIP_SEDE_INVALIDA');
    if (!ESTADOS_OPERACION_RESERVABLES.has(operacion.estado)) {
        throw new Error('OPERACION_CHIP_NO_RESERVABLE');
    }
    return operacion;
};

const validarStockHabilitado = async (client, plantaKey) => {
    const result = await client.query(`
        SELECT pis.stock_permitido
        FROM fg_producto_inventariable pi
        JOIN fg_producto_inventariable_sede pis
          ON pis.producto_inventariable_id = pi.id
        JOIN fg_planta p ON p.key = pis.planta_key AND p.activo = TRUE
        WHERE pi.codigo = 'CHIP' AND pi.activo = TRUE
          AND pis.planta_key = $1 AND pis.activo = TRUE
        FOR UPDATE OF pis
    `, [plantaKey]);
    if (!result.rowCount) throw new Error('CHIP_NO_CONFIGURADO_SEDE');
    if (result.rows[0].stock_permitido !== true) throw new Error('STOCK_CHIP_NO_PERMITIDO');
};

const liberar = async (client, chip, certificadoId, username, referencia) => {
    if (chip.estado === 'VENDIDO') throw new Error('CHIP_YA_VENDIDO');
    if (chip.estado !== 'RESERVADO' || !chip.operacion_reserva_id) {
        throw new Error('RESERVA_CHIP_INCONSISTENTE');
    }

    await client.query(
        'DELETE FROM fg_certificado_chip WHERE certificado_id = $1 AND chip_id = $2',
        [certificadoId, chip.id]
    );
    await client.query(`
        UPDATE fg_chip
        SET estado = 'DISPONIBLE', operacion_reserva_id = NULL, reservado_en = NULL,
            actualizado_por = $2, actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $1
    `, [chip.id, username]);
    await client.query(`
        INSERT INTO fg_chip_movimiento (
            chip_id, tipo_movimiento, planta_origen_key, usuario,
            certificado_id, operacion_comercial_id, referencia
        ) VALUES ($1, 'LIBERACION', $2, $3, $4, $5, $6)
    `, [
        chip.id,
        chip.planta_actual_key,
        username,
        certificadoId,
        chip.operacion_reserva_id,
        referencia
    ]);
};

/**
 * Sincroniza la relación certificado-chip dentro de la transacción del guardado GNV.
 * No vende ni factura: únicamente reserva/libera stock y deja trazabilidad.
 */
exports.sincronizarReserva = async (client, {
    certificadoId,
    plantaKey,
    modalidad,
    numeroChip,
    username
}) => {
    const asociaciones = await obtenerAsociaciones(client, certificadoId);
    if (asociaciones.length > 1) throw new Error('CERTIFICADO_CON_MULTIPLES_CHIPS');

    const actual = asociaciones[0] || null;
    const esInicial = String(modalidad || '').trim().toUpperCase() === 'INICIAL';
    const numero = esInicial ? normalizarNumeroChip(numeroChip) : '';

    if (numero && !esNumeroChipCertificadoValido(numero)) {
        throw new Error('NUMERO_CHIP_INVALIDO');
    }

    if (!numero) {
        if (actual) {
            await liberar(client, actual, certificadoId, username, 'Cambio de modalidad o eliminación del N° de chip');
        }
        return null;
    }

    await validarStockHabilitado(client, plantaKey);
    const operacion = await obtenerOperacion(client, certificadoId, plantaKey);
    if (actual && actual.numero_chip === numero) {
        if (
            actual.estado !== 'RESERVADO'
            || Number(actual.operacion_reserva_id) !== Number(operacion.id)
            || actual.planta_actual_key !== plantaKey
        ) {
            throw new Error('RESERVA_CHIP_INCONSISTENTE');
        }
        return { id: actual.id, numeroChip: actual.numero_chip, estado: actual.estado };
    }

    const chipResult = await client.query(`
        SELECT id, numero_chip, estado, planta_actual_key, operacion_reserva_id
        FROM fg_chip
        WHERE numero_chip = $1
        FOR UPDATE
    `, [numero]);
    if (!chipResult.rowCount) throw new Error('CHIP_NO_ENCONTRADO');

    const chip = chipResult.rows[0];
    if (chip.planta_actual_key !== plantaKey) throw new Error('CHIP_OTRA_SEDE');
    if (chip.estado !== 'DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');

    if (actual) {
        await liberar(client, actual, certificadoId, username, 'Reemplazo del N° de chip');
    }

    await client.query(
        'INSERT INTO fg_certificado_chip (certificado_id, chip_id) VALUES ($1, $2)',
        [certificadoId, chip.id]
    );
    await client.query(`
        UPDATE fg_chip
        SET estado = 'RESERVADO', operacion_reserva_id = $2,
            reservado_en = CURRENT_TIMESTAMP, actualizado_por = $3,
            actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $1
    `, [chip.id, operacion.id, username]);
    await client.query(`
        INSERT INTO fg_chip_movimiento (
            chip_id, tipo_movimiento, planta_origen_key, usuario,
            certificado_id, operacion_comercial_id
        ) VALUES ($1, 'RESERVA', $2, $3, $4, $5)
    `, [chip.id, plantaKey, username, certificadoId, operacion.id]);

    return { id: chip.id, numeroChip: chip.numero_chip, estado: 'RESERVADO' };
};
