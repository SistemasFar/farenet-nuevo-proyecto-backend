const db = require('../../../config/database');

exports.obtenerTiposActivos = async () => {
    const res = await db.query(`
        SELECT clave, codigo, nombre 
        FROM fg_tipo_certificado 
        WHERE activo = true 
        ORDER BY codigo
    `);
    return res.rows;
};

exports.obtenerCorrelativos = async (filters) => {
    let q = `
        SELECT c.id, c.planta_key AS "plantaKey", p.nombre AS "plantaNombre",
               c.tipo_certificado_clave AS "tipoClave", t.codigo AS "tipoCodigo", t.nombre AS "tipoNombre",
               c.nro_inicio AS "nroInicio", c.nro_actual AS "nroActual", c.nro_maximo AS "nroMaximo",
               c.activo, (c.nro_maximo - c.nro_actual) AS disponibles,
               (c.nro_actual >= c.nro_maximo) AS agotado,
               c.fecha_asignacion AS "fechaAsignacion", c.fecha_cierre AS "fechaCierre"
        FROM fg_correlativo_certificado c
        JOIN fg_planta p ON p.key = c.planta_key
        JOIN fg_tipo_certificado t ON t.clave = c.tipo_certificado_clave
        WHERE 1=1
    `;
    const params = [];
    if (filters.plantaKey) {
        params.push(filters.plantaKey);
        q += ` AND c.planta_key = $${params.length}`;
    }
    if (filters.tipo) {
        params.push(filters.tipo);
        q += ` AND c.tipo_certificado_clave = $${params.length}`;
    }
    q += ` ORDER BY c.planta_key, c.tipo_certificado_clave, c.fecha_asignacion DESC`;
    const res = await db.query(q, params);
    return res.rows;
};

exports.obtenerRangoActivo = async (plantaKey, tipo) => {
    const q = `
        SELECT c.id, c.planta_key AS "plantaKey", p.nombre AS "plantaNombre",
               c.tipo_certificado_clave AS "tipoClave", t.codigo AS "tipoCodigo", t.nombre AS "tipoNombre",
               c.nro_inicio AS "nroInicio", c.nro_actual AS "nroActual", c.nro_maximo AS "nroMaximo",
               c.activo, (c.nro_maximo - c.nro_actual) AS disponibles,
               (c.nro_actual >= c.nro_maximo) AS agotado,
               c.fecha_asignacion AS "fechaAsignacion", c.fecha_cierre AS "fechaCierre"
        FROM fg_correlativo_certificado c
        JOIN fg_planta p ON p.key = c.planta_key
        JOIN fg_tipo_certificado t ON t.clave = c.tipo_certificado_clave
        WHERE c.planta_key = $1 AND c.tipo_certificado_clave = $2 AND c.activo = true
    `;
    const res = await db.query(q, [plantaKey, tipo]);
    if (res.rowCount === 0) throw new Error('RANGO_NOT_FOUND');
    return res.rows[0];
};

exports.crearRango = async (data) => {
    const { plantaKey, tipoCertificadoClave, nroInicio, nroMaximo } = data;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const pRes = await client.query('SELECT 1 FROM fg_planta WHERE key = $1', [plantaKey]);
        if (pRes.rowCount === 0) throw new Error('PLANTA_NOT_FOUND');
        
        const tRes = await client.query('SELECT activo FROM fg_tipo_certificado WHERE clave = $1', [tipoCertificadoClave]);
        if (tRes.rowCount === 0) throw new Error('TIPO_NOT_FOUND');
        if (!tRes.rows[0].activo) throw new Error('TIPO_INACTIVO');
        
        const actRes = await client.query('SELECT id FROM fg_correlativo_certificado WHERE planta_key = $1 AND tipo_certificado_clave = $2 AND activo = true', [plantaKey, tipoCertificadoClave]);
        if (actRes.rowCount > 0) throw new Error('RANGO_ACTIVO_EXISTENTE');
        
        const nroActual = nroInicio - 1;
        
        const q = `
            INSERT INTO fg_correlativo_certificado 
            (planta_key, tipo_certificado_clave, nro_inicio, nro_actual, nro_maximo, activo, fecha_cierre) 
            VALUES ($1, $2, $3, $4, $5, true, NULL)
            RETURNING id
        `;
        const res = await client.query(q, [plantaKey, tipoCertificadoClave, nroInicio, nroActual, nroMaximo]);
        
        await client.query('COMMIT');
        return { id: res.rows[0].id };
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23P01' || e.constraint === 'excl_fg_correlativo_rango') {
            throw new Error('RANGO_SOLAPADO');
        }
        if (e.constraint === 'fg_correlativo_certificado_hist_key') {
            throw new Error('RANGO_DUPLICADO');
        }
        if (e.code === '23505' && e.constraint === 'fg_correlativo_certificado_activo_idx') {
            throw new Error('RANGO_ACTIVO_EXISTENTE');
        }
        throw e;
    } finally {
        client.release();
    }
};

