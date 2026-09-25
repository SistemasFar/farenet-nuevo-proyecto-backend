const db = require('../../../config/database');
const documentoTributarioPolicy = require('./faregas-documento-tributario-policy');

const idList = (rows, key = 'id') => [...new Set(rows.map((row) => Number(row[key])).filter((id) => Number.isFinite(id)))];

const errorNegocio = (codigo, statusCode = 400, detalles = null) => {
    const error = new Error(codigo);
    error.code = codigo;
    error.codigo = codigo;
    error.status = statusCode;
    error.statusCode = statusCode;
    if (detalles) error.detalles = detalles;
    return error;
};

/**
 * Impacto y limpieza de un TIPO FÍSICO de chip (fg_producto_inventariable).
 *
 * Grafo real de FKs verificado en base de datos:
 *   -> fg_chip.producto_inventariable_id                      RESTRICT
 *   -> fg_producto_inventariable_sede.producto_inventariable_id RESTRICT
 *   -> fg_producto_facturacion.producto_chip_id              RESTRICT (columna NULL: se desvincula)
 *   -> fg_certificado.producto_chip_id                       RESTRICT (columna NULL: se desvincula)
 *   fg_chip <- fg_certificado_chip.chip_id                   RESTRICT
 *   fg_chip <- fg_chip_movimiento.chip_id                    RESTRICT
 *   fg_chip <- fg_operacion_detalle_chip.chip_id             RESTRICT
 *   fg_chip <- fg_venta_detalle.chip_id                      NO ACTION (no se destruye: bloquea)
 */
const calcularImpactoEnTransaccion = async (client, tipoId, tipoPrevio = null) => {
    const tipoResult = tipoPrevio
        ? { rows: [tipoPrevio] }
        : await client.query(`
            SELECT id, codigo, nombre, tipo, activo, control_stock, producto_facturacion_id
            FROM fg_producto_inventariable WHERE id = $1
        `, [tipoId]);
    if (tipoResult.rowCount === 0) throw errorNegocio('TIPO_CHIP_NO_ENCONTRADO', 404);
    const tipo = tipoResult.rows[0];

    const sedeResult = await client.query(`
        SELECT id, producto_inventariable_id, planta_key, precio, activo, stock_permitido,
               venta_habilitada, producto_facturacion_id
        FROM fg_producto_inventariable_sede
        WHERE producto_inventariable_id = $1
        ORDER BY id
        FOR UPDATE
    `, [tipoId]);

    const chipsResult = await client.query(`
        SELECT id, numero_chip, planta_actual_key, estado, operacion_reserva_id
        FROM fg_chip
        WHERE producto_inventariable_id = $1
        ORDER BY id
        FOR UPDATE
    `, [tipoId]);
    const chips = chipsResult.rows.map((row) => ({ ...row, id: Number(row.id) }));
    const chipIds = idList(chips);

    const movimientos = chipIds.length > 0 ? await client.query(`
        SELECT id, chip_id, tipo_movimiento, planta_origen_key, planta_destino_key,
               certificado_id, operacion_comercial_id
        FROM fg_chip_movimiento
        WHERE chip_id = ANY($1::bigint[])
        ORDER BY id
    `, [chipIds]) : { rows: [] };

    const asignacionesCertificado = chipIds.length > 0 ? await client.query(`
        SELECT certificado_id, chip_id, fecha_asociacion FROM fg_certificado_chip
        WHERE chip_id = ANY($1::bigint[]) ORDER BY certificado_id
    `, [chipIds]) : { rows: [] };

    const asignacionesOperacion = chipIds.length > 0 ? await client.query(`
        SELECT operacion_detalle_id, chip_id FROM fg_operacion_detalle_chip
        WHERE chip_id = ANY($1::bigint[]) ORDER BY operacion_detalle_id
    `, [chipIds]) : { rows: [] };

    // Las ventas son documentos reales: nunca se destruyen para limpiar un tipo.
    const ventas = chipIds.length > 0 ? await client.query(`
        SELECT id, chip_id, producto_inventariable_id FROM fg_venta_detalle
        WHERE chip_id = ANY($1::bigint[]) OR producto_inventariable_id = $2
        ORDER BY id
    `, [chipIds, tipoId]) : { rows: [] };

    const productosFiscales = await client.query(`
        SELECT id, codigo_sku, descripcion FROM fg_producto_facturacion
        WHERE producto_chip_id = $1 ORDER BY id
    `, [tipoId]);
    const certificados = await client.query(`
        SELECT id, estado, numero_certificado FROM fg_certificado
        WHERE producto_chip_id = $1 ORDER BY id
    `, [tipoId]);

    const ambiente = documentoTributarioPolicy.entornoFacturacionEfectivo();
    const limpiezaHabilitada = documentoTributarioPolicy.permiteLimpiezaDeDatosDePrueba();
    const bloqueos = [];
    if (!limpiezaHabilitada) {
        bloqueos.push({
            motivo: 'AMBIENTE_PRODUCCION',
            detalle: `El ambiente es ${ambiente}: la limpieza de tipos de chip sólo está habilitada en DEMO/desarrollo.`
        });
    }
    if (ventas.rowCount > 0) {
        bloqueos.push({
            motivo: 'CHIP_CON_VENTAS',
            detalle: `Existen ${ventas.rowCount} venta(s) que referencian este tipo. Las ventas no se destruyen.`
        });
    }

    return {
        ambiente,
        limpiezaHabilitada,
        tipo: {
            id: Number(tipo.id),
            codigo: tipo.codigo,
            nombre: tipo.nombre,
            tipo: tipo.tipo,
            activo: tipo.activo
        },
        eliminable: bloqueos.length === 0,
        bloqueos,
        requiereConfirmacion: true,
        configuracionesSede: sedeResult.rows.map((row) => ({
            ...row,
            id: Number(row.id),
            producto_inventariable_id: Number(row.producto_inventariable_id)
        })),
        chips,
        movimientos: movimientos.rows,
        asignacionesCertificado: asignacionesCertificado.rows,
        asignacionesOperacion: asignacionesOperacion.rows,
        ventas: ventas.rows,
        // Se conservan: sólo se desvinculan del tipo.
        productosFiscalesPreservados: productosFiscales.rows.map((row) => ({ ...row, id: Number(row.id) })),
        certificadosPreservados: certificados.rows.map((row) => ({ ...row, id: Number(row.id) }))
    };
};

