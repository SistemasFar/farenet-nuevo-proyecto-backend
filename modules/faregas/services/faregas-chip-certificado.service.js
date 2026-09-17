const { normalizarNumeroChip, esNumeroChipCertificadoValido } = require('./faregas-chips.rules');

const obtenerCertificado = async (client, certificadoId, bloquear = false) => {
    const result = await client.query(`
        SELECT id, estado, planta_key, producto_chip_id
        FROM fg_certificado
        WHERE id = $1${bloquear ? ' FOR UPDATE' : ''}
    `, [certificadoId]);
    if (!result.rowCount) throw new Error('CERTIFICADO_NOT_FOUND');
    return result.rows[0];
};

const obtenerAsociacion = async (client, certificadoId, bloquear = false) => {
    const result = await client.query(`
        SELECT c.id, c.numero_chip, c.estado, c.planta_actual_key,
               c.producto_inventariable_id, pi.codigo AS producto_codigo,
               pi.nombre AS producto_nombre
        FROM fg_certificado_chip cc
        JOIN fg_chip c ON c.id = cc.chip_id
        JOIN fg_producto_inventariable pi ON pi.id = c.producto_inventariable_id
        WHERE cc.certificado_id = $1
        ORDER BY c.id
        ${bloquear ? 'FOR UPDATE OF c' : ''}
    `, [certificadoId]);
    if (result.rowCount > 1) throw new Error('CERTIFICADO_CON_MULTIPLES_CHIPS');
    return result.rows[0] || null;
};

const respuesta = (certificado, chip) => ({
    requiereChip: Boolean(certificado.producto_chip_id),
    productoChipId: certificado.producto_chip_id ? Number(certificado.producto_chip_id) : null,
    seleccionado: Boolean(chip),
    chip: chip ? {
        id: Number(chip.id),
        numeroChip: chip.numero_chip,
        estado: chip.estado,
        plantaKey: chip.planta_actual_key,
        productoInventariableId: Number(chip.producto_inventariable_id),
        productoCodigo: chip.producto_codigo,
        productoNombre: chip.producto_nombre
    } : null
});