exports.cerrarRango = async (id) => {
    const qCheck = 'SELECT activo FROM fg_correlativo_certificado WHERE id = $1';
    const resCheck = await db.query(qCheck, [id]);
    if (resCheck.rowCount === 0) throw new Error('RANGO_NOT_FOUND');
    
    if (!resCheck.rows[0].activo) {
        return { message: 'El rango ya se encontraba cerrado' };
    }
    
    const qUp = `
        UPDATE fg_correlativo_certificado 
        SET activo = false, fecha_cierre = CURRENT_TIMESTAMP, fecha_modificacion = CURRENT_TIMESTAMP 
        WHERE id = $1
    `;
    await db.query(qUp, [id]);
    return { message: 'Rango cerrado correctamente' };
};

// ============================================
// FASE 3: BORRADORES DE CERTIFICADOS
// ============================================

const faregasAuthService = require('./faregas-auth.service');

// Función helper para validar si el usuario puede acceder a la planta del certificado
const validarAccesoCertificado = async (username, perfilId, plantaKey) => {
    const acceso = await faregasAuthService.validarAccesoPlanta(username, perfilId, plantaKey);
    if (!acceso) {
        throw new Error('PLANTA_NO_AUTORIZADA');
    }
};

exports.crearBorrador = async (data, userContext) => {
    // data: tipoCertificadoClave, clienteId, observaciones
    // userContext: username, perfil_id, planta_key
    
    const { tipoCertificadoClave, clienteId, observaciones } = data;
    const { username, planta_key } = userContext;

    // Validar tipo
    const tipo = await db.query('SELECT activo FROM fg_tipo_certificado WHERE clave = $1', [tipoCertificadoClave]);
    if (tipo.rowCount === 0) throw new Error('TIPO_NOT_FOUND');
    if (!tipo.rows[0].activo) throw new Error('TIPO_INACTIVO');

    // Validar cliente si viene informado
    if (clienteId) {
        const cli = await db.query('SELECT estado FROM fg_cliente WHERE id = $1', [clienteId]);
        if (cli.rowCount === 0) throw new Error('CLIENTE_NOT_FOUND');
        if (!cli.rows[0].estado) throw new Error('CLIENTE_INACTIVO');
    }

    const q = `
        INSERT INTO fg_certificado (
            tipo_certificado_clave, cliente_id, planta_key, 
            numero_certificado, fecha_emision, estado, 
            observaciones, usuario_creacion, usuario_modificacion
        ) VALUES (
            $1, $2, $3, NULL, NULL, 'BORRADOR', $4, $5, $5
        ) RETURNING id, estado
    `;
    const res = await db.query(q, [
        tipoCertificadoClave, 
        clienteId || null, 
        planta_key, 
        observaciones || null, 
        username
    ]);

    return res.rows[0];
};

exports.obtenerBorradorCompleto = async (id, userContext) => {
    // Cabecera
    const qCab = `
        SELECT c.*, 
               t.codigo AS tipo_codigo, t.nombre AS tipo_nombre,
               p.nombre AS planta_nombre,
               cl.tipo_documento AS cliente_tipo_doc, cl.nro_documento AS cliente_nro_doc, cl.nombre_razon_social AS cliente_nombre
        FROM fg_certificado c
        LEFT JOIN fg_tipo_certificado t ON c.tipo_certificado_clave = t.clave
        LEFT JOIN fg_planta p ON c.planta_key = p.key
        LEFT JOIN fg_cliente cl ON c.cliente_id = cl.id
        WHERE c.id = $1
    `;
    const resCab = await db.query(qCab, [id]);
    if (resCab.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    
    const cert = resCab.rows[0];

    // Validar politica de planta
    await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);

    // Snapshot Vehicular
    const qVeh = `SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1`;
    const resVeh = await db.query(qVeh, [id]);
    
    // Titulares
    const qTit = `SELECT * FROM fg_certificado_titular WHERE certificado_id = $1 ORDER BY orden ASC`;
    const resTit = await db.query(qTit, [id]);

    return {
        id: cert.id,
        estado: cert.estado,
        tipo: {
            clave: cert.tipo_certificado_clave,
            codigo: cert.tipo_codigo,
            nombre: cert.tipo_nombre
        },
        planta: {
            key: cert.planta_key,
            nombre: cert.planta_nombre
        },
        cliente: cert.cliente_id ? {
            id: cert.cliente_id,
            tipoDocumento: cert.cliente_tipo_doc,
            nroDocumento: cert.cliente_nro_doc,
            nombreRazonSocial: cert.cliente_nombre
        } : null,
        numeroCertificado: cert.numero_certificado,
        fechaEmision: cert.fecha_emision,
        observaciones: cert.observaciones,
        vehiculo: resVeh.rowCount > 0 ? resVeh.rows[0] : null,
        titulares: resTit.rows
    };
};

