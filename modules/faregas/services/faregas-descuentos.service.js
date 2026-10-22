const db = require('../../../config/database');
const { randomUUID } = require('crypto');
const faregasAuthService = require('./faregas-auth.service');
const tarifasService = require('./faregas-tarifas.service');
const configService = require('./faregas-config.service');
const auditoriaService = require('./faregas-auditoria.service');
const descuentosImpactoService = require('./faregas-descuentos-impacto.service');
const {
    CODIGO_AUTORIZACION_GRATUIDAD_TALLER,
    esCodigoGratuidadTaller,
    esFlujoTaller,
    consultarConvenioProtegido,
    consultarCodigoProtegido
} = require('./faregas-gratuidad-taller.policy');

// Los certificados técnicos y las inspecciones de taller son servicios
// comerciales válidos para campañas. Se comparte la misma lista entre el
// catálogo administrativo y la validación al guardar para que un servicio
// visible nunca sea rechazado después.
const FLUJOS_DESCONTABLES = Object.freeze(['CERTIFICACION', 'TALLER_INSPECCION']);

const errorNegocio = (codigo, statusCode = 400, detalles) => {
    const error = new Error(codigo);
    error.code = codigo;
    error.statusCode = statusCode;
    if (detalles) error.detalles = detalles;
    return error;
};

const resolverPrecioServicio = (row) => tarifasService.resolverPrecioComercial({
    productoFacturacionId: row.producto_facturacion_id,
    precioReferencia: row.producto_precio_referencia,
    precioUnitario: row.producto_precio_unitario
});

const mapearServicioAdministracion = (row) => ({
    ...row,
    precio: resolverPrecioServicio(row)
});

const calcularImporteFinal = (precio, tipoCalculo, valor) => {
    if (tipoCalculo === 'FLAT') return Number(valor);
    if (tipoCalculo === 'MONTO') return Math.max(0, Number(precio) - Number(valor));
    return Math.max(0, Number(precio) * (1 - Number(valor) / 100));
};

// ----------------------------------------------------------------------
// VALIDACIONES Y CONSULTA
// ----------------------------------------------------------------------

