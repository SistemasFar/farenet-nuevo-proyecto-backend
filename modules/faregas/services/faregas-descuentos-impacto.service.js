const db = require('../../../config/database');
const documentoTributarioPolicy = require('./faregas-documento-tributario-policy');

const idList = (rows, key = 'id') => [...new Set(rows.map((row) => Number(row[key])).filter((id) => Number.isFinite(id)))];

// Los errores se emiten con las dos convenciones que consumen los controllers
// del módulo (code/statusCode) y las de los controllers de configuración.
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
 * Impacto y limpieza de una CAMPAÑA / CONVENIO / DESCUENTO (fg_descuento).
 *
 * Grafo real de FKs verificado en base de datos:
 *   fg_descuento <- fg_descuentocliente.descuento_id          CASCADE
 *   fg_descuento <- fg_descuentodetalle.descuento_id          CASCADE
 *   fg_descuentocliente <- fg_descuentodetalle.descuento_cliente_id       CASCADE
 *   fg_descuentocliente <- fg_descuentocomprobante.descuento_cliente_id  RESTRICT
 *
 * Se eliminan sólo las filas propias del descuento. Los SERVICIOS, las SEDES,
 * las EMPRESAS, los CERTIFICADOS, las FACTURACIONES, las ÓRDENES DE PAGO y las
 * OPERACIONES se conservan: sólo desaparece la relación con la campaña.
 */
const calcularImpactoEnTransaccion = async (client, descuentoId, descuentoPrevio = null) => {
    const descuentoResult = descuentoPrevio
        ? { rows: [descuentoPrevio] }
        : await client.query(`
            SELECT id, codigo, nombre, tipo, activo, planta_key, empresa_aliada_ruc,
                   empresa_aliada_nombre, tipo_calculo, valor, fecha_inicio, fecha_fin
            FROM fg_descuento WHERE id = $1
        `, [descuentoId]);
    if (descuentoResult.rowCount === 0) throw errorNegocio('DESCUENTO_NO_ENCONTRADO', 404);
    const descuento = descuentoResult.rows[0];

    const codigosResult = await client.query(`
        SELECT id, descuento_id, codigo, max_usos, usos_realizados, activo, planta_key
        FROM fg_descuentocliente
        WHERE descuento_id = $1
        ORDER BY id
        FOR UPDATE
    `, [descuentoId]);
    const codigos = codigosResult.rows.map((row) => ({ ...row, id: Number(row.id) }));
    const codigoIds = idList(codigos);

    const configuracionesResult = await client.query(`
        SELECT d.id, d.descuento_id, d.descuento_cliente_id, d.servicio_id, d.planta_key,
               d.tipo_calculo, d.valor, d.precio_minimo, d.valor_contado, d.valor_credito,
               d.activo, s.codigo AS servicio_codigo, s.nombre AS servicio_nombre
        FROM fg_descuentodetalle d
        LEFT JOIN fg_servicio s ON s.id = d.servicio_id
        WHERE d.descuento_id = $1
           OR (d.descuento_cliente_id IS NOT NULL AND d.descuento_cliente_id = ANY($2::bigint[]))
        ORDER BY d.id
        FOR UPDATE OF d
    `, [descuentoId, codigoIds]);
    const configuraciones = configuracionesResult.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        servicio_id: row.servicio_id === null ? null : Number(row.servicio_id)
    }));

    const usosResult = codigoIds.length > 0 ? await client.query(`
        SELECT u.id, u.descuento_cliente_id, u.certificado_id, u.facturacion_id,
               u.orden_pago_id, u.importe_original, u.importe_descuento, u.importe_final,
               u.estado, c.codigo AS codigo_campana
        FROM fg_descuentocomprobante u
        LEFT JOIN fg_descuentocliente c ON c.id = u.descuento_cliente_id
        WHERE u.descuento_cliente_id = ANY($1::bigint[])
        ORDER BY u.id
    `, [codigoIds]) : { rows: [] };

    const serviciosPreservados = await client.query(`
        SELECT DISTINCT s.id, s.codigo, s.nombre
        FROM fg_descuentodetalle d
        JOIN fg_servicio s ON s.id = d.servicio_id
        WHERE d.descuento_id = $1
        ORDER BY s.id
    `, [descuentoId]);

    const ambiente = documentoTributarioPolicy.entornoFacturacionEfectivo();
    const limpiezaHabilitada = documentoTributarioPolicy.permiteLimpiezaDeDatosDePrueba();
    const bloqueos = [];
    if (!limpiezaHabilitada) {
        bloqueos.push({
            motivo: 'AMBIENTE_PRODUCCION',
            detalle: `El ambiente es ${ambiente}: la limpieza de campañas sólo está habilitada en DEMO/desarrollo.`
        });
    }

    return {
        ambiente,
        limpiezaHabilitada,
        eliminable: bloqueos.length === 0,
        bloqueos,
        requiereConfirmacion: true,
        descuento: {
            id: Number(descuento.id),
            codigo: descuento.codigo,
            nombre: descuento.nombre,
            tipo: descuento.tipo,
            activo: descuento.activo,
            planta_key: descuento.planta_key,
            empresa_aliada_ruc: descuento.empresa_aliada_ruc,
            empresa_aliada_nombre: descuento.empresa_aliada_nombre
        },
        codigos,
        configuraciones,
        usos: usosResult.rows.map((row) => ({ ...row, id: Number(row.id) })),
        // Se conservan: sólo se elimina la relación con la campaña.
        serviciosPreservados: serviciosPreservados.rows.map((row) => ({ ...row, id: Number(row.id) })),
        certificadosPreservados: [...new Set(usosResult.rows
            .map((row) => row.certificado_id)
            .filter((value) => value !== null && value !== undefined))]
    };
};