const preview = async (tipoId) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const tipo = await client.query(`
            SELECT id, codigo, nombre, tipo, activo, control_stock, producto_facturacion_id
            FROM fg_producto_inventariable WHERE id = $1 FOR UPDATE
        `, [tipoId]);
        if (tipo.rowCount === 0) throw errorNegocio('TIPO_CHIP_NO_ENCONTRADO', 404);
        const impacto = await calcularImpactoEnTransaccion(client, tipoId, tipo.rows[0]);
        await client.query('ROLLBACK');
        return impacto;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_e) { /* conserva el error original */ }
        throw error;
    } finally {
        client.release();
    }
};

const eliminarTipoConDependencias = async (client, impacto) => {
    if (!impacto.limpiezaHabilitada) {
        throw errorNegocio('AMBIENTE_PRODUCCION', 409, { ambiente: impacto.ambiente });
    }
    if (impacto.bloqueos.length > 0) {
        throw errorNegocio('TIPO_CHIP_BLOQUEADO', 409, { bloqueos: impacto.bloqueos });
    }

    const tipoId = Number(impacto.tipo.id);
    const chipIds = idList(impacto.chips);

    // 1. Desvincular preservando certificados y productos fiscales.
    const certificadosDesvinculados = await client.query(
        'UPDATE fg_certificado SET producto_chip_id = NULL WHERE producto_chip_id = $1',
        [tipoId]
    );
    const productosDesvinculados = await client.query(
        'UPDATE fg_producto_facturacion SET producto_chip_id = NULL WHERE producto_chip_id = $1',
        [tipoId]
    );

    // 2. Hijos de chip: asignaciones y movimientos (los certificados y las
    //    operaciones se conservan; sólo se quita la relación con el chip).
    let asignacionesCertificado = { rowCount: 0 };
    let asignacionesOperacion = { rowCount: 0 };
    let movimientosEliminados = { rowCount: 0 };
    if (chipIds.length > 0) {
        asignacionesCertificado = await client.query(
            'DELETE FROM fg_certificado_chip WHERE chip_id = ANY($1::bigint[])',
            [chipIds]
        );
        asignacionesOperacion = await client.query(
            'DELETE FROM fg_operacion_detalle_chip WHERE chip_id = ANY($1::bigint[])',
            [chipIds]
        );
        movimientosEliminados = await client.query(
            'DELETE FROM fg_chip_movimiento WHERE chip_id = ANY($1::bigint[])',
            [chipIds]
        );
    }

    // 3. Seriales del tipo.
    const chipsEliminados = await client.query(
        'DELETE FROM fg_chip WHERE producto_inventariable_id = $1',
        [tipoId]
    );

    // 4. Configuración por sede y finalmente el tipo físico.
    const sedesEliminadas = await client.query(
        'DELETE FROM fg_producto_inventariable_sede WHERE producto_inventariable_id = $1',
        [tipoId]
    );
    const tipoEliminado = await client.query(
        'DELETE FROM fg_producto_inventariable WHERE id = $1',
        [tipoId]
    );
    if (tipoEliminado.rowCount !== 1) {
        throw errorNegocio('TIPO_CHIP_NO_ELIMINADO', 409);
    }

    return {
        tipoEliminado: tipoEliminado.rowCount,
        chipsEliminados: chipsEliminados.rowCount,
        movimientosEliminados: movimientosEliminados.rowCount,
        asignacionesCertificadoEliminadas: asignacionesCertificado.rowCount,
        asignacionesOperacionEliminadas: asignacionesOperacion.rowCount,
        configuracionesSedeEliminadas: sedesEliminadas.rowCount,
        certificadosDesvinculados: certificadosDesvinculados.rowCount,
        productosFiscalesDesvinculados: productosDesvinculados.rowCount
    };
};

exports.calcularImpactoEnTransaccion = calcularImpactoEnTransaccion;
exports.eliminarTipoConDependencias = eliminarTipoConDependencias;
exports.preview = preview;