const obtenerCertificado = async (client, certificadoId, userContext) => {
    const result = await client.query(
        `SELECT c.id, c.estado, c.planta_key, c.tipo_certificado_clave, c.tarifa_codigo,
                s.tipo_flujo AS servicio_tipo_flujo
         FROM fg_certificado c
         LEFT JOIN fg_tarifa t ON t.planta_key = c.planta_key AND t.codigo = c.tarifa_codigo
         LEFT JOIN fg_servicio s ON s.id = t.servicio_id
         WHERE c.id = $1`,
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
    const esAutorizacionGratuita = esCodigoGratuidadTaller(ds.codigo);
    if (esAutorizacionGratuita && !esFlujoTaller(certificado.servicio_tipo_flujo)) {
        throw errorNegocio('DESCUENTO_NO_APLICA_SERVICIO', 422);
    }
    if (esAutorizacionGratuita && Math.abs(importeFinal) > 0.01) {
        throw errorNegocio('GRATUIDAD_TALLER_CONFIGURACION_INVALIDA', 409);
    }
    if (!esAutorizacionGratuita && Math.abs(importeFinal) <= 0.01) {
        throw errorNegocio('OPERACION_CERO_REQUIERE_AUTORIZACION_GRATUITA', 409);
    }

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
        autorizaGratuidad: esAutorizacionGratuita,
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
        calculo.plantaKey = calculo.certificado?.planta_key || null;
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
    let tarifaOriginal = certificado.precio_certificado === null || certificado.precio_certificado === undefined
        ? 0
        : Number(certificado.precio_certificado);
    if (!tarifaOriginal && certificado.tarifa_codigo) {
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
               (SELECT COUNT(DISTINCT dd.servicio_id) FROM fg_descuentodetalle dd
                WHERE dd.descuento_id=d.id AND dd.descuento_cliente_id IS NULL AND dd.activo=TRUE) AS total_servicios,
               (SELECT COUNT(*) FROM fg_descuentocliente dc_total
                WHERE dc_total.descuento_id=d.id) AS total_codigos,
               COALESCE((SELECT SUM(dc_usos.usos_realizados)
                         FROM fg_descuentocliente dc_usos
                          WHERE dc_usos.descuento_id=d.id), 0) AS usos_realizados,
               EXISTS (
                   SELECT 1 FROM fg_descuentocliente dc_protegido
                   WHERE dc_protegido.descuento_id = d.id
                     AND UPPER(BTRIM(dc_protegido.codigo)) = $${params.length + 1}
               ) AS protegido
        FROM fg_descuento d
        ${where}
        ORDER BY d.activo DESC, d.fecha_fin DESC, d.nombre
    `, [...params, CODIGO_AUTORIZACION_GRATUIDAD_TALLER]);
    return result.rows;
};

exports.obtenerMaestrosAdministracion = async () => {
    const [plantas, servicios, serviciosPorPlanta, ejecutivos] = await Promise.all([
        db.query('SELECT key, nombre FROM fg_planta WHERE activo = TRUE ORDER BY nombre'),
        db.query(`SELECT s.id, s.codigo, s.nombre, c.nombre AS categoria
                  FROM fg_servicio s JOIN fg_categoria_servicio c ON c.id = s.categoria_id
                  WHERE s.activo = TRUE ORDER BY c.orden, s.orden, s.nombre`),
        db.query(`SELECT t.planta_key, s.id, s.codigo, s.nombre, c.nombre AS categoria,
                         s.tipo_certificado_clave, s.modalidad, s.tipo_flujo,
                         t.codigo AS tarifa_codigo, t.producto_facturacion_id,
                         pf.precio_referencia AS producto_precio_referencia,
                         pf.precio_unitario AS producto_precio_unitario
                  FROM fg_tarifa t
                  JOIN fg_planta p ON p.key=t.planta_key
                  JOIN fg_servicio s ON s.id=t.servicio_id
                  JOIN fg_categoria_servicio c ON c.id=s.categoria_id
                  LEFT JOIN fg_producto_facturacion pf ON pf.id=t.producto_facturacion_id
                  WHERE p.activo=TRUE AND t.activo=TRUE AND s.activo=TRUE AND c.activo=TRUE
                    AND s.tipo_flujo = ANY($1::varchar[])
                  ORDER BY p.nombre, c.orden, s.orden, s.nombre`, [FLUJOS_DESCONTABLES]),
        db.query(`SELECT id, username, nombre
                  FROM fg_ejecutivo
                  WHERE activo=TRUE
                  ORDER BY nombre`)
    ]);
    return {
        plantas: plantas.rows,
        servicios: servicios.rows,
        serviciosPorPlanta: serviciosPorPlanta.rows.map(mapearServicioAdministracion),
        ejecutivos: ejecutivos.rows
    };
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
        if (!Boolean(activo) && await consultarConvenioProtegido(client, id, true)) {
            throw errorNegocio('CONVENIO_GRATUIDAD_PROTEGIDO', 409);
        }

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

exports.obtenerImpactoDescuento = (id) => descuentosImpactoService.preview(Number(id));

exports.eliminarDescuento = async (id, userContext, ipDireccion = null) => {
    const descuentoId = Number(id);
    if (!Number.isSafeInteger(descuentoId) || descuentoId <= 0) {
        throw errorNegocio('DESCUENTO_NO_ENCONTRADO', 404);
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const check = await client.query(
            'SELECT * FROM fg_descuento WHERE id=$1 FOR UPDATE', [descuentoId]
        );
        if (!check.rowCount) throw errorNegocio('DESCUENTO_NO_ENCONTRADO', 404);
        if (await consultarConvenioProtegido(client, descuentoId, true)) {
            throw errorNegocio('CONVENIO_GRATUIDAD_NO_ELIMINABLE', 409);
        }

        const impacto = await descuentosImpactoService.calcularImpactoEnTransaccion(
            client, descuentoId, check.rows[0]
        );
        const limpieza = await descuentosImpactoService.eliminarDescuentoConDependencias(client, impacto);

        await auditoriaService.registrarEvento({
            username: userContext.username,
            evento: 'ELIMINAR_DESCUENTO',
            exitoso: true,
            mensaje: `Se eliminó la campaña ${check.rows[0].nombre} y su configuración de prueba`,
            ip_direccion: ipDireccion || userContext.ip_direccion,
            categoria: 'DESCUENTO',
            entidad: 'fg_descuento',
            entidad_id: descuentoId,
            datos: { limpieza, ambiente: impacto.ambiente }
        });

        await client.query('COMMIT');
        return {
            id: descuentoId,
            codigo: check.rows[0].codigo,
            nombre: check.rows[0].nombre,
            ...limpieza
        };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerDetalleAdministracion = async (id) => {
    const [descuento, reglas] = await Promise.all([
        db.query('SELECT * FROM fg_descuento WHERE id=$1', [id]),
        db.query(`SELECT dd.planta_key AS "plantaKey", dd.servicio_id AS "servicioId",
                         dd.tipo_calculo AS "tipoCalculo", dd.valor,
                         dd.valor_contado AS "valorContado", dd.valor_credito AS "valorCredito"
                  FROM fg_descuentodetalle dd
                  JOIN fg_planta p ON p.key=dd.planta_key
                  WHERE dd.descuento_id=$1
                    AND dd.descuento_cliente_id IS NULL
                    AND dd.activo=TRUE
                  ORDER BY p.nombre, dd.servicio_id`, [id])
    ]);
    if (!descuento.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
    return { descuento: descuento.rows[0], reglas: reglas.rows };
};

const normalizarCodigoCliente = (data) => ({
    codigo: String(data.codigo || '').trim().toUpperCase(),
    placa: String(data.placa || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null,
    fechaInicio: normalizarInicioDia(data.fechaInicio || null),
    fechaFin: normalizarFinDia(data.fechaFin || null),
    maxUsos: Number(data.maxUsos || 1)
});

const normalizarReglasCampana = (data) => (
    Array.isArray(data.reglas) ? data.reglas : []
).map(item => ({
    plantaKey: String(item.plantaKey || '').trim(),
    servicioId: Number(item.servicioId),
    tipoCalculo: String(item.tipoCalculo || '').trim().toUpperCase(),
    valor: item.valor === '' || item.valor == null ? null : Number(item.valor),
    valorContado: item.valorContado === '' || item.valorContado == null ? null : Number(item.valorContado),
    valorCredito: item.valorCredito === '' || item.valorCredito == null ? null : Number(item.valorCredito)
}));

const validarReglasCampana = (reglas) => {
    if (reglas.length === 0) throw errorNegocio('SERVICIOS_DESCUENTO_REQUERIDOS', 400);
    const combinaciones = new Set();
    for (const detalle of reglas) {
        if (!detalle.plantaKey || !Number.isInteger(detalle.servicioId)) {
            throw errorNegocio('REFERENCIA_DESCUENTO_INVALIDA', 400);
        }
        if (!['FLAT', 'MONTO', 'PORCENTAJE'].includes(detalle.tipoCalculo)) {
            throw errorNegocio('TIPO_CALCULO_INVALIDO', 400);
        }
        if (detalle.tipoCalculo === 'FLAT') {
            if (detalle.valor != null || (detalle.valorContado == null && detalle.valorCredito == null)) {
                throw errorNegocio('VALOR_DESCUENTO_INVALIDO', 400);
            }
            const valores = [detalle.valorContado, detalle.valorCredito].filter(valor => valor != null);
            if (valores.some(valor => !Number.isFinite(valor) || valor <= 0)) {
                throw errorNegocio('VALOR_DESCUENTO_INVALIDO', 400);
            }
        } else if (!Number.isFinite(detalle.valor)
            || detalle.valor <= 0
            || detalle.valorContado != null
            || detalle.valorCredito != null
            || (detalle.tipoCalculo === 'PORCENTAJE' && detalle.valor > 100)) {
            throw errorNegocio('VALOR_DESCUENTO_INVALIDO', 400);
        }

        const combinacion = `${detalle.plantaKey}:${detalle.servicioId}`;
        if (combinaciones.has(combinacion)) throw errorNegocio('REGLA_DESCUENTO_DUPLICADA', 400);
        combinaciones.add(combinacion);
    }
};

const validarCodigoCliente = (regla) => {
    if (!/^[A-Z0-9_-]{2,80}$/.test(regla.codigo)) throw errorNegocio('CODIGO_CLIENTE_INVALIDO', 400);
    if (!Number.isInteger(regla.maxUsos) || regla.maxUsos <= 0) throw errorNegocio('MAX_USOS_INVALIDO', 400);
    if ((regla.fechaInicio && !regla.fechaFin) || (!regla.fechaInicio && regla.fechaFin)) {
        throw errorNegocio('VIGENCIA_CODIGO_INVALIDA', 400);
    }
};

const normalizarPrefijoLote = (valor) => String(valor || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

const generarItemsLote = (data) => {
    const prefijo = normalizarPrefijoLote(data.prefijo);
    const cantidad = Number(data.cantidad);
    const maxUsos = Number(data.maxUsos || 1);
    if (!prefijo || prefijo.length > 70) throw errorNegocio('PREFIJO_CODIGO_INVALIDO', 400);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000) {
        throw errorNegocio('CANTIDAD_CODIGOS_INVALIDA', 400);
    }
    if (!Number.isInteger(maxUsos) || maxUsos < 1) throw errorNegocio('MAX_USOS_INVALIDO', 400);
    return Array.from({ length: cantidad }, (_, indice) => ({
        codigo: `${prefijo}-${String(indice + 1).padStart(6, '0')}`,
        placa: null,
        maxUsos
    }));
};

const normalizarItemImportacion = (item, indice) => {
    const codigo = String(item?.codigo || '').trim().toUpperCase();
    const placaOriginal = String(item?.placa || '').trim().toUpperCase();
    const placa = placaOriginal.replace(/[^A-Z0-9]/g, '') || null;
    const maxUsos = Number(item?.maxUsos ?? item?.max_usos ?? 1);
    const errores = [];
    if (!codigo) errores.push('CODIGO_VACIO');
    else if (!/^[A-Z0-9_-]{2,80}$/.test(codigo)) errores.push('CODIGO_INVALIDO');
    if (!Number.isInteger(maxUsos) || maxUsos < 1) errores.push('MAX_USOS_INVALIDO');
    if (placaOriginal && (!placa || placa.length < 3 || placa.length > 12)) errores.push('PLACA_INVALIDA');
    return { fila: indice + 2, codigo, placa, maxUsos, errores };
};

const validarVigenciaCodigos = (data, campana) => {
    const fechaInicio = normalizarInicioDia(data.fechaInicio || null);
    const fechaFin = normalizarFinDia(data.fechaFin || null);
    if ((fechaInicio && !fechaFin) || (!fechaInicio && fechaFin)) {
        throw errorNegocio('VIGENCIA_CODIGO_INVALIDA', 400);
    }
    if (fechaInicio && (
        new Date(fechaInicio) < new Date(campana.fecha_inicio)
        || new Date(fechaFin) > new Date(campana.fecha_fin)
    )) throw errorNegocio('VIGENCIA_CODIGO_FUERA_DE_CAMPANA', 400);
    return { fechaInicio, fechaFin };
};

const prepararItemsCodigos = (items) => {
    const vistos = new Set();
    const validos = [];
    const errores = [];
    let duplicadosArchivo = 0;
    let rechazados = 0;
    items.forEach((item, indice) => {
        const normalizado = normalizarItemImportacion(item, indice);
        if (normalizado.codigo && vistos.has(normalizado.codigo)) {
            duplicadosArchivo += 1;
            errores.push({ fila: normalizado.fila, codigo: normalizado.codigo, motivo: 'DUPLICADO_ARCHIVO' });
            return;
        }
        if (normalizado.codigo) vistos.add(normalizado.codigo);
        if (normalizado.errores.length) {
            rechazados += 1;
            errores.push(...normalizado.errores.map(motivo => ({ fila: normalizado.fila, codigo: normalizado.codigo, motivo })));
            return;
        }
        validos.push(normalizado);
    });
    return { validos, errores, duplicadosArchivo, rechazados };
};

const insertarCodigosMasivos = async (client, descuentoId, items, vigencia, username) => {
    const tamanoLote = 500;
    for (let inicio = 0; inicio < items.length; inicio += tamanoLote) {
        const lote = items.slice(inicio, inicio + tamanoLote);
        await client.query(`INSERT INTO fg_descuentocliente
            (descuento_id, codigo, tipo_documento, nro_documento, placa, planta_key,
             tipo_calculo, valor_contado, valor_credito, fecha_inicio, fecha_fin,
             max_usos, usuario_creacion)
            SELECT $1, datos.codigo, NULL, NULL, datos.placa, NULL,
                   NULL, NULL, NULL, $2, $3, datos.max_usos, $4
            FROM UNNEST($5::text[], $6::text[], $7::integer[])
                 AS datos(codigo, placa, max_usos)`, [
            descuentoId,
            vigencia.fechaInicio,
            vigencia.fechaFin,
            username,
            lote.map(item => item.codigo),
            lote.map(item => item.placa),
            lote.map(item => item.maxUsos)
        ]);
    }
};

const procesarCodigosMasivos = async (client, descuentoId, items, data, userContext) => {
    if (!Array.isArray(items) || items.length < 1 || items.length > 10000) {
        throw errorNegocio('CANTIDAD_CODIGOS_INVALIDA', 400);
    }
    const campana = await client.query(
        'SELECT fecha_inicio, fecha_fin FROM fg_descuento WHERE id=$1 FOR UPDATE',
        [descuentoId]
    );
    if (!campana.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
    const reglas = await client.query(`SELECT 1 FROM fg_descuentodetalle
        WHERE descuento_id=$1 AND descuento_cliente_id IS NULL AND activo=TRUE LIMIT 1`, [descuentoId]);
    if (!reglas.rowCount) throw errorNegocio('REGLAS_DESCUENTO_REQUERIDAS', 409);
    const vigencia = validarVigenciaCodigos(data, campana.rows[0]);
    const preparados = prepararItemsCodigos(items);
    const codigos = preparados.validos.map(item => item.codigo);
    const existentes = codigos.length ? await client.query(`SELECT UPPER(BTRIM(codigo)) AS codigo
        FROM fg_descuentocliente
        WHERE UPPER(BTRIM(codigo)) = ANY($1::text[])`, [codigos]) : { rows: [] };
    const existentesSet = new Set(existentes.rows.map(row => row.codigo));
    const nuevos = preparados.validos.filter(item => !existentesSet.has(item.codigo));
    const errores = [
        ...preparados.errores,
        ...preparados.validos.filter(item => existentesSet.has(item.codigo))
            .map(item => ({ fila: item.fila, codigo: item.codigo, motivo: 'DUPLICADO_BD' }))
    ];
    if (!data.validarSolo) await insertarCodigosMasivos(client, descuentoId, nuevos, vigencia, userContext.username);
    return {
        solicitados: items.length,
        creados: data.validarSolo ? 0 : nuevos.length,
        validos: nuevos.length,
        duplicados: preparados.duplicadosArchivo + existentesSet.size,
        rechazados: preparados.rechazados,
        errores: errores.slice(0, 100)
    };
};

exports.listarCodigosAdministracion = async (descuentoId, filtros = {}) => {
    const id = Number(descuentoId);
    const limit = Math.min(100, Math.max(1, Number(filtros.limit) || 20));
    const offset = Math.max(0, Number(filtros.offset) || 0);
    const params = [id];
    let where = 'WHERE dc.descuento_id=$1';
    const estado = String(filtros.estado || 'TODOS').toUpperCase();
    if (estado === 'ACTIVO' || estado === 'INACTIVO') {
        params.push(estado === 'ACTIVO');
        where += ` AND dc.activo=$${params.length}`;
    }
    const search = String(filtros.search || '').trim().toUpperCase();
    if (search) {
        params.push(`%${search}%`);
        where += ` AND (UPPER(BTRIM(dc.codigo)) LIKE $${params.length}
                    OR UPPER(BTRIM(COALESCE(dc.placa, ''))) LIKE $${params.length})`;
    }
    const total = await db.query(`SELECT COUNT(*)::integer AS total
        FROM fg_descuentocliente dc ${where}`, params);
    params.push(limit, offset);
    const items = await db.query(`SELECT dc.id, dc.codigo, dc.placa, dc.fecha_inicio, dc.fecha_fin,
               dc.max_usos, dc.usos_realizados, dc.activo
        FROM fg_descuentocliente dc
        ${where}
        ORDER BY dc.fecha_creacion DESC, dc.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: items.rows, total: Number(total.rows[0].total), limit, offset };
};

exports.generarLoteCodigos = async (descuentoId, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const resultado = await procesarCodigosMasivos(client, descuentoId, generarItemsLote(data), data, userContext);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw errorNegocio('CODIGO_CLIENTE_DUPLICADO', 409);
        throw error;
    } finally { client.release(); }
};