exports.actualizarBorrador = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const qCheck = `SELECT estado, planta_key FROM fg_certificado WHERE id = $1 FOR UPDATE`;
        const rCheck = await client.query(qCheck, [id]);
        if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCheck.rows[0];

        await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);

        if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        const campos = [];
        const values = [];
        let idx = 1;

        if (data.clienteId !== undefined) {
            campos.push(`cliente_id = $${idx++}`);
            values.push(data.clienteId);
        }
        if (data.observaciones !== undefined) {
            campos.push(`observaciones = $${idx++}`);
            values.push(data.observaciones);
        }
        if (data.tipoCertificadoClave !== undefined) {
            const tipo = await client.query('SELECT activo FROM fg_tipo_certificado WHERE clave = $1', [data.tipoCertificadoClave]);
            if (tipo.rowCount === 0) throw new Error('TIPO_NOT_FOUND');
            if (!tipo.rows[0].activo) throw new Error('TIPO_INACTIVO');
            campos.push(`tipo_certificado_clave = $${idx++}`);
            values.push(data.tipoCertificadoClave);
        }

        if (campos.length > 0) {
            campos.push(`usuario_modificacion = $${idx++}`);
            values.push(userContext.username);
            campos.push(`fecha_modificacion = CURRENT_TIMESTAMP`);
            
            values.push(id);
            const qUpd = `UPDATE fg_certificado SET ${campos.join(', ')} WHERE id = $${idx}`;
            await client.query(qUpd, values);
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.guardarVehiculoBorrador = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const qCheck = `SELECT estado, planta_key FROM fg_certificado WHERE id = $1 FOR UPDATE`;
        const rCheck = await client.query(qCheck, [id]);
        if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCheck.rows[0];

        await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
        if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        const qUpd = `
            INSERT INTO fg_certificado_vehiculo (
                certificado_id, placa, categoria, clase, marca, modelo, version, anio_fabricacion, 
                anio_modelo, vin, serie_chasis, numero_motor, combustible, color, carroceria, 
                numero_cilindros, cilindrada, numero_ejes, numero_ruedas, numero_asientos, 
                numero_pasajeros, longitud, ancho, alto, peso_neto, peso_bruto, carga_util, 
                potencia, formula_rodante
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 
                $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
            )
            ON CONFLICT (certificado_id) DO UPDATE SET
                placa = EXCLUDED.placa,
                categoria = EXCLUDED.categoria,
                clase = EXCLUDED.clase,
                marca = EXCLUDED.marca,
                modelo = EXCLUDED.modelo,
                version = EXCLUDED.version,
                anio_fabricacion = EXCLUDED.anio_fabricacion,
                anio_modelo = EXCLUDED.anio_modelo,
                vin = EXCLUDED.vin,
                serie_chasis = EXCLUDED.serie_chasis,
                numero_motor = EXCLUDED.numero_motor,
                combustible = EXCLUDED.combustible,
                color = EXCLUDED.color,
                carroceria = EXCLUDED.carroceria,
                numero_cilindros = EXCLUDED.numero_cilindros,
                cilindrada = EXCLUDED.cilindrada,
                numero_ejes = EXCLUDED.numero_ejes,
                numero_ruedas = EXCLUDED.numero_ruedas,
                numero_asientos = EXCLUDED.numero_asientos,
                numero_pasajeros = EXCLUDED.numero_pasajeros,
                longitud = EXCLUDED.longitud,
                ancho = EXCLUDED.ancho,
                alto = EXCLUDED.alto,
                peso_neto = EXCLUDED.peso_neto,
                peso_bruto = EXCLUDED.peso_bruto,
                carga_util = EXCLUDED.carga_util,
                potencia = EXCLUDED.potencia,
                formula_rodante = EXCLUDED.formula_rodante
        `;

        await client.query(qUpd, [
            id,
            data.placa || null,
            data.categoria || null,
            data.clase || null,
            data.marca || null,
            data.modelo || null,
            data.version || null,
            data.anioFabricacion || null,
            data.anioModelo || null,
            data.vin || null,
            data.serieChasis || null,
            data.numeroMotor || null,
            data.combustible || null,
            data.color || null,
            data.carroceria || null,
            data.numeroCilindros || null,
            data.cilindrada || null,
            data.numeroEjes || null,
            data.numeroRuedas || null,
            data.numeroAsientos || null,
            data.numeroPasajeros || null,
            data.longitud || null,
            data.ancho || null,
            data.alto || null,
            data.pesoNeto || null,
            data.pesoBruto || null,
            data.cargaUtil || null,
            data.potencia || null,
            data.formulaRodante || null
        ]);

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.agregarTitular = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const qCheck = `SELECT estado, planta_key FROM fg_certificado WHERE id = $1 FOR UPDATE`;
        const rCheck = await client.query(qCheck, [id]);
        if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCheck.rows[0];

        await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
        if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        if (data.clienteId) {
            const cli = await client.query('SELECT estado FROM fg_cliente WHERE id = $1', [data.clienteId]);
            if (cli.rowCount === 0) throw new Error('CLIENTE_NOT_FOUND');
        }

        const qIns = `
            INSERT INTO fg_certificado_titular (
                certificado_id, cliente_id, orden, tipo_documento, nro_documento, nombre_razon_social, direccion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
        `;
        const res = await client.query(qIns, [
            id,
            data.clienteId || null,
            data.orden,
            data.tipoDocumento || null,
            data.nroDocumento || null,
            data.nombreRazonSocial,
            data.direccion || null
        ]);

        await client.query('COMMIT');
        return res.rows[0].id;
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505' && e.constraint === 'fg_certificado_titular_certificado_id_orden_key') {
            throw new Error('ORDEN_TITULAR_DUPLICADO');
        }
        throw e;
    } finally {
        client.release();
    }
};

