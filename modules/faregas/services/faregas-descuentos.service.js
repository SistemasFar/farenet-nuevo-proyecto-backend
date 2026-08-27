const db = require('../../../config/database');
const { randomUUID } = require('crypto');
const faregasAuthService = require('./faregas-auth.service');
const tarifasService = require('./faregas-tarifas.service');
const configService = require('./faregas-config.service');
const auditoriaService = require('./faregas-auditoria.service');

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
            d.id AS descuento_id, d.nombre, d.tipo, d.empresa_aliada_nombre,
            d.fecha_inicio AS d_inicio, d.fecha_fin AS d_fin, d.activo AS d_activo
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

    const placaNormalizada = (value) => String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (ds.placa) {
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
        SELECT tipo_calculo, valor, valor_contado, valor_credito, activo
        FROM fg_descuentodetalle
        WHERE descuento_id = $1 AND descuento_cliente_id IS NULL
          AND planta_key = $2 AND servicio_id = $3
    `;
    const resDet = await client.query(sqlDet, [ds.descuento_id, certificado.planta_key, servicioId]);
    if (resDet.rowCount === 0 || !resDet.rows[0].activo) {
        const sedeConfigurada = await client.query(`SELECT 1 FROM fg_descuentodetalle
            WHERE descuento_id=$1 AND descuento_cliente_id IS NULL
              AND planta_key=$2 AND activo=TRUE LIMIT 1`,
        [ds.descuento_id, certificado.planta_key]);
        throw errorNegocio(sedeConfigurada.rowCount ? 'DESCUENTO_NO_APLICA_SERVICIO' : 'DESCUENTO_NO_APLICA_SEDE', 422);
    }
    const det = resDet.rows[0];
    
    // 5. Calcular importe
    const tipoCalculoFinal = det.tipo_calculo;
    // El flujo FAREGAS actual genera órdenes al contado. La columna crédito
    // queda lista para cuando se habilite esa modalidad comercial.
    const formaPago = 'CONTADO';
    const valorFinal = Number(tipoCalculoFinal === 'FLAT'
        ? (formaPago === 'CREDITO' ? det.valor_credito : det.valor_contado)
        : det.valor);

    if (!['FLAT', 'MONTO', 'PORCENTAJE'].includes(tipoCalculoFinal) || !Number.isFinite(valorFinal) || valorFinal <= 0) {
        throw errorNegocio('REGLA_DESCUENTO_NO_CONFIGURADA', 409);
    }
    
    let importeDescuento = 0;
    if (tipoCalculoFinal === 'FLAT') {
        importeDescuento = tarifaOriginal - valorFinal;
    } else if (tipoCalculoFinal === 'MONTO') {
        importeDescuento = valorFinal;
    } else {
        importeDescuento = (tarifaOriginal * valorFinal) / 100;
    }

    // Redondear a 2 decimales
    importeDescuento = Math.round(importeDescuento * 100) / 100;
    
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
        formaPago,
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
    let tarifaOriginal = 0;
    if (certificado.tarifa_codigo) {
        const tarifaOp = await tarifasService.obtenerTarifaOperativaPorCodigo(
            certificado.planta_key,
            certificado.tarifa_codigo,
            queryable
        );
        if (tarifaOp) tarifaOriginal = Number(tarifasService.validarTarifaCertificacion(tarifaOp).precio);
    }

    // La tarifa se valida antes de consultar descuentos para que un servicio
    // no certificable jamás avance hacia pago aunque no tenga descuento.
    const sql = `
        SELECT cmp.*, dc.codigo
        FROM fg_descuentocomprobante cmp
        JOIN fg_descuentocliente dc ON dc.id = cmp.descuento_cliente_id
        WHERE cmp.certificado_id = $1 AND cmp.estado IN ('RESERVADO', 'APLICADO')
    `;
    const res = await queryable.query(sql, [certificado.id]);

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
    nombre: String(data.nombre || '').trim(),
    tipo: String(data.tipo || '').trim().toUpperCase(),
    empresaAliadaRuc: String(data.empresaAliadaRuc || '').trim() || null,
    empresaAliadaNombre: String(data.empresaAliadaNombre || '').trim() || null,
    ejecutivo: String(data.ejecutivo || '').trim() || null,
    fechaInicio: normalizarInicioDia(data.fechaInicio),
    fechaFin: normalizarFinDia(data.fechaFin)
});

const validarCampana = (data) => {
    if (!data.nombre) throw errorNegocio('NOMBRE_DESCUENTO_REQUERIDO', 400);
    if (!['CAMPANA', 'ALIANZA', 'CONVENIO', 'PROMOCION'].includes(data.tipo)) throw errorNegocio('TIPO_DESCUENTO_INVALIDO', 400);
    if (!data.fechaInicio || !data.fechaFin || new Date(data.fechaFin) < new Date(data.fechaInicio)) {
        throw errorNegocio('VIGENCIA_DESCUENTO_INVALIDA', 400);
    }
};

const generarCodigoInternoCampana = (tipo) => `D_${tipo}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

const obtenerOCrearEjecutivo = async (client, nombre, username) => {
    if (!nombre) return null;
    await client.query(`
        INSERT INTO fg_ejecutivo (nombre, usuario_creacion)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
    `, [nombre, username]);
    const result = await client.query(`
        SELECT id
        FROM fg_ejecutivo
        WHERE LOWER(BTRIM(nombre)) = LOWER(BTRIM($1))
        LIMIT 1
    `, [nombre]);
    if (!result.rowCount) throw errorNegocio('EJECUTIVO_NO_REGISTRADO', 500);
    return Number(result.rows[0].id);
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
               (SELECT COUNT(*) FROM fg_descuentodetalle dd
                WHERE dd.descuento_id=d.id AND dd.descuento_cliente_id IS NULL AND dd.activo=TRUE) AS total_servicios,
               COUNT(DISTINCT dc.id) AS total_codigos,
               STRING_AGG(DISTINCT dc.codigo, ',' ORDER BY dc.codigo) FILTER (WHERE dc.activo=TRUE) AS nombres_codigos,
               COALESCE((SELECT SUM(dc_usos.usos_realizados)
                         FROM fg_descuentocliente dc_usos
                         WHERE dc_usos.descuento_id=d.id), 0) AS usos_realizados
        FROM fg_descuento d
        LEFT JOIN fg_descuentocliente dc ON dc.descuento_id = d.id
        ${where}
        GROUP BY d.id
        ORDER BY d.activo DESC, d.fecha_fin DESC, d.nombre
    `, params);
    return result.rows;
};

exports.obtenerMaestrosAdministracion = async () => {
    const [plantas, servicios, serviciosPorPlanta, ejecutivos] = await Promise.all([
        db.query('SELECT key, nombre FROM fg_planta WHERE activo = TRUE ORDER BY nombre'),
        db.query(`SELECT s.id, s.codigo, s.nombre, c.nombre AS categoria
                  FROM fg_servicio s JOIN fg_categoria_servicio c ON c.id = s.categoria_id
                  WHERE s.activo = TRUE ORDER BY c.orden, s.orden, s.nombre`),
        db.query(`SELECT t.planta_key, s.id, s.codigo, s.nombre, c.nombre AS categoria,
                         t.precio, t.codigo AS tarifa_codigo
                  FROM fg_tarifa t
                  JOIN fg_planta p ON p.key=t.planta_key
                  JOIN fg_servicio s ON s.id=t.servicio_id
                  JOIN fg_categoria_servicio c ON c.id=s.categoria_id
                  WHERE p.activo=TRUE AND t.activo=TRUE AND s.activo=TRUE AND c.activo=TRUE
                    AND s.tipo_flujo='CERTIFICACION'
                  ORDER BY p.nombre, c.orden, s.orden, s.nombre`),
        db.query(`SELECT id, username, nombre
                  FROM fg_ejecutivo
                  WHERE activo=TRUE
                  ORDER BY nombre`)
    ]);
    return { plantas: plantas.rows, servicios: servicios.rows, serviciosPorPlanta: serviciosPorPlanta.rows, ejecutivos: ejecutivos.rows };
};

exports.crearDescuento = async (data, userContext) => {
    const normalizada = normalizarCampana(data);
    validarCampana(normalizada);
    const codigoInterno = generarCodigoInternoCampana(normalizada.tipo);
    const esRelacionCorporativa = normalizada.tipo === 'ALIANZA' || normalizada.tipo === 'CONVENIO';
    const empresaAliadaRuc = esRelacionCorporativa ? normalizada.empresaAliadaRuc : null;
    const empresaAliadaNombre = esRelacionCorporativa ? normalizada.empresaAliadaNombre : null;
    const ejecutivo = normalizada.tipo === 'ALIANZA' ? normalizada.ejecutivo : null;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const ejecutivoId = await obtenerOCrearEjecutivo(client, ejecutivo, userContext.username);
        const result = await client.query(`
            INSERT INTO fg_descuento
                (codigo, nombre, tipo, empresa_aliada_ruc, empresa_aliada_nombre, ejecutivo, ejecutivo_id,
                 tipo_calculo, valor, fecha_inicio, fecha_fin, planta_key, usuario_creacion)
            VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9,NULL,$10) RETURNING id
        `, [codigoInterno, normalizada.nombre, normalizada.tipo, empresaAliadaRuc,
            empresaAliadaNombre, ejecutivo, ejecutivoId, normalizada.fechaInicio, normalizada.fechaFin, userContext.username]);
        const id = result.rows[0].id;
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
    const esRelacionCorporativa = normalizada.tipo === 'ALIANZA' || normalizada.tipo === 'CONVENIO';
    const empresaAliadaRuc = esRelacionCorporativa ? normalizada.empresaAliadaRuc : null;
    const empresaAliadaNombre = esRelacionCorporativa ? normalizada.empresaAliadaNombre : null;
    const ejecutivo = normalizada.tipo === 'ALIANZA' ? normalizada.ejecutivo : null;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const ejecutivoId = await obtenerOCrearEjecutivo(client, ejecutivo, userContext.username);
        const result = await client.query(`UPDATE fg_descuento SET
            nombre=$2, tipo=$3, empresa_aliada_ruc=$4, empresa_aliada_nombre=$5,
            ejecutivo=$6, ejecutivo_id=$7, fecha_inicio=$8, fecha_fin=$9,
            usuario_modificacion=$10, fecha_modificacion=CURRENT_TIMESTAMP
            WHERE id=$1 RETURNING id`, [id, normalizada.nombre, normalizada.tipo,
            empresaAliadaRuc, empresaAliadaNombre, ejecutivo, ejecutivoId,
            normalizada.fechaInicio, normalizada.fechaFin, userContext.username]);
        if (!result.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw errorNegocio('DESCUENTO_DUPLICADO', 409);
        throw error;
    } finally { client.release(); }
};

exports.cambiarEstadoDescuento = async (id, activo, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const check = await client.query('SELECT * FROM fg_descuento WHERE id=$1', [id]);
        if (!check.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
        const anterior = check.rows[0];

        await client.query(`UPDATE fg_descuento SET activo=$2, usuario_modificacion=$3,
            fecha_modificacion=CURRENT_TIMESTAMP WHERE id=$1`, [id, Boolean(activo), userContext.username]);

        // Registrar auditoria en tabla de acceso/eventos (fg_auditoria_acceso) para que salga en la pestaña DESCUENTOS
        await auditoriaService.registrarEvento({
            username: userContext.username,
            evento: activo ? 'ACTIVAR_DESCUENTO' : 'DESACTIVAR_DESCUENTO',
            exitoso: true,
            mensaje: `Se ha ${activo ? 'activado' : 'desactivado'} el descuento ${anterior.nombre}`,
            ip_direccion: userContext.ip_direccion,
            categoria: 'DESCUENTO',
            entidad: 'fg_descuento',
            entidad_id: id,
            datos: { antes: { activo: anterior.activo }, despues: { activo } }
        });

        await client.query('COMMIT');
        return { success: true };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports._private = {
    errorNegocio
};
