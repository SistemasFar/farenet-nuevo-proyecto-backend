const db = require('../../../config/database');
const faregasAuthService = require('./faregas-auth.service');
const tarifasService = require('./faregas-tarifas.service');

const errorNegocio = (codigo, statusCode = 400, detalles) => {
    const error = new Error(codigo);
    error.code = codigo;
    error.statusCode = statusCode;
    if (detalles) error.detalles = detalles;
    return error;
};

// ----------------------------------------------------------------------
// VALIDACIONES Y CONSULTA
// ----------------------------------------------------------------------

const obtenerCertificado = async (client, certificadoId, userContext) => {
    const result = await client.query(
        `SELECT id, estado, planta_key, tipo_certificado_clave, tarifa_codigo 
         FROM fg_certificado WHERE id = $1`,
        [certificadoId]
    );
    if (result.rowCount === 0) throw errorNegocio('CERTIFICADO_NOT_FOUND', 404);
    const certificado = result.rows[0];
    
    const acceso = await faregasAuthService.validarAccesoPlanta(
        userContext.username,
        userContext.perfil_id,
        certificado.planta_key
    );
    if (!acceso) throw errorNegocio('PLANTA_NO_AUTORIZADA', 403);
    
    if (certificado.estado !== 'BORRADOR') {
        throw errorNegocio('CERTIFICADO_NO_EDITABLE', 409);
    }
    
    const vehiculoResult = await client.query(
        `SELECT placa FROM fg_certificado_vehiculo WHERE certificado_id = $1`,
        [certificadoId]
    );
    certificado.placa = vehiculoResult.rowCount > 0 ? vehiculoResult.rows[0].placa : null;

    return certificado;
};