exports.importarCodigos = async (descuentoId, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const resultado = await procesarCodigosMasivos(client, descuentoId, data.items, data, userContext);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw errorNegocio('CODIGO_CLIENTE_DUPLICADO', 409);
        throw error;
    } finally { client.release(); }
};

const guardarReglasCampana = async (client, descuentoId, reglas, username) => {
    await client.query(`UPDATE fg_descuentodetalle
        SET activo=FALSE, usuario_modificacion=$2, fecha_modificacion=CURRENT_TIMESTAMP
        WHERE descuento_id=$1 AND descuento_cliente_id IS NULL`, [descuentoId, username]);

    for (const regla of reglas) {
        const referencia = await client.query(`SELECT t.producto_facturacion_id,
                    pf.precio_referencia AS producto_precio_referencia,
                    pf.precio_unitario AS producto_precio_unitario
            FROM fg_tarifa t
            JOIN fg_planta p ON p.key=t.planta_key
            JOIN fg_servicio s ON s.id=t.servicio_id
            JOIN fg_categoria_servicio c ON c.id=s.categoria_id
            LEFT JOIN fg_producto_facturacion pf ON pf.id=t.producto_facturacion_id
            WHERE t.planta_key=$1 AND t.servicio_id=$2 AND t.activo=TRUE
              AND p.activo=TRUE AND s.activo=TRUE AND c.activo=TRUE
              AND s.tipo_flujo = ANY($3::varchar[])`, [
            regla.plantaKey,
            regla.servicioId,
            FLUJOS_DESCONTABLES
        ]);
        if (!referencia.rowCount) throw errorNegocio('REFERENCIA_DESCUENTO_INVALIDA', 400);

        const tarifa = resolverPrecioServicio(referencia.rows[0]);
        if (!Number.isFinite(tarifa) || tarifa <= 0) {
            throw errorNegocio('REFERENCIA_DESCUENTO_INVALIDA', 400);
        }
        const valoresFlat = [regla.valorContado, regla.valorCredito].filter(valor => valor != null);
        if ((regla.tipoCalculo === 'FLAT' && valoresFlat.some(valor => valor >= tarifa))
            || (regla.tipoCalculo === 'MONTO' && regla.valor > tarifa)) {
            throw errorNegocio('IMPORTE_DESCUENTO_INVALIDO', 400);
        }

        await client.query(`INSERT INTO fg_descuentodetalle
            (descuento_id, descuento_cliente_id, planta_key, servicio_id,
             tipo_calculo, valor, valor_contado, valor_credito, activo, usuario_creacion)
            VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,TRUE,$8)
            ON CONFLICT (descuento_id, planta_key, servicio_id)
                WHERE descuento_cliente_id IS NULL
            DO UPDATE SET tipo_calculo=$4, valor=$5, valor_contado=$6, valor_credito=$7,
                activo=TRUE, usuario_modificacion=$8, fecha_modificacion=CURRENT_TIMESTAMP`,
        [descuentoId, regla.plantaKey, regla.servicioId, regla.tipoCalculo,
            regla.valor, regla.valorContado, regla.valorCredito, username]);
    }
};

