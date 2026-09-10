const db = require('../../../config/database');
const authService = require('./faregas-auth.service');
const {
    normalizarNumeroChip,
    esNumeroChipCertificadoValido,
    normalizarLoteScanner
} = require('./faregas-chips.rules');
const { redondear } = require('./faregas-pagos.rules');

const validarAcceso = async (user, plantaKey) => {
    if (!await authService.validarAccesoPlanta(user.username, user.perfil_id, plantaKey)) {
        throw new Error('PLANTA_NO_AUTORIZADA');
    }
};

const productoInventariableEnSede = async (queryable, plantaKey, productoInventariableId = null, bloquear = false) => {
    const result = await queryable.query(`
        SELECT pi.id, pi.codigo, pi.nombre,
               COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id) AS producto_facturacion_id,
               pis.precio, pis.activo, pis.stock_permitido, pis.venta_habilitada,
               CASE
                   WHEN pf.id IS NOT NULL
                    AND pf.activo = TRUE
                    AND pf.es_para_venta = TRUE
                    AND UPPER(BTRIM(pf.unidad)) IN ('NIU', 'ZZ')
                    AND BTRIM(pf.tipo_afectacion_igv) = '10'
                    AND (
                        COALESCE(BTRIM(pf.codigo_clasificacion_sunat), '') = ''
                        OR BTRIM(pf.codigo_clasificacion_sunat) ~ '^\\d{8}$'
                    )
                   THEN TRUE ELSE FALSE
               END AS producto_fiscal_valido
        FROM fg_producto_inventariable pi
        JOIN fg_producto_inventariable_sede pis ON pis.producto_inventariable_id = pi.id
        JOIN fg_planta p ON p.key = pis.planta_key AND p.activo = TRUE
        LEFT JOIN fg_producto_facturacion pf
          ON pf.id = COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id)
        WHERE pi.activo = TRUE AND pis.planta_key = $1
          AND (($2::bigint IS NULL AND pi.codigo = 'CHIP') OR pi.id = $2::bigint)
          AND pis.activo = TRUE${bloquear ? ' FOR UPDATE OF pis' : ''}
    `, [plantaKey, productoInventariableId]);
    if (!result.rowCount) throw new Error('PRODUCTO_INVENTARIABLE_NO_CONFIGURADO_SEDE');
    return result.rows[0];
};

const productoChip = (queryable, plantaKey, bloquear = false) =>
    productoInventariableEnSede(queryable, plantaKey, null, bloquear);

const exigirStockPermitido = (config) => {
    if (config.stock_permitido !== true) throw new Error('STOCK_CHIP_NO_PERMITIDO');
};

const exigirVentaHabilitada = (config) => {
    if (config.venta_habilitada !== true) throw new Error('VENTA_CHIP_NO_HABILITADA');
    if (config.producto_fiscal_valido !== true) throw new Error('PRODUCTO_FISCAL_CHIP_INVALIDO');
};