exports.actualizarTitular = async (id, titularId, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const qCheck = `SELECT estado, planta_key FROM fg_certificado WHERE id = $1 FOR UPDATE`;
        const rCheck = await client.query(qCheck, [id]);
        if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCheck.rows[0];

        await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
        if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        const qTit = `SELECT id FROM fg_certificado_titular WHERE id = $1 AND certificado_id = $2`;
        const rTit = await client.query(qTit, [titularId, id]);
        if (rTit.rowCount === 0) throw new Error('TITULAR_NOT_FOUND');

        if (data.clienteId) {
            const cli = await client.query('SELECT estado FROM fg_cliente WHERE id = $1', [data.clienteId]);
            if (cli.rowCount === 0) throw new Error('CLIENTE_NOT_FOUND');
        }

        const campos = [];
        const values = [];
        let idx = 1;

        if (data.clienteId !== undefined) { campos.push(`cliente_id = $${idx++}`); values.push(data.clienteId); }
        if (data.orden !== undefined) { campos.push(`orden = $${idx++}`); values.push(data.orden); }
        if (data.tipoDocumento !== undefined) { campos.push(`tipo_documento = $${idx++}`); values.push(data.tipoDocumento); }
        if (data.nroDocumento !== undefined) { campos.push(`nro_documento = $${idx++}`); values.push(data.nroDocumento); }
        if (data.nombreRazonSocial !== undefined) { campos.push(`nombre_razon_social = $${idx++}`); values.push(data.nombreRazonSocial); }
        if (data.direccion !== undefined) { campos.push(`direccion = $${idx++}`); values.push(data.direccion); }

        if (campos.length > 0) {
            values.push(titularId);
            const qUpd = `UPDATE fg_certificado_titular SET ${campos.join(', ')} WHERE id = $${idx}`;
            await client.query(qUpd, values);
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505' && e.constraint === 'fg_certificado_titular_certificado_id_orden_key') {
            throw new Error('ORDEN_TITULAR_DUPLICADO');
        }
        throw e;
    } finally {
        client.release();
    }
};

exports.eliminarTitular = async (id, titularId, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const qCheck = `SELECT estado, planta_key FROM fg_certificado WHERE id = $1 FOR UPDATE`;
        const rCheck = await client.query(qCheck, [id]);
        if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCheck.rows[0];

        await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
        if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');

        const qDel = `DELETE FROM fg_certificado_titular WHERE id = $1 AND certificado_id = $2 RETURNING id`;
        const res = await client.query(qDel, [titularId, id]);
        
        if (res.rowCount === 0) throw new Error('TITULAR_NOT_FOUND');

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};