const consultarDescuentoCore = async (client, codigo, certificadoId, userContext, isReserva = false) => {
    const certificado = await obtenerCertificado(client, certificadoId, userContext);
    
    // 1. Obtener tarifa original
    if (!certificado.tarifa_codigo) {
        throw errorNegocio('CERTIFICADO_SIN_TARIFA', 409);
    }
    
    const tarifaOp = await tarifasService.obtenerTarifaOperativaPorCodigo(
        certificado.planta_key,
        certificado.tarifa_codigo,
        client
    );
    const tarifaValida = tarifasService.validarTarifaCertificacion(tarifaOp);
    const tarifaOriginal = Number(tarifaValida.precio);

    const servicioId = tarifaValida.servicio_id;

    // 2. Buscar código y bloquear si es reserva
    const sql = `
        SELECT 
            dc.id AS descuentocliente_id, dc.codigo, dc.placa,
            dc.fecha_inicio AS dc_inicio, dc.fecha_fin AS dc_fin, dc.max_usos, dc.usos_realizados, dc.activo AS dc_activo,
            d.id AS descuento_id, d.nombre, d.tipo, d.empresa_aliada_nombre, d.tipo_calculo AS d_tipo_calculo, d.valor AS d_valor,
            d.fecha_inicio AS d_inicio, d.fecha_fin AS d_fin, d.planta_key, d.activo AS d_activo
        FROM fg_descuentocliente dc
        JOIN fg_descuento d ON d.id = dc.descuento_id
        WHERE UPPER(dc.codigo) = UPPER($1)
        ${isReserva ? 'FOR UPDATE OF dc' : ''}
    `;
    const resCli = await client.query(sql, [codigo]);
    
    if (resCli.rowCount === 0) throw errorNegocio('CODIGO_NOT_FOUND', 404);
    const ds = resCli.rows[0];

    // 3. Validaciones
    if (!ds.dc_activo) throw errorNegocio('CODIGO_INACTIVO', 409);
    if (!ds.d_activo) throw errorNegocio('DESCUENTO_INACTIVO', 409);
    
    const ahora = new Date();
    if (ahora < new Date(ds.d_inicio) || ahora > new Date(ds.d_fin)) {
        throw errorNegocio('DESCUENTO_VENCIDO', 422);
    }
    if (ds.dc_inicio && ds.dc_fin) {
        if (ahora < new Date(ds.dc_inicio) || ahora > new Date(ds.dc_fin)) {
            throw errorNegocio('CODIGO_VENCIDO', 422);
        }
    }

    if (ds.planta_key && ds.planta_key !== certificado.planta_key) {
        throw errorNegocio('DESCUENTO_NO_APLICA_SEDE', 422);
    }

    const placaNormalizada = (value) => String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (ds.tipo === 'PLACA') {
        if (!ds.placa) throw errorNegocio('PLACA_DESCUENTO_REQUERIDA', 409);
        if (placaNormalizada(ds.placa) !== placaNormalizada(certificado.placa)) {
            throw errorNegocio('DESCUENTO_NO_APLICA_PLACA', 422);
        }
    }

    const reservasResult = await client.query(`
        SELECT
            COUNT(*) FILTER (WHERE cmp.estado = 'RESERVADO' AND cmp.reservado_hasta >= CURRENT_TIMESTAMP) AS reservados,
            BOOL_OR(cmp.certificado_id = $2 AND cmp.estado IN ('RESERVADO', 'APLICADO')) AS pertenece_certificado
        FROM fg_descuentocomprobante cmp
        WHERE cmp.descuento_cliente_id = $1
          AND cmp.estado IN ('RESERVADO', 'APLICADO')
    `, [ds.descuentocliente_id, certificadoId]);
    const reservados = Number(reservasResult.rows[0].reservados || 0);
    const perteneceCertificado = Boolean(reservasResult.rows[0].pertenece_certificado);
    const usosDisponibles = Number(ds.max_usos) - Number(ds.usos_realizados) - reservados;
    if (usosDisponibles <= 0 && !perteneceCertificado) {
        throw errorNegocio('CODIGO_AGOTADO', 409);
    }

    // 4. Validar servicio permitido
    const sqlDet = `
        SELECT tipo_calculo, valor, precio_minimo, activo 
        FROM fg_descuentodetalle 
        WHERE descuento_id = $1 AND servicio_id = $2
    `;
    const resDet = await client.query(sqlDet, [ds.descuento_id, servicioId]);
    if (resDet.rowCount === 0 || !resDet.rows[0].activo) {
        throw errorNegocio('DESCUENTO_NO_APLICA_SERVICIO', 422);
    }
    
    const det = resDet.rows[0];
    
    // 5. Calcular importe
    const tipoCalculoFinal = det.tipo_calculo || ds.d_tipo_calculo;
    const valorFinal = Number(det.valor || ds.d_valor);
    
    let importeDescuento = 0;
    if (tipoCalculoFinal === 'MONTO') {
        importeDescuento = valorFinal;
    } else {
        importeDescuento = (tarifaOriginal * valorFinal) / 100;
    }

    // Redondear a 2 decimales
    importeDescuento = Math.round(importeDescuento * 100) / 100;
    
    if (det.precio_minimo && (tarifaOriginal - importeDescuento) < Number(det.precio_minimo)) {
        // Si el precio mínimo no se cumple, ajustar el descuento para que cuadre exacto con el precio minimo
        importeDescuento = tarifaOriginal - Number(det.precio_minimo);
    }

    if (importeDescuento <= 0 || importeDescuento > tarifaOriginal) {
        throw errorNegocio('IMPORTE_DESCUENTO_INVALIDO', 409);
    }

    const importeFinal = tarifaOriginal - importeDescuento;

    // 6. Validar que no haya otra reserva de OTRO codigo en el mismo certificado
    const sqlRes = `
        SELECT dc.codigo FROM fg_descuentocomprobante cmp
        JOIN fg_descuentocliente dc ON dc.id = cmp.descuento_cliente_id
        WHERE cmp.certificado_id = $1 AND cmp.estado IN ('RESERVADO', 'APLICADO')
        AND dc.codigo != $2
    `;
    const resReservaActiva = await client.query(sqlRes, [certificadoId, ds.codigo]);
    if (resReservaActiva.rowCount > 0) {
        throw errorNegocio('DESCUENTO_YA_RESERVADO', 409);
    }

    return {
        descuentoId: ds.descuento_id,
        descuentoClienteId: ds.descuentocliente_id,
        codigo: ds.codigo,
        nombre: ds.nombre,
        tipo: ds.tipo,
        empresaAliada: ds.empresa_aliada_nombre,
        tipoCalculo: tipoCalculoFinal,
        valor: valorFinal,
        tarifaOriginal,
        importeDescuento,
        importeFinal,
        fechaFin: ds.dc_fin || ds.d_fin,
        usosDisponibles: Math.max(0, usosDisponibles),
        certificado
    };
};