exports.guardarReglasDescuento = async (descuentoId, data, userContext) => {
    const reglas = normalizarReglasCampana(data);
    validarReglasCampana(reglas);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const campana = await client.query('SELECT id FROM fg_descuento WHERE id=$1 FOR UPDATE', [descuentoId]);
        if (!campana.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
        await guardarReglasCampana(client, descuentoId, reglas, userContext.username);
        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23503') throw errorNegocio('REFERENCIA_DESCUENTO_INVALIDA', 400);
        throw error;
    } finally {
        client.release();
    }
};

exports.crearCodigoCliente = async (descuentoId, data, userContext) => {
    const regla = normalizarCodigoCliente(data);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const campana = await client.query(
            'SELECT fecha_inicio, fecha_fin FROM fg_descuento WHERE id=$1 FOR UPDATE',
            [descuentoId]
        );
        if (!campana.rowCount) throw errorNegocio('DESCUENTO_NOT_FOUND', 404);
        validarCodigoCliente(regla);
        if (regla.fechaInicio && (
            new Date(regla.fechaInicio) < new Date(campana.rows[0].fecha_inicio)
            || new Date(regla.fechaFin) > new Date(campana.rows[0].fecha_fin)
        )) throw errorNegocio('VIGENCIA_CODIGO_FUERA_DE_CAMPANA', 400);

        const reglasConfiguradas = await client.query(`SELECT 1 FROM fg_descuentodetalle
            WHERE descuento_id=$1 AND descuento_cliente_id IS NULL AND activo=TRUE LIMIT 1`, [descuentoId]);
        if (!reglasConfiguradas.rowCount) throw errorNegocio('REGLAS_DESCUENTO_REQUERIDAS', 409);

        const result = await client.query(`INSERT INTO fg_descuentocliente
            (descuento_id, codigo, tipo_documento, nro_documento, placa, planta_key,
             tipo_calculo, valor_contado, valor_credito, fecha_inicio, fecha_fin,
             max_usos, usuario_creacion)
            VALUES ($1,$2,NULL,NULL,$3,NULL,NULL,NULL,NULL,$4,$5,$6,$7)
            RETURNING id`,
        [descuentoId, regla.codigo, regla.placa, regla.fechaInicio,
            regla.fechaFin, regla.maxUsos, userContext.username]);
        await client.query('COMMIT');
        return { id: Number(result.rows[0].id) };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23503') throw errorNegocio('REFERENCIA_DESCUENTO_INVALIDA', 400);
        if (error.code === '23505') throw errorNegocio('CODIGO_CLIENTE_DUPLICADO', 409);
        throw error;
    } finally {
        client.release();
    }
};