exports.listar = async ({ plantaKey, productoInventariableId, estado, buscar, page = 1, pageSize = 50 }, user) => {
    await validarAcceso(user, plantaKey);
    const params = [plantaKey];
    const filtros = ['c.planta_actual_key = $1'];
    if (productoInventariableId) {
        params.push(Number(productoInventariableId));
        filtros.push(`c.producto_inventariable_id = $${params.length}`);
    }
    if (estado) { params.push(estado); filtros.push(`c.estado = $${params.length}`); }
    if (buscar) { params.push(`%${buscar}%`); filtros.push(`c.numero_chip ILIKE $${params.length}`); }
    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    params.push(limit, offset);
    const result = await db.query(`
        SELECT c.id, c.numero_chip, c.estado, c.planta_actual_key, p.nombre planta_nombre,
               c.producto_inventariable_id, pi.codigo producto_codigo, pi.nombre producto_nombre,
               c.creado_en, c.actualizado_en,
               (SELECT MAX(m.fecha) FROM fg_chip_movimiento m WHERE m.chip_id=c.id) ultimo_movimiento,
               COUNT(*) OVER()::int total
        FROM fg_chip c
        JOIN fg_planta p ON p.key=c.planta_actual_key
        JOIN fg_producto_inventariable pi ON pi.id=c.producto_inventariable_id
        WHERE ${filtros.join(' AND ')} ORDER BY c.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    return { items: result.rows, total: result.rows[0]?.total || 0 };
};

exports.resumen = async (plantaKey, user, productoInventariableId = null) => {
    await validarAcceso(user, plantaKey);
    const config = await productoInventariableEnSede(db, plantaKey, productoInventariableId);
    const result = await db.query(`
        SELECT COUNT(*)::int total,
               COUNT(*) FILTER (WHERE estado='DISPONIBLE')::int disponibles,
               COUNT(*) FILTER (WHERE estado='RESERVADO')::int reservados,
               COUNT(*) FILTER (WHERE estado='VENDIDO')::int vendidos,
               COUNT(*) FILTER (WHERE estado='BAJA')::int baja
        FROM fg_chip WHERE planta_actual_key=$1 AND producto_inventariable_id=$2
    `, [plantaKey, config.id]);
    return {
        ...result.rows[0],
        productoInventariableId: Number(config.id),
        productoCodigo: config.codigo,
        productoNombre: config.nombre,
        precio: Number(config.precio),
        stockPermitido: config.stock_permitido === true,
        ventaHabilitada: config.venta_habilitada === true,
        mappingFiscalCompleto: config.producto_fiscal_valido === true
    };
};

exports.consultarDisponibilidad = async ({ plantaKey, numeroChip, certificadoId }, user) => {
    await validarAcceso(user, plantaKey);
    const numero = normalizarNumeroChip(numeroChip);
    if (!esNumeroChipCertificadoValido(numero)) throw new Error('NUMERO_CHIP_INVALIDO');
    exigirStockPermitido(await productoChip(db, plantaKey));

    const idCertificado = certificadoId === undefined || certificadoId === null || certificadoId === ''
        ? null
        : Number(certificadoId);
    if (idCertificado !== null && (!Number.isSafeInteger(idCertificado) || idCertificado <= 0)) {
        throw new Error('CERTIFICADO_INVALIDO');
    }
    if (idCertificado !== null) {
        const certificado = await db.query(
            'SELECT planta_key FROM fg_certificado WHERE id = $1',
            [idCertificado]
        );
        if (!certificado.rowCount || certificado.rows[0].planta_key !== plantaKey) {
            throw new Error('CERTIFICADO_INVALIDO');
        }
    }

    const result = await db.query(`
        SELECT c.id, c.numero_chip, c.estado, c.planta_actual_key,
               p.nombre AS planta_nombre,
               cc.certificado_id
        FROM fg_chip c
        JOIN fg_planta p ON p.key = c.planta_actual_key
        LEFT JOIN fg_certificado_chip cc ON cc.chip_id = c.id
        WHERE c.numero_chip = $1
    `, [numero]);

    if (!result.rowCount) {
        return {
            numeroChip: numero,
            encontrado: false,
            disponible: false,
            asignadoAlCertificado: false,
            codigo: 'CHIP_NO_ENCONTRADO'
        };
    }

    const chip = result.rows[0];
    const asignadoAlCertificado = idCertificado !== null
        && Number(chip.certificado_id) === idCertificado;
    let codigo = 'CHIP_NO_DISPONIBLE';
    if (chip.planta_actual_key !== plantaKey) codigo = 'CHIP_OTRA_SEDE';
    else if (asignadoAlCertificado && chip.estado === 'RESERVADO') codigo = 'ASIGNADO_CERTIFICADO';
    else if (chip.estado === 'DISPONIBLE') codigo = 'DISPONIBLE';

    return {
        id: Number(chip.id),
        numeroChip: chip.numero_chip,
        encontrado: true,
        disponible: codigo === 'DISPONIBLE' || codigo === 'ASIGNADO_CERTIFICADO',
        asignadoAlCertificado,
        estado: chip.estado,
        plantaNombre: chip.planta_nombre,
        codigo
    };
};

exports.ingresar = async ({ plantaKey, numeros, referencia }, user) => {
    await validarAcceso(user, plantaKey);
    const lote = normalizarLoteScanner(Array.isArray(numeros) ? numeros.join('\n') : numeros);
    if (!lote.validos.length || lote.duplicados.length || lote.errores.length) {
        const error = new Error('LOTE_CHIPS_INVALIDO'); error.detalles = lote; throw error;
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const producto = await productoChip(client, plantaKey, true);
        exigirStockPermitido(producto);
        const existentes = await client.query('SELECT numero_chip FROM fg_chip WHERE numero_chip = ANY($1::varchar[])', [lote.validos]);
        if (existentes.rowCount) {
            const error = new Error('CHIP_DUPLICADO'); error.detalles = existentes.rows.map(r => r.numero_chip); throw error;
        }
        const creados = [];
        for (const numero of lote.validos) {
            const chip = await client.query(`INSERT INTO fg_chip
                (producto_inventariable_id,numero_chip,planta_actual_key,creado_por)
                VALUES ($1,$2,$3,$4) RETURNING id,numero_chip,estado`, [producto.id, numero, plantaKey, user.username]);
            creados.push(chip.rows[0]);
            await client.query(`INSERT INTO fg_chip_movimiento
                (chip_id,tipo_movimiento,planta_destino_key,usuario,referencia)
                VALUES ($1,'INGRESO',$2,$3,$4)`, [chip.rows[0].id, plantaKey, user.username, referencia || null]);
        }
        await client.query('COMMIT'); return creados;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
};

exports.transferir = async ({ origenKey, destinoKey, numeros, referencia }, user) => {
    if (origenKey === destinoKey) throw new Error('SEDES_IGUALES');
    await validarAcceso(user, origenKey); await validarAcceso(user, destinoKey);
    const lote = normalizarLoteScanner(Array.isArray(numeros) ? numeros.join('\n') : numeros);
    if (!lote.validos.length || lote.duplicados.length || lote.errores.length) throw new Error('LOTE_CHIPS_INVALIDO');
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const configuracionDestino = await productoChip(client, destinoKey, true);
        exigirStockPermitido(configuracionDestino);
        const chips = await client.query(`SELECT id,numero_chip,estado,planta_actual_key FROM fg_chip
            WHERE numero_chip=ANY($1::varchar[]) ORDER BY id FOR UPDATE`, [lote.validos]);
        if (chips.rowCount !== lote.validos.length) throw new Error('CHIP_NO_ENCONTRADO');
        for (const chip of chips.rows) {
            if (chip.planta_actual_key !== origenKey) throw new Error('CHIP_OTRA_SEDE');
            if (chip.estado !== 'DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');
            await client.query(`UPDATE fg_chip SET planta_actual_key=$2,actualizado_por=$3,actualizado_en=NOW() WHERE id=$1`, [chip.id,destinoKey,user.username]);
            await client.query(`INSERT INTO fg_chip_movimiento
                (chip_id,tipo_movimiento,planta_origen_key,planta_destino_key,usuario,referencia)
                VALUES ($1,'TRANSFERENCIA',$2,$3,$4,$5)`, [chip.id,origenKey,destinoKey,user.username,referencia||null]);
        }
        await client.query('COMMIT'); return chips.rowCount;
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
};

exports.reservar = async ({ plantaKey, numeroChip, operacionId, certificadoId }, user) => {
    await validarAcceso(user, plantaKey);
    const numero = normalizarNumeroChip(numeroChip);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const config = await productoChip(client, plantaKey, true);
        exigirStockPermitido(config);
        const chipRes = await client.query('SELECT * FROM fg_chip WHERE numero_chip=$1 FOR UPDATE', [numero]);
        if (!chipRes.rowCount) throw new Error('CHIP_NO_ENCONTRADO');
        const chip = chipRes.rows[0];
        if (chip.planta_actual_key !== plantaKey) throw new Error('CHIP_OTRA_SEDE');
        if (chip.estado !== 'DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');
        const op = await client.query('SELECT id,planta_key,estado FROM fg_operacion_comercial WHERE id=$1 FOR UPDATE', [operacionId]);
        if (!op.rowCount || op.rows[0].planta_key !== plantaKey || !['BORRADOR','PENDIENTE_PAGO'].includes(op.rows[0].estado)) throw new Error('OPERACION_NO_RESERVABLE');
        if (certificadoId) {
            const cert = await client.query('SELECT id,planta_key FROM fg_certificado WHERE id=$1', [certificadoId]);
            if (!cert.rowCount || cert.rows[0].planta_key !== plantaKey) throw new Error('CERTIFICADO_INVALIDO');
            await client.query('INSERT INTO fg_certificado_chip(certificado_id,chip_id) VALUES($1,$2)', [certificadoId,chip.id]);
        }
        await client.query(`UPDATE fg_chip SET estado='RESERVADO',operacion_reserva_id=$2,reservado_en=NOW(),actualizado_por=$3,actualizado_en=NOW() WHERE id=$1`, [chip.id,operacionId||null,user.username]);
        await client.query(`INSERT INTO fg_chip_movimiento(chip_id,tipo_movimiento,planta_origen_key,usuario,certificado_id,operacion_comercial_id)
            VALUES($1,'RESERVA',$2,$3,$4,$5)`, [chip.id,plantaKey,user.username,certificadoId||null,operacionId||null]);
        await client.query('COMMIT'); return { id: chip.id, numeroChip: chip.numero_chip, estado: 'RESERVADO' };
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
};

exports.liberar = async ({ plantaKey, numeroChip, operacionId, referencia }, user) => {
    await validarAcceso(user, plantaKey); const numero=normalizarNumeroChip(numeroChip);
    const client=await db.connect();
    try { await client.query('BEGIN');
        const r=await client.query('SELECT * FROM fg_chip WHERE numero_chip=$1 FOR UPDATE',[numero]);
        if(!r.rowCount) throw new Error('CHIP_NO_ENCONTRADO'); const chip=r.rows[0];
        if(chip.planta_actual_key!==plantaKey) throw new Error('CHIP_OTRA_SEDE');
        if(chip.estado!=='RESERVADO' || Number(chip.operacion_reserva_id)!==Number(operacionId)) throw new Error('RESERVA_NO_COINCIDE');
        await client.query('DELETE FROM fg_certificado_chip WHERE chip_id=$1',[chip.id]);
        await client.query(`UPDATE fg_chip SET estado='DISPONIBLE',operacion_reserva_id=NULL,reservado_en=NULL,actualizado_por=$2,actualizado_en=NOW() WHERE id=$1`,[chip.id,user.username]);
        await client.query(`INSERT INTO fg_chip_movimiento(chip_id,tipo_movimiento,planta_origen_key,usuario,operacion_comercial_id,referencia) VALUES($1,'LIBERACION',$2,$3,$4,$5)`,[chip.id,plantaKey,user.username,operacionId,referencia||null]);
        await client.query('COMMIT');
    } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
};

exports.iniciarVentaSoloChip = async ({ plantaKey, numeroChip, clienteId }, user) => {
    await validarAcceso(user, plantaKey);
    const numero = normalizarNumeroChip(numeroChip);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const config = await productoChip(client, plantaKey, true);
        exigirStockPermitido(config);
        exigirVentaHabilitada(config);

        const chipRes = await client.query('SELECT * FROM fg_chip WHERE numero_chip=$1 FOR UPDATE', [numero]);
        if (!chipRes.rowCount) throw new Error('CHIP_NO_ENCONTRADO');
        const chip = chipRes.rows[0];
        if (chip.planta_actual_key !== plantaKey) throw new Error('CHIP_OTRA_SEDE');
        if (chip.estado !== 'DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');

        const pf = await client.query('SELECT * FROM fg_producto_facturacion WHERE id=$1', [config.producto_facturacion_id]);
        if (!pf.rowCount) throw new Error('PRODUCTO_FISCAL_CHIP_INVALIDO');
        const pfData = pf.rows[0];

        const base = redondear(Number(config.precio) / 1.18);
        const igv = redondear(Number(config.precio) - base);

        const operacion = await client.query(`
            INSERT INTO fg_operacion_comercial (
                planta_key, cliente_id, moneda_key, base_imponible, igv,
                importe_total, estado, usuario_creacion
            ) VALUES ($1,$2,'sol',$3,$4,$5,'PENDIENTE_PAGO',$6) RETURNING id
        `, [plantaKey, clienteId || null, base, igv, Number(config.precio), user.username]);
        const operacionId = Number(operacion.rows[0].id);

        await client.query(`
            INSERT INTO fg_operacion_detalle (
                operacion_id, tipo_item, cantidad, codigo_sku_snapshot, descripcion_snapshot,
                unidad_snapshot, afectacion_igv_snapshot, codigo_sunat_snapshot,
                producto_facturacion_id, valor_unitario, precio_unitario, base_imponible, igv,
                importe_total, genera_certificado_snapshot, orden
            ) VALUES ($1,'PRODUCTO',1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,$9,FALSE,1)
        `, [
            operacionId,
            pfData.codigo_sku,
            pfData.descripcion,
            pfData.unidad,
            pfData.tipo_afectacion_igv,
            pfData.codigo_clasificacion_sunat,
            pfData.id,
            base,
            Number(config.precio),
            igv
        ]);

        await client.query(`UPDATE fg_chip SET estado='RESERVADO',operacion_reserva_id=$2,reservado_en=NOW(),actualizado_por=$3,actualizado_en=NOW() WHERE id=$1`, [chip.id,operacionId,user.username]);
        await client.query(`INSERT INTO fg_chip_movimiento(chip_id,tipo_movimiento,planta_origen_key,usuario,operacion_comercial_id)
            VALUES($1,'RESERVA',$2,$3,$4)`, [chip.id,plantaKey,user.username,operacionId]);
        
        await client.query('COMMIT');
        return { operacionId, chipId: chip.id, numeroChip: chip.numero_chip, precio: Number(config.precio) };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.vender = async ({ plantaKey, numeroChip, operacionId, detalleId }, user) => {
    await validarAcceso(user, plantaKey); const numero=normalizarNumeroChip(numeroChip);
    const client=await db.connect();
    try { await client.query('BEGIN');
        const config=await productoChip(client,plantaKey,true);
        exigirStockPermitido(config);
        exigirVentaHabilitada(config);
        const r=await client.query('SELECT * FROM fg_chip WHERE numero_chip=$1 FOR UPDATE',[numero]);
        if(!r.rowCount) throw new Error('CHIP_NO_ENCONTRADO'); const chip=r.rows[0];
        if(chip.planta_actual_key!==plantaKey) throw new Error('CHIP_OTRA_SEDE');
        if(chip.estado!=='RESERVADO' || Number(chip.operacion_reserva_id)!==Number(operacionId)) throw new Error('RESERVA_NO_COINCIDE');
        const op=await client.query('SELECT estado FROM fg_operacion_comercial WHERE id=$1 FOR UPDATE',[operacionId]);
        if(!op.rowCount || !['PAGADO','FACTURADO'].includes(op.rows[0].estado)) throw new Error('OPERACION_NO_PAGADA');
        const detalle=await client.query('SELECT id,operacion_id,producto_facturacion_id FROM fg_operacion_detalle WHERE id=$1',[detalleId]);
        if(!detalle.rowCount || Number(detalle.rows[0].operacion_id)!==Number(operacionId) || Number(detalle.rows[0].producto_facturacion_id)!==Number(config.producto_facturacion_id)) throw new Error('DETALLE_CHIP_INVALIDO');
        await client.query('INSERT INTO fg_operacion_detalle_chip(operacion_detalle_id,chip_id) VALUES($1,$2)',[detalleId,chip.id]);
        await client.query(`UPDATE fg_chip SET estado='VENDIDO',operacion_reserva_id=NULL,reservado_en=NULL,actualizado_por=$2,actualizado_en=NOW() WHERE id=$1`,[chip.id,user.username]);
        await client.query(`INSERT INTO fg_chip_movimiento(chip_id,tipo_movimiento,planta_origen_key,usuario,operacion_comercial_id) VALUES($1,'VENTA',$2,$3,$4)`,[chip.id,plantaKey,user.username,operacionId]);
        await client.query('COMMIT');
    } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
};

exports.baja = async ({ plantaKey, numeroChip, referencia }, user) => {
    await validarAcceso(user,plantaKey); const numero=normalizarNumeroChip(numeroChip); const client=await db.connect();
    try{await client.query('BEGIN'); const r=await client.query('SELECT * FROM fg_chip WHERE numero_chip=$1 FOR UPDATE',[numero]);
        if(!r.rowCount) throw new Error('CHIP_NO_ENCONTRADO'); const chip=r.rows[0];
        if(chip.planta_actual_key!==plantaKey) throw new Error('CHIP_OTRA_SEDE'); if(chip.estado!=='DISPONIBLE') throw new Error('CHIP_NO_DISPONIBLE');
        await client.query(`UPDATE fg_chip SET estado='BAJA',actualizado_por=$2,actualizado_en=NOW() WHERE id=$1`,[chip.id,user.username]);
        await client.query(`INSERT INTO fg_chip_movimiento(chip_id,tipo_movimiento,planta_origen_key,usuario,referencia) VALUES($1,'BAJA',$2,$3,$4)`,[chip.id,plantaKey,user.username,referencia||null]); await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
};

exports.historial = async (id, user) => {
    const chip=await db.query('SELECT planta_actual_key FROM fg_chip WHERE id=$1',[id]);
    if(!chip.rowCount) throw new Error('CHIP_NO_ENCONTRADO'); await validarAcceso(user,chip.rows[0].planta_actual_key);
    const r=await db.query(`SELECT m.*,po.nombre planta_origen,pd.nombre planta_destino FROM fg_chip_movimiento m
        LEFT JOIN fg_planta po ON po.key=m.planta_origen_key LEFT JOIN fg_planta pd ON pd.key=m.planta_destino_key
        WHERE m.chip_id=$1 ORDER BY m.fecha DESC,m.id DESC`,[id]); return r.rows;
};