const seleccionarDentroTransaccion = async (client, certificado, numeroChip) => {
    if (!certificado.producto_chip_id) throw new Error('CERTIFICADO_NO_REQUIERE_CHIP');
    if (certificado.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

    const numero = normalizarNumeroChip(numeroChip);
    if (!esNumeroChipCertificadoValido(numero)) throw new Error('NUMERO_CHIP_INVALIDO');

    const actual = await obtenerAsociacion(client, certificado.id, true);
    if (actual && actual.numero_chip === numero) {
        if (Number(actual.producto_inventariable_id) !== Number(certificado.producto_chip_id)) throw new Error('CHIP_TIPO_INVALIDO');
        if (actual.planta_actual_key !== certificado.planta_key) throw new Error('CHIP_OTRA_SEDE');
        if (!['DISPONIBLE', 'VENDIDO'].includes(actual.estado)) throw new Error('CHIP_NO_DISPONIBLE');
        return actual;
    }
    if (actual?.estado === 'VENDIDO') throw new Error('CHIP_YA_CONSUMIDO');

    const chipResult = await client.query(`
        SELECT c.id, c.numero_chip, c.estado, c.planta_actual_key,
               c.producto_inventariable_id, pi.codigo AS producto_codigo,
               pi.nombre AS producto_nombre
        FROM fg_chip c
        JOIN fg_producto_inventariable pi ON pi.id = c.producto_inventariable_id
        WHERE c.numero_chip = $1
        FOR UPDATE OF c
    `, [numero]);
    if (!chipResult.rowCount) throw new Error('CHIP_NO_ENCONTRADO');
    const chip = chipResult.rows[0];
    if (Number(chip.producto_inventariable_id) !== Number(certificado.producto_chip_id)) throw new Error('CHIP_TIPO_INVALIDO');
    if (chip.planta_actual_key !== certificado.planta_key) throw new Error('CHIP_OTRA_SEDE');
    if (chip.estado !== 'DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');

    const usada = await client.query(
        'SELECT certificado_id FROM fg_certificado_chip WHERE chip_id = $1 AND certificado_id <> $2',
        [chip.id, certificado.id]
    );
    if (usada.rowCount) throw new Error('CHIP_ASIGNADO_OTRO_CERTIFICADO');

    await client.query('DELETE FROM fg_certificado_chip WHERE certificado_id = $1', [certificado.id]);
    await client.query(
        'INSERT INTO fg_certificado_chip (certificado_id, chip_id) VALUES ($1, $2)',
        [certificado.id, chip.id]
    );
    return chip;
};

exports.obtener = async (client, certificadoId) => {
    const certificado = await obtenerCertificado(client, certificadoId, false);
    const chip = await obtenerAsociacion(client, certificadoId, false);
    return respuesta(certificado, chip);
};

exports.seleccionar = async (client, { certificadoId, numeroChip }) => {
    const certificado = await obtenerCertificado(client, certificadoId, true);
    const chip = await seleccionarDentroTransaccion(client, certificado, numeroChip);
    return respuesta(certificado, chip);
};

exports.validarParaFacturacion = async (client, certificadoId) => {
    const certificado = await obtenerCertificado(client, certificadoId, false);
    if (!certificado.producto_chip_id) return respuesta(certificado, null);
    const chip = await obtenerAsociacion(client, certificadoId, false);
    if (!chip) throw new Error('CHIP_REQUERIDO_NO_SELECCIONADO');
    if (Number(chip.producto_inventariable_id) !== Number(certificado.producto_chip_id)) throw new Error('CHIP_TIPO_INVALIDO');
    if (chip.planta_actual_key !== certificado.planta_key) throw new Error('CHIP_OTRA_SEDE');
    if (!['DISPONIBLE', 'RESERVADO', 'VENDIDO'].includes(chip.estado)) throw new Error('CHIP_NO_DISPONIBLE');
    return respuesta(certificado, chip);
};

// Compatibilidad con el guardado GNV existente. Ya no reserva stock: solo
// vincula el serial al borrador cuando el producto fiscal exige un chip.
exports.sincronizarReserva = async (client, { certificadoId, numeroChip }) => {
    const certificado = await obtenerCertificado(client, certificadoId, true);
    if (!certificado.producto_chip_id) return null;
    if (!numeroChip) throw new Error('CHIP_REQUERIDO_NO_SELECCIONADO');
    const chip = await seleccionarDentroTransaccion(client, certificado, numeroChip);
    return respuesta(certificado, chip);
};

exports.reservarFisicamente = async (client, { certificadoId, username }) => {
    const certificado = await obtenerCertificado(client, certificadoId, true);
    if (!certificado.producto_chip_id) return null;

    const chip = await obtenerAsociacion(client, certificadoId, true);
    if (!chip) throw new Error('CHIP_REQUERIDO_NO_SELECCIONADO');
    if (Number(chip.producto_inventariable_id) !== Number(certificado.producto_chip_id)) throw new Error('CHIP_TIPO_INVALIDO');
    if (chip.planta_actual_key !== certificado.planta_key) throw new Error('CHIP_OTRA_SEDE');

    if (chip.estado === 'RESERVADO') return respuesta(certificado, chip); // Idempotent
    if (chip.estado !== 'DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');

    const actualizado = await client.query(`
        UPDATE fg_chip
        SET estado = 'RESERVADO', operacion_reserva_id = NULL, reservado_en = CURRENT_TIMESTAMP,
            actualizado_por = $3, actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $1 AND producto_inventariable_id = $2 AND estado = 'DISPONIBLE'
        RETURNING id
    `, [chip.id, certificado.producto_chip_id, username]);
    
    if (actualizado.rowCount !== 1) throw new Error('CHIP_NO_DISPONIBLE');

    await client.query(`
        INSERT INTO fg_chip_movimiento (
            chip_id, tipo_movimiento, planta_origen_key, usuario,
            certificado_id, operacion_comercial_id, referencia, detalles
        ) VALUES ($1, 'RESERVA', $2, $3, $4, NULL, 'FACTURACION', $5)
    `, [chip.id, certificado.planta_key, username, certificado.id, JSON.stringify({ nota: 'Reserva automática al ingresar a Facturación de certificado' })]);

    chip.estado = 'RESERVADO';
    return respuesta(certificado, chip);
};

exports.consumirEnFacturacion = async (client, { certificadoId, operacionId, username }) => {
    const certificado = await obtenerCertificado(client, certificadoId, true);
    if (!certificado.producto_chip_id) return null;

    const chip = await obtenerAsociacion(client, certificadoId, true);
    if (!chip) throw new Error('CHIP_REQUERIDO_NO_SELECCIONADO');
    if (Number(chip.producto_inventariable_id) !== Number(certificado.producto_chip_id)) throw new Error('CHIP_TIPO_INVALIDO');
    if (chip.planta_actual_key !== certificado.planta_key) throw new Error('CHIP_OTRA_SEDE');

    if (chip.estado === 'VENDIDO') {
        const movimiento = await client.query(`
            SELECT 1 FROM fg_chip_movimiento
            WHERE chip_id = $1 AND certificado_id = $2 AND tipo_movimiento = 'VENTA'
        `, [chip.id, certificadoId]);
        if (!movimiento.rowCount) throw new Error('CHIP_VENDIDO_SIN_TRAZABILIDAD');
        return respuesta(certificado, chip);
    }
    if (chip.estado !== 'DISPONIBLE' && chip.estado !== 'RESERVADO') throw new Error('CHIP_NO_DISPONIBLE');

    const actualizado = await client.query(`
        UPDATE fg_chip
        SET estado = 'VENDIDO', operacion_reserva_id = NULL, reservado_en = NULL,
            actualizado_por = $3, actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $1 AND producto_inventariable_id = $2 AND estado IN ('DISPONIBLE', 'RESERVADO')
        RETURNING id
    `, [chip.id, certificado.producto_chip_id, username]);
    if (actualizado.rowCount !== 1) throw new Error('CHIP_NO_DISPONIBLE');

    await client.query(`
        INSERT INTO fg_chip_movimiento (
            chip_id, tipo_movimiento, planta_origen_key, usuario,
            certificado_id, operacion_comercial_id, referencia, detalles
        ) VALUES ($1, 'VENTA', $2, $3, $4, $5, $6, $7::jsonb)
    `, [
        chip.id,
        certificado.planta_key,
        username,
        certificadoId,
        operacionId || null,
        `Consumo por facturación del certificado ${certificadoId}`,
        JSON.stringify({ origen: 'FACTURACION_CERTIFICADO' })
    ]);
    return respuesta(certificado, { ...chip, estado: 'VENDIDO' });
};

exports._private = { obtenerCertificado, obtenerAsociacion, seleccionarDentroTransaccion };