exports.actualizarCodigoCliente = async (codigoId, data, userContext) => {
    const regla = normalizarCodigoCliente(data);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        if (await consultarCodigoProtegido(client, codigoId, true)) {
            throw errorNegocio('CODIGO_GRATUIDAD_PROTEGIDO', 409);
        }
        const actual = await client.query(`SELECT dc.descuento_id, dc.usos_realizados,
                                                  d.fecha_inicio, d.fecha_fin
            FROM fg_descuentocliente dc
            JOIN fg_descuento d ON d.id=dc.descuento_id
            WHERE dc.id=$1 FOR UPDATE OF dc`, [codigoId]);
        if (!actual.rowCount) throw errorNegocio('CODIGO_NOT_FOUND', 404);
        validarCodigoCliente(regla);
        if (regla.maxUsos < Number(actual.rows[0].usos_realizados)) {
            throw errorNegocio('MAX_USOS_MENOR_QUE_USADOS', 409);
        }
        if (regla.fechaInicio && (
            new Date(regla.fechaInicio) < new Date(actual.rows[0].fecha_inicio)
            || new Date(regla.fechaFin) > new Date(actual.rows[0].fecha_fin)
        )) throw errorNegocio('VIGENCIA_CODIGO_FUERA_DE_CAMPANA', 400);

        await client.query(`UPDATE fg_descuentocliente
            SET codigo=$2, placa=$3, planta_key=NULL, tipo_calculo=NULL,
                valor_contado=NULL, valor_credito=NULL, fecha_inicio=$4, fecha_fin=$5,
                max_usos=$6, usuario_modificacion=$7, fecha_modificacion=CURRENT_TIMESTAMP
            WHERE id=$1`, [codigoId, regla.codigo, regla.placa, regla.fechaInicio,
            regla.fechaFin, regla.maxUsos, userContext.username]);
        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23503') throw errorNegocio('REFERENCIA_DESCUENTO_INVALIDA', 400);
        if (error.code === '23505') throw errorNegocio('CODIGO_CLIENTE_DUPLICADO', 409);
        throw error;
    } finally {
        client.release();
    }
};

exports.cambiarEstadoCodigo = async (id, activo, userContext) => {
    if (!Boolean(activo) && await consultarCodigoProtegido(db, id, false)) {
        throw errorNegocio('CODIGO_GRATUIDAD_PROTEGIDO', 409);
    }
    const result = await db.query(`UPDATE fg_descuentocliente
        SET activo=$2, usuario_modificacion=$3, fecha_modificacion=CURRENT_TIMESTAMP
        WHERE id=$1 RETURNING id`, [id, Boolean(activo), userContext.username]);
    if (!result.rowCount) throw errorNegocio('CODIGO_NOT_FOUND', 404);
    return { success: true };
};

exports._private = {
    FLUJOS_DESCONTABLES,
    errorNegocio,
    resolverPrecioServicio,
    mapearServicioAdministracion,
    calcularImporteFinal,
    generarItemsLote,
    prepararItemsCodigos,
    validarVigenciaCodigos,
    procesarCodigosMasivos
};
