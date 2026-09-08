const db = require('../../../config/database');
const authService = require('./faregas-auth.service');
const { normalizarNumeroChip, normalizarLoteScanner } = require('./faregas-chips.rules');

const validarAcceso = async (user, plantaKey) => {
    if (!await authService.validarAccesoPlanta(user.username, user.perfil_id, plantaKey)) {
        throw new Error('PLANTA_NO_AUTORIZADA');
    }
};

const productoChip = async (queryable, plantaKey, bloquear = false) => {
    const result = await queryable.query(`
        SELECT pi.id, pi.codigo, pi.nombre, pi.producto_facturacion_id,
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
        LEFT JOIN fg_producto_facturacion pf ON pf.id = pi.producto_facturacion_id
        WHERE pi.codigo = 'CHIP' AND pi.activo = TRUE AND pis.planta_key = $1
          AND pis.activo = TRUE${bloquear ? ' FOR UPDATE OF pis' : ''}
    `, [plantaKey]);
    if (!result.rowCount) throw new Error('CHIP_NO_CONFIGURADO_SEDE');
    return result.rows[0];
};

const exigirStockPermitido = (config) => {
    if (config.stock_permitido !== true) throw new Error('STOCK_CHIP_NO_PERMITIDO');
};

const exigirVentaHabilitada = (config) => {
    if (config.venta_habilitada !== true) throw new Error('VENTA_CHIP_NO_HABILITADA');
    if (config.producto_fiscal_valido !== true) throw new Error('PRODUCTO_FISCAL_CHIP_INVALIDO');
};

exports.listar = async ({ plantaKey, estado, buscar, page = 1, pageSize = 50 }, user) => {
    await validarAcceso(user, plantaKey);
    const params = [plantaKey];
    const filtros = ['c.planta_actual_key = $1'];
    if (estado) { params.push(estado); filtros.push(`c.estado = $${params.length}`); }
    if (buscar) { params.push(`%${buscar}%`); filtros.push(`c.numero_chip ILIKE $${params.length}`); }
    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    params.push(limit, offset);
    const result = await db.query(`
        SELECT c.id, c.numero_chip, c.estado, c.planta_actual_key, p.nombre planta_nombre,
               c.creado_en, c.actualizado_en,
               (SELECT MAX(m.fecha) FROM fg_chip_movimiento m WHERE m.chip_id=c.id) ultimo_movimiento,
               COUNT(*) OVER()::int total
        FROM fg_chip c JOIN fg_planta p ON p.key=c.planta_actual_key
        WHERE ${filtros.join(' AND ')} ORDER BY c.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    return { items: result.rows, total: result.rows[0]?.total || 0 };
};

exports.resumen = async (plantaKey, user) => {
    await validarAcceso(user, plantaKey);
    const result = await db.query(`
        SELECT COUNT(*)::int total,
               COUNT(*) FILTER (WHERE estado='DISPONIBLE')::int disponibles,
               COUNT(*) FILTER (WHERE estado='RESERVADO')::int reservados,
               COUNT(*) FILTER (WHERE estado='VENDIDO')::int vendidos,
               COUNT(*) FILTER (WHERE estado='BAJA')::int baja
        FROM fg_chip WHERE planta_actual_key=$1
    `, [plantaKey]);
    const config = await productoChip(db, plantaKey);
    return {
        ...result.rows[0],
        precio: Number(config.precio),
        stockPermitido: config.stock_permitido === true,
        ventaHabilitada: config.venta_habilitada === true,
        mappingFiscalCompleto: config.producto_fiscal_valido === true
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
        await client.query(`UPDATE fg_chip SET estado='RESERVADO',operacion_reserva_id=$2,reservado_en=NOW(),actualizado_por=$3,actualizado_en=NOW() WHERE id=$1`, [chip.id,operacionId,user.username]);
        await client.query(`INSERT INTO fg_chip_movimiento(chip_id,tipo_movimiento,planta_origen_key,usuario,certificado_id,operacion_comercial_id)
            VALUES($1,'RESERVA',$2,$3,$4,$5)`, [chip.id,plantaKey,user.username,certificadoId||null,operacionId]);
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