// ----------------------------------------------------------------------
// EXPORTS OPERATIVOS
// ----------------------------------------------------------------------

exports.consultarDescuento = async (codigo, certificadoId, userContext) => {
    const client = await db.connect();
    try {
        const resultado = await consultarDescuentoCore(client, codigo, certificadoId, userContext, false);
        delete resultado.certificado;
        return resultado;
    } finally {
        client.release();
    }
};

exports.aplicarDescuentoBorrador = async (certificadoId, codigo, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        // Liberar reservas vencidas de todos para sanidad (opcional, pero útil)
        await client.query(`
            UPDATE fg_descuentocomprobante 
            SET estado = 'LIBERADO', fecha_modificacion = CURRENT_TIMESTAMP
            WHERE estado = 'RESERVADO'
              AND orden_pago_id IS NULL
              AND reservado_hasta < CURRENT_TIMESTAMP
        `);

        // Consultar y bloquear
        const calculo = await consultarDescuentoCore(client, codigo, certificadoId, userContext, true);
        
        // Verificar que no haya orden de pago
        const sqlOrd = `SELECT 1 FROM fg_orden_pago WHERE certificado_id = $1`;
        const resOrd = await client.query(sqlOrd, [certificadoId]);
        if (resOrd.rowCount > 0) {
            throw errorNegocio('ORDEN_PAGO_EXISTENTE', 409);
        }

        // Si ya tenía la misma reserva, no hacer nada y devolver
        const sqlExiste = `
            SELECT id FROM fg_descuentocomprobante 
            WHERE certificado_id = $1 AND descuento_cliente_id = $2 AND estado IN ('RESERVADO', 'APLICADO')
        `;
        const resExiste = await client.query(sqlExiste, [certificadoId, calculo.descuentoClienteId]);
        
        if (resExiste.rowCount === 0) {
            // Liberar reservas anteriores si hubiera del mismo certificado (aunque el core ya validó incompatibles)
            await client.query(`
                UPDATE fg_descuentocomprobante 
                SET estado = 'LIBERADO', usuario_modificacion = $2, fecha_modificacion = CURRENT_TIMESTAMP
                WHERE certificado_id = $1 AND estado = 'RESERVADO'
            `, [certificadoId, userContext.username]);

            // Insertar nueva reserva (expira en 24 horas)
            await client.query(`
                INSERT INTO fg_descuentocomprobante (
                    descuento_cliente_id, certificado_id, importe_original, importe_descuento, importe_final,
                    estado, reservado_hasta, usuario_creacion
                ) VALUES (
                    $1, $2, $3, $4, $5, 'RESERVADO', CURRENT_TIMESTAMP + INTERVAL '24 hours', $6
                )
            `, [
                calculo.descuentoClienteId, certificadoId, calculo.tarifaOriginal, 
                calculo.importeDescuento, calculo.importeFinal, userContext.username
            ]);
        }

        await client.query('COMMIT');
        
        delete calculo.certificado;
        return calculo;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.quitarDescuentoBorrador = async (certificadoId, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const sqlOrd = `SELECT 1 FROM fg_orden_pago WHERE certificado_id = $1`;
        const resOrd = await client.query(sqlOrd, [certificadoId]);
        if (resOrd.rowCount > 0) {
            throw errorNegocio('ORDEN_PAGO_EXISTENTE', 409);
        }

        await client.query(`
            UPDATE fg_descuentocomprobante 
            SET estado = 'LIBERADO', usuario_modificacion = $2, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE certificado_id = $1 AND estado = 'RESERVADO'
        `, [certificadoId, userContext.username]);

        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.obtenerDescuentoBorrador = async (certificadoId, userContext) => {
    const client = await db.connect();
    try {
        // Check access
        await obtenerCertificado(client, certificadoId, userContext);
        
        const sql = `
            SELECT dc.codigo 
            FROM fg_descuentocomprobante cmp
            JOIN fg_descuentocliente dc ON dc.id = cmp.descuento_cliente_id
            WHERE cmp.certificado_id = $1 AND cmp.estado IN ('RESERVADO', 'APLICADO')
            AND cmp.reservado_hasta >= CURRENT_TIMESTAMP
        `;
        const res = await client.query(sql, [certificadoId]);
        if (res.rowCount === 0) return null;
        
        return await consultarDescuentoCore(client, res.rows[0].codigo, certificadoId, userContext, false);
    } catch (error) {
        if (error.code === 'DESCUENTO_NO_APLICA_SERVICIO' || error.code === 'DESCUENTO_NO_APLICA_PLACA' || error.code === 'CODIGO_VENCIDO') {
            return null; // Si ya no aplica, retornar nulo para que el frontend pida liberarlo
        }
        throw error;
    } finally {
        client.release();
    }
};

// ----------------------------------------------------------------------
// METODOS INTERNOS PARA PAGOS
// ----------------------------------------------------------------------

exports.obtenerResumenDescuentoCertificado = async (queryable, certificado) => {
    // Busca si tiene reserva válida y activa
    const sql = `
        SELECT cmp.*, dc.codigo
        FROM fg_descuentocomprobante cmp
        JOIN fg_descuentocliente dc ON dc.id = cmp.descuento_cliente_id
        WHERE cmp.certificado_id = $1 AND cmp.estado IN ('RESERVADO', 'APLICADO')
    `;
    const res = await queryable.query(sql, [certificado.id]);
    
    let tarifaOriginal = 0;
    if (certificado.tarifa_codigo) {
        const tarifaOp = await tarifasService.obtenerTarifaOperativaPorCodigo(
            certificado.planta_key,
            certificado.tarifa_codigo,
            queryable
        );
        if (tarifaOp) tarifaOriginal = Number(tarifaOp.precio);
    }

    if (res.rowCount === 0) {
        return {
            tarifaOriginal,
            descuento: 0,
            totalFinal: tarifaOriginal,
            reserva: null
        };
    }

    const reserva = res.rows[0];
    if (Math.abs(Number(reserva.importe_original) - tarifaOriginal) > 0.009) {
        throw errorNegocio('DESCUENTO_REQUIERE_REVALIDACION', 409);
    }
    // Revalidar vigencia si está en reservado
    if (reserva.estado === 'RESERVADO') {
        const ahora = new Date();
        if (!reserva.orden_pago_id && ahora > new Date(reserva.reservado_hasta)) {
            // Ya expiró, la devolvemos como nula y debería liberarse (el job asíncrono o la vista lo liberará)
            return {
                tarifaOriginal,
                descuento: 0,
                totalFinal: tarifaOriginal,
                reserva: null
            };
        }
    }

    return {
        tarifaOriginal: Number(reserva.importe_original),
        descuento: Number(reserva.importe_descuento),
        totalFinal: Number(reserva.importe_final),
        reserva
    };
};

exports.consumirDescuentoSiExiste = async (queryable, certificadoId, ordenPagoId, userContext) => {
    // Llamado desde el servicio de pagos CUANDO EL PAGO QUEDA 'PAGADO'.
    const sql = `
        SELECT cmp.id, cmp.descuento_cliente_id, cmp.estado, cmp.reservado_hasta, cmp.orden_pago_id
        FROM fg_descuentocomprobante cmp
        WHERE cmp.certificado_id = $1 AND cmp.estado IN ('RESERVADO', 'APLICADO')
        FOR UPDATE
    `;
    const res = await queryable.query(sql, [certificadoId]);
    if (res.rowCount === 0) return;

    const reserva = res.rows[0];
    if (reserva.estado === 'RESERVADO') {
        if (!reserva.orden_pago_id && new Date(reserva.reservado_hasta) < new Date()) {
            await queryable.query(`UPDATE fg_descuentocomprobante SET estado='LIBERADO',
                usuario_modificacion=$1, fecha_modificacion=CURRENT_TIMESTAMP WHERE id=$2`,
            [userContext.username, reserva.id]);
            return;
        }
        await queryable.query('SELECT id FROM fg_descuentocliente WHERE id=$1 FOR UPDATE', [reserva.descuento_cliente_id]);
        // Consumir
        await queryable.query(`
            UPDATE fg_descuentocliente 
            SET usos_realizados = usos_realizados + 1, fecha_modificacion = CURRENT_TIMESTAMP, usuario_modificacion = $1
            WHERE id = $2
        `, [userContext.username, reserva.descuento_cliente_id]);

        await queryable.query(`
            UPDATE fg_descuentocomprobante 
            SET estado = 'APLICADO', orden_pago_id = $3, fecha_aplicacion = CURRENT_TIMESTAMP,
                usuario_modificacion = $1, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [userContext.username, reserva.id, ordenPagoId]);
    }
};

// ----------------------------------------------------------------------
// EXPORTS ADMINISTRATIVOS
// ----------------------------------------------------------------------
const normalizarInicioDia = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''))
    ? `${valor}T00:00:00`
    : valor;
const normalizarFinDia = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''))
    ? `${valor}T23:59:59.999`
    : valor;

const normalizarCampana = (data) => ({
    codigo: String(data.codigo || '').trim().toUpperCase(),
    nombre: String(data.nombre || '').trim(),
    tipo: String(data.tipo || '').trim().toUpperCase(),
    empresaAliadaRuc: String(data.empresaAliadaRuc || '').trim() || null,
    empresaAliadaNombre: String(data.empresaAliadaNombre || '').trim() || null,
    tipoCalculo: String(data.tipoCalculo || '').trim().toUpperCase(),
    valor: Number(data.valor),
    fechaInicio: normalizarInicioDia(data.fechaInicio),
    fechaFin: normalizarFinDia(data.fechaFin),
    plantaKey: String(data.plantaKey || '').trim() || null,
    servicioIds: [...new Set((data.servicioIds || []).map(Number).filter(Number.isInteger))]
});

const validarCampana = (data) => {
    if (!/^[A-Z0-9_-]{2,50}$/.test(data.codigo)) throw errorNegocio('CODIGO_DESCUENTO_INVALIDO', 400);
    if (!data.nombre) throw errorNegocio('NOMBRE_DESCUENTO_REQUERIDO', 400);
    if (!['ALIANZA', 'CUPON', 'PLACA'].includes(data.tipo)) throw errorNegocio('TIPO_DESCUENTO_INVALIDO', 400);
    if (!['MONTO', 'PORCENTAJE'].includes(data.tipoCalculo)) throw errorNegocio('TIPO_CALCULO_INVALIDO', 400);
    if (!Number.isFinite(data.valor) || data.valor <= 0 || (data.tipoCalculo === 'PORCENTAJE' && data.valor > 100)) {
        throw errorNegocio('VALOR_DESCUENTO_INVALIDO', 400);
    }
    if (!data.fechaInicio || !data.fechaFin || new Date(data.fechaFin) < new Date(data.fechaInicio)) {
        throw errorNegocio('VIGENCIA_DESCUENTO_INVALIDA', 400);
    }
    if (data.servicioIds.length === 0) throw errorNegocio('SERVICIOS_DESCUENTO_REQUERIDOS', 400);
};

exports.listarDescuentos = async (filtros = {}) => {
    const params = [];
    let where = 'WHERE 1=1';
    if (filtros.estado === 'ACTIVOS') where += ' AND d.activo = TRUE AND d.fecha_fin >= CURRENT_TIMESTAMP';
    if (filtros.estado === 'INACTIVOS') where += ' AND d.activo = FALSE';
    if (filtros.estado === 'VENCIDOS') where += ' AND d.fecha_fin < CURRENT_TIMESTAMP';
    if (filtros.buscar) {
        params.push(`%${String(filtros.buscar).trim()}%`);
        where += ` AND (d.codigo ILIKE $${params.length} OR d.nombre ILIKE $${params.length} OR COALESCE(d.empresa_aliada_nombre, '') ILIKE $${params.length})`;
    }
    const result = await db.query(`
        SELECT d.*,
               p.nombre AS planta_nombre,
               COUNT(DISTINCT dd.id) FILTER (WHERE dd.activo) AS total_servicios,
               COUNT(DISTINCT dc.id) AS total_codigos,
               COALESCE(SUM(dc.usos_realizados), 0) AS usos_realizados
        FROM fg_descuento d
        LEFT JOIN fg_planta p ON p.key = d.planta_key
        LEFT JOIN fg_descuentodetalle dd ON dd.descuento_id = d.id
        LEFT JOIN fg_descuentocliente dc ON dc.descuento_id = d.id
        ${where}
        GROUP BY d.id, p.nombre
        ORDER BY d.activo DESC, d.fecha_fin DESC, d.nombre
    `, params);
    return result.rows;
};

exports.obtenerMaestrosAdministracion = async () => {
    const [plantas, servicios] = await Promise.all([
        db.query('SELECT key, nombre FROM fg_planta WHERE activo = TRUE ORDER BY nombre'),
        db.query(`SELECT s.id, s.codigo, s.nombre, c.nombre AS categoria
                  FROM fg_servicio s JOIN fg_categoria_servicio c ON c.id = s.categoria_id
                  WHERE s.activo = TRUE ORDER BY c.orden, s.orden, s.nombre`)
    ]);
    return { plantas: plantas.rows, servicios: servicios.rows };
};

exports.crearDescuento = async (data, userContext) => {
    const normalizada = normalizarCampana(data);
    validarCampana(normalizada);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`
            INSERT INTO fg_descuento
                (codigo, nombre, tipo, empresa_aliada_ruc, empresa_aliada_nombre,
                 tipo_calculo, valor, fecha_inicio, fecha_fin, planta_key, usuario_creacion)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
        `, [normalizada.codigo, normalizada.nombre, normalizada.tipo, normalizada.empresaAliadaRuc,
            normalizada.empresaAliadaNombre, normalizada.tipoCalculo, normalizada.valor,
            normalizada.fechaInicio, normalizada.fechaFin, normalizada.plantaKey, userContext.username]);
        const id = result.rows[0].id;
        for (const servicioId of normalizada.servicioIds) {
            await client.query(`INSERT INTO fg_descuentodetalle
                (descuento_id, servicio_id, usuario_creacion) VALUES ($1,$2,$3)`,
            [id, servicioId, userContext.username]);
        }
        await client.query('COMMIT');
        return { id: Number(id) };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw errorNegocio('DESCUENTO_DUPLICADO', 409);
        throw error;
    } finally { client.release(); }
};

exports.actualizarDescuento = async (id, data, userContext) => {
    const normalizada = normalizarCampana(data);
    validarCampana(normalizada);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`UPDATE fg_descuento SET
            codigo=$2, nombre=$3, tipo=$4, empresa_aliada_ruc=$5, empresa_aliada_nombre=$6,
            tipo_calculo=$7, valor=$8, fecha_inicio=$9, fecha_fin=$10, planta_key=$11,
            usuario_modificacion=$12, fecha_modificacion=CURRENT_TIMESTAMP
            WHERE id=$1 RETURNING id`, [id, normalizada.codigo, normalizada.nombre, normalizada.tipo,
            normalizada.empresaAliadaRuc, normalizada.empresaAliadaNombre, normalizada.tipoCalculo,
            normalizada.valor, normalizada.fechaInicio, normalizada.fechaFin, normalizada.plantaKey, userContext.username]);
        if (!result.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
        await client.query('UPDATE fg_descuentodetalle SET activo=FALSE, usuario_modificacion=$2, fecha_modificacion=CURRENT_TIMESTAMP WHERE descuento_id=$1', [id, userContext.username]);
        for (const servicioId of normalizada.servicioIds) {
            await client.query(`INSERT INTO fg_descuentodetalle (descuento_id, servicio_id, activo, usuario_creacion)
                VALUES ($1,$2,TRUE,$3) ON CONFLICT (descuento_id, servicio_id) DO UPDATE SET activo=TRUE, usuario_modificacion=$3, fecha_modificacion=CURRENT_TIMESTAMP`,
            [id, servicioId, userContext.username]);
        }
        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw errorNegocio('DESCUENTO_DUPLICADO', 409);
        throw error;
    } finally { client.release(); }
};

exports.cambiarEstadoDescuento = async (id, activo, userContext) => {
    const result = await db.query(`UPDATE fg_descuento SET activo=$2, usuario_modificacion=$3,
        fecha_modificacion=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id`, [id, Boolean(activo), userContext.username]);
    if (!result.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
    return { success: true };
};

exports.obtenerDetalleAdministracion = async (id) => {
    const [descuento, servicios, codigos] = await Promise.all([
        db.query('SELECT * FROM fg_descuento WHERE id=$1', [id]),
        db.query('SELECT servicio_id, tipo_calculo, valor, precio_minimo FROM fg_descuentodetalle WHERE descuento_id=$1 AND activo=TRUE ORDER BY servicio_id', [id]),
        db.query(`SELECT id, codigo, tipo_documento, nro_documento, placa, fecha_inicio, fecha_fin,
                         max_usos, usos_realizados, activo
                  FROM fg_descuentocliente WHERE descuento_id=$1 ORDER BY fecha_creacion DESC`, [id])
    ]);
    if (!descuento.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
    return { descuento: descuento.rows[0], servicios: servicios.rows, codigos: codigos.rows };
};

exports.crearCodigoCliente = async (descuentoId, data, userContext) => {
    const codigo = String(data.codigo || '').trim().toUpperCase();
    const maxUsos = Number(data.maxUsos || 1);
    if (!/^[A-Z0-9_-]{2,80}$/.test(codigo)) throw errorNegocio('CODIGO_CLIENTE_INVALIDO', 400);
    if (!Number.isInteger(maxUsos) || maxUsos <= 0) throw errorNegocio('MAX_USOS_INVALIDO', 400);
    if ((data.fechaInicio && !data.fechaFin) || (!data.fechaInicio && data.fechaFin)) throw errorNegocio('VIGENCIA_CODIGO_INVALIDA', 400);
    const fechaInicio = normalizarInicioDia(data.fechaInicio || null);
    const fechaFin = normalizarFinDia(data.fechaFin || null);
    try {
        const campana = await db.query('SELECT tipo, fecha_inicio, fecha_fin FROM fg_descuento WHERE id=$1', [descuentoId]);
        if (!campana.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
        const placa = campana.rows[0].tipo === 'PLACA'
            ? String(data.placa || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null
            : null;
        if (campana.rows[0].tipo === 'PLACA' && !placa) throw errorNegocio('PLACA_DESCUENTO_REQUERIDA', 400);
        if (fechaInicio && (new Date(fechaInicio) < new Date(campana.rows[0].fecha_inicio) || new Date(fechaFin) > new Date(campana.rows[0].fecha_fin))) {
            throw errorNegocio('VIGENCIA_CODIGO_FUERA_DE_CAMPANA', 400);
        }
        const result = await db.query(`INSERT INTO fg_descuentocliente
            (descuento_id, codigo, tipo_documento, nro_documento, placa, fecha_inicio, fecha_fin,
             max_usos, usuario_creacion)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [descuentoId, codigo, null, null, placa, fechaInicio, fechaFin, maxUsos, userContext.username]);
        return { id: Number(result.rows[0].id) };
    } catch (error) {
        if (error.code === '23503') throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
        if (error.code === '23505') throw errorNegocio('CODIGO_CLIENTE_DUPLICADO', 409);
        throw error;
    }
};

exports.cambiarEstadoCodigo = async (id, activo, userContext) => {
    const result = await db.query(`UPDATE fg_descuentocliente SET activo=$2, usuario_modificacion=$3,
        fecha_modificacion=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id`, [id, Boolean(activo), userContext.username]);
    if (!result.rowCount) throw errorNegocio('CODIGO_NOT_FOUND', 404);
    return { success: true };
};

exports._private = {
    errorNegocio
};