const preview = async (descuentoId) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const descuento = await client.query(`
            SELECT id, codigo, nombre, tipo, activo, planta_key, empresa_aliada_ruc,
                   empresa_aliada_nombre, tipo_calculo, valor, fecha_inicio, fecha_fin
            FROM fg_descuento WHERE id = $1 FOR UPDATE
        `, [descuentoId]);
        if (descuento.rowCount === 0) throw errorNegocio('DESCUENTO_NO_ENCONTRADO', 404);
        const impacto = await calcularImpactoEnTransaccion(client, descuentoId, descuento.rows[0]);
        await client.query('ROLLBACK');
        return impacto;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_e) { /* conserva el error original */ }
        throw error;
    } finally {
        client.release();
    }
};

const eliminarDescuentoConDependencias = async (client, impacto) => {
    if (!impacto.limpiezaHabilitada) {
        throw errorNegocio('AMBIENTE_PRODUCCION', 409, { ambiente: impacto.ambiente });
    }
    if (impacto.bloqueos.length > 0) {
        throw errorNegocio('DESCUENTO_BLOQUEADO', 409, { bloqueos: impacto.bloqueos });
    }

    const descuentoId = Number(impacto.descuento.id);
    const codigoIds = idList(impacto.codigos);

    // 1. Usos de prueba: se borra sólo el registro del descuento. Los
    //    certificados, facturaciones, órdenes y operaciones se conservan.
    let usosEliminados = { rowCount: 0 };
    if (codigoIds.length > 0) {
        usosEliminados = await client.query(
            'DELETE FROM fg_descuentocomprobante WHERE descuento_cliente_id = ANY($1::bigint[])',
            [codigoIds]
        );
    }

    // 2. Configuración de servicios y alcances: se borra la relación, el
    //    servicio del catálogo permanece intacto.
    const configuracionesEliminadas = await client.query(`
        DELETE FROM fg_descuentodetalle
        WHERE descuento_id = $1
           OR (descuento_cliente_id IS NOT NULL AND descuento_cliente_id = ANY($2::bigint[]))
    `, [descuentoId, codigoIds]);

    // 3. Códigos propios de la campaña.
    const codigosEliminados = await client.query(
        'DELETE FROM fg_descuentocliente WHERE descuento_id = $1',
        [descuentoId]
    );

    // 4. Finalmente la campaña / descuento.
    const descuentoEliminado = await client.query(
        'DELETE FROM fg_descuento WHERE id = $1',
        [descuentoId]
    );
    if (descuentoEliminado.rowCount !== 1) {
        throw errorNegocio('DESCUENTO_NO_ELIMINADO', 409);
    }

    return {
        descuentoEliminado: descuentoEliminado.rowCount,
        codigosEliminados: codigosEliminados.rowCount,
        configuracionesEliminadas: configuracionesEliminadas.rowCount,
        usosEliminados: usosEliminados.rowCount,
        serviciosPreservados: impacto.serviciosPreservados.length
    };
};

exports.calcularImpactoEnTransaccion = calcularImpactoEnTransaccion;
exports.eliminarDescuentoConDependencias = eliminarDescuentoConDependencias;
exports.preview = preview;
