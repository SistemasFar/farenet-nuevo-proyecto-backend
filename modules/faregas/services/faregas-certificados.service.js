const db = require('../../../config/database');
const { paraPlantilla } = require('../mappers/faregas-vehiculo.mapper');

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

exports.obtenerBorradores = async (page = 1, pageSize = 10, userContext) => {
    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 10;
    if (pageSize > 100) pageSize = 100;

    const offset = (page - 1) * pageSize;

    // 1. Obtener plantas permitidas
    const pRes = await faregasAuthService.getPlantasPorUsuario(userContext.username, userContext.perfil_id);
    const plantas = pRes.map(p => p.key);

    if (plantas.length === 0) {
        return { data: [], total: 0, page, pageSize, totalPages: 0 };
    }

    // 2. Construir IN clause
    const inClause = plantas.map((_, i) => '$' + (i + 1)).join(', ');

    const qTotal = `SELECT COUNT(*) FROM fg_certificado WHERE estado = 'BORRADOR' AND planta_key IN (${inClause})`;
    const resTotal = await db.query(qTotal, plantas);
    const total = parseInt(resTotal.rows[0].count);

    if (total === 0) {
        return { data: [], total: 0, page, pageSize, totalPages: 0 };
    }

    const qData = `
        SELECT 
            c.id, 
            c.fecha_creacion as "fechaHora", 
            c.estado,
            v.placa as placa,
            cl.nro_documento as "titularDocumento", 
            cl.nombre_razon_social as "titularNombre",
            t.clave as "tipoCertificadoClave",
            t.nombre as "tipoCertificadoNombre"
        FROM fg_certificado c
        LEFT JOIN fg_certificado_vehiculo v ON c.id = v.certificado_id
        LEFT JOIN fg_certificado_titular cl ON c.id = cl.certificado_id AND cl.orden = 1
        LEFT JOIN fg_tipo_certificado t ON c.tipo_certificado_clave = t.clave
        WHERE c.estado = 'BORRADOR' 
        AND c.planta_key IN (${inClause})
        ORDER BY c.fecha_creacion DESC
        LIMIT $${plantas.length + 1} OFFSET $${plantas.length + 2}
    `;

    const resData = await db.query(qData, [...plantas, pageSize, offset]);

    return {
        data: resData.rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
    };
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
        entidadCertificadoraNombre: cert.entidad_certificadora_nombre,
        resolucionDirectoral: cert.resolucion_directoral,
        domicilioFiscal: cert.domicilio_fiscal,
        telefonoCertificadora: cert.telefono_certificadora,
        lugarEmision: cert.lugar_emision,
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

// ============================================
// FASE 4: DATOS ESPECÍFICOS DE CERTIFICADOS
// ============================================

const obtenerYValidarBorrador = async (client, id, tipoRequerido, userContext) => {
    const qCheck = `SELECT estado, planta_key, tipo_certificado_clave FROM fg_certificado WHERE id = $1 FOR UPDATE`;
    const rCheck = await client.query(qCheck, [id]);
    if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    const cert = rCheck.rows[0];

    await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
    
    if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');
    if (tipoRequerido && cert.tipo_certificado_clave !== tipoRequerido) {
        throw new Error('TIPO_CERTIFICADO_INCORRECTO');
    }
    
    return cert;
};

// ================= GNV =================

exports.guardarGNV = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GNV_ANUAL', userContext);

        let snapshotTaller = null;
        if (data.tallerAutorizadoId) {
            const resTaller = await client.query('SELECT razon_social, sede, direccion, codigo_autorizacion FROM fg_taller_autorizado WHERE id = $1 AND estado = true', [data.tallerAutorizadoId]);
            if (resTaller.rowCount === 0) throw new Error('TALLER_NOT_FOUND');
            snapshotTaller = resTaller.rows[0];
        }

        // Validar modalidad si se envía
        const modalidadGNV = data.modalidad ? data.modalidad.trim().toUpperCase() : null;
        if (modalidadGNV && !['INICIAL', 'ANUAL'].includes(modalidadGNV)) {
            throw new Error('MODALIDAD_GNV_INVALIDA');
        }

        // Validar numero_chip
        let numeroChip = data.numeroChip ? data.numeroChip.trim().toUpperCase() : null;
        if (numeroChip) {
            if (!/^[A-Z0-9]{1,15}$/.test(numeroChip)) {
                throw new Error('NUMERO_CHIP_INVALIDO');
            }
        }

        const qUpd = `
            INSERT INTO fg_certificado_gnv (
                certificado_id, taller_autorizado_id, vigencia_hasta, taller_razon_social, taller_sede, taller_direccion, taller_codigo_autorizacion, modalidad, numero_chip
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (certificado_id) DO UPDATE SET
                taller_autorizado_id = EXCLUDED.taller_autorizado_id,
                vigencia_hasta = EXCLUDED.vigencia_hasta,
                taller_razon_social = EXCLUDED.taller_razon_social,
                taller_sede = EXCLUDED.taller_sede,
                taller_direccion = EXCLUDED.taller_direccion,
                taller_codigo_autorizacion = EXCLUDED.taller_codigo_autorizacion,
                modalidad = EXCLUDED.modalidad,
                numero_chip = EXCLUDED.numero_chip
        `;
        
        await client.query(qUpd, [
            id,
            data.tallerAutorizadoId || null,
            data.vigenciaHasta || null,
            snapshotTaller ? snapshotTaller.razon_social : null,
            snapshotTaller ? snapshotTaller.sede : null,
            snapshotTaller ? snapshotTaller.direccion : null,
            snapshotTaller ? snapshotTaller.codigo_autorizacion : null,
            modalidadGNV,
            numeroChip
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

exports.guardarGNVVerificaciones = async (id, verificaciones, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GNV_ANUAL', userContext);

        await client.query('DELETE FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1', [id]);

        if (verificaciones && verificaciones.length > 0) {
            const qIns = `
                INSERT INTO fg_certificado_gnv_verificacion (certificado_id, codigo, orden, descripcion, cumple, observacion)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            for (const v of verificaciones) {
                await client.query(qIns, [id, v.codigo, v.orden, v.descripcion, v.cumple, v.observacion || null]);
            }
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

exports.obtenerGNV = async (id, userContext) => {
    const qCert = `SELECT planta_key FROM fg_certificado WHERE id = $1`;
    const rCert = await db.query(qCert, [id]);
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    await validarAccesoCertificado(userContext.username, userContext.perfil_id, rCert.rows[0].planta_key);

    const rGnv = await db.query(`SELECT * FROM fg_certificado_gnv WHERE certificado_id = $1`, [id]);
    const rVerif = await db.query(`SELECT * FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1 ORDER BY orden ASC`, [id]);

    return {
        gnv: rGnv.rowCount > 0 ? rGnv.rows[0] : null,
        verificaciones: rVerif.rows
    };
};

// ================= GLP =================

exports.guardarGLP = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GLP_ANUAL', userContext);

        let snapshotTaller = null;
        if (data.tallerAutorizadoId) {
            const resTaller = await client.query('SELECT razon_social, sede, direccion, codigo_autorizacion FROM fg_taller_autorizado WHERE id = $1 AND estado = true', [data.tallerAutorizadoId]);
            if (resTaller.rowCount === 0) throw new Error('TALLER_NOT_FOUND');
            snapshotTaller = resTaller.rows[0];
        }

        // Validar modalidad si se envía
        const modalidadGLP = data.modalidad ? data.modalidad.trim().toUpperCase() : null;
        if (modalidadGLP && !['INICIAL', 'ANUAL'].includes(modalidadGLP)) {
            throw new Error('MODALIDAD_GLP_INVALIDA');
        }

        const qUpd = `
            INSERT INTO fg_certificado_glp (
                certificado_id, taller_autorizado_id, expediente_tecnico, vigencia_hasta, taller_razon_social, taller_sede, taller_direccion, taller_codigo_autorizacion, modalidad
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (certificado_id) DO UPDATE SET
                taller_autorizado_id = EXCLUDED.taller_autorizado_id,
                expediente_tecnico = EXCLUDED.expediente_tecnico,
                vigencia_hasta = EXCLUDED.vigencia_hasta,
                taller_razon_social = EXCLUDED.taller_razon_social,
                taller_sede = EXCLUDED.taller_sede,
                taller_direccion = EXCLUDED.taller_direccion,
                taller_codigo_autorizacion = EXCLUDED.taller_codigo_autorizacion,
                modalidad = EXCLUDED.modalidad
        `;
        
        await client.query(qUpd, [
            id,
            data.tallerAutorizadoId || null,
            data.expedienteTecnico || null,
            data.vigenciaHasta || null,
            snapshotTaller ? snapshotTaller.razon_social : null,
            snapshotTaller ? snapshotTaller.sede : null,
            snapshotTaller ? snapshotTaller.direccion : null,
            snapshotTaller ? snapshotTaller.codigo_autorizacion : null,
            modalidadGLP
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

exports.guardarGLPComponentes = async (id, componentes, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GLP_ANUAL', userContext);

        await client.query('DELETE FROM fg_certificado_glp_componente WHERE certificado_id = $1', [id]);

        if (componentes && componentes.length > 0) {
            const qIns = `
                INSERT INTO fg_certificado_glp_componente (certificado_id, orden, componente, marca, modelo, capacidad_litros, mes_fabricacion, anio_fabricacion, numero_serie)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `;
            for (const c of componentes) {
                await client.query(qIns, [id, c.orden, c.componente, c.marca || null, c.modelo || null, c.capacidadLitros || null, c.mesFabricacion || null, c.anioFabricacion || null, c.numeroSerie || null]);
            }
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505' && e.constraint === 'fg_certificado_glp_componente_certificado_id_orden_key') {
            throw new Error('COMPONENTE_INVALIDO');
        }
        throw e;
    } finally {
        client.release();
    }
};

exports.guardarGLPVerificaciones = async (id, verificaciones, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GLP_ANUAL', userContext);

        await client.query('DELETE FROM fg_certificado_glp_verificacion WHERE certificado_id = $1', [id]);

        if (verificaciones && verificaciones.length > 0) {
            const qIns = `
                INSERT INTO fg_certificado_glp_verificacion (certificado_id, codigo, orden, descripcion, cumple, observacion)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            for (const v of verificaciones) {
                await client.query(qIns, [id, v.codigo, v.orden, v.descripcion, v.cumple, v.observacion || null]);
            }
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

exports.obtenerGLP = async (id, userContext) => {
    const qCert = `SELECT planta_key FROM fg_certificado WHERE id = $1`;
    const rCert = await db.query(qCert, [id]);
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    await validarAccesoCertificado(userContext.username, userContext.perfil_id, rCert.rows[0].planta_key);

    const rGlp = await db.query(`SELECT * FROM fg_certificado_glp WHERE certificado_id = $1`, [id]);
    const rComp = await db.query(`SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = $1 ORDER BY orden ASC`, [id]);
    const rVerif = await db.query(`SELECT * FROM fg_certificado_glp_verificacion WHERE certificado_id = $1 ORDER BY orden ASC`, [id]);

    return {
        glp: rGlp.rowCount > 0 ? rGlp.rows[0] : null,
        componentes: rComp.rows,
        verificaciones: rVerif.rows
    };
};

// ================= CONFORMIDAD =================

exports.guardarConformidad = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'CONFORMIDAD', userContext);
        
        if (data.tipoConformidad && !['MODIFICACION', 'MONTAJE', 'FABRICACION'].includes(data.tipoConformidad)) {
            throw new Error('TIPO_CONFORMIDAD_INVALIDO');
        }

        const qUpd = `
            INSERT INTO fg_certificado_conformidad (
                certificado_id, tipo_conformidad, tipo_tramite, caracteristica_registrable, motivo, descripcion, uso_original_vehiculo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (certificado_id) DO UPDATE SET
                tipo_conformidad = EXCLUDED.tipo_conformidad,
                tipo_tramite = EXCLUDED.tipo_tramite,
                caracteristica_registrable = EXCLUDED.caracteristica_registrable,
                motivo = EXCLUDED.motivo,
                descripcion = EXCLUDED.descripcion,
                uso_original_vehiculo = EXCLUDED.uso_original_vehiculo
        `;
        
        await client.query(qUpd, [
            id,
            data.tipoConformidad,
            data.tipoTramite || null,
            data.caracteristicaRegistrable || null,
            data.motivo || null,
            data.descripcion || null,
            data.usoOriginalVehiculo || null
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

exports.obtenerConformidad = async (id, userContext) => {
    const qCert = `SELECT planta_key FROM fg_certificado WHERE id = $1`;
    const rCert = await db.query(qCert, [id]);
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    await validarAccesoCertificado(userContext.username, userContext.perfil_id, rCert.rows[0].planta_key);

    const rConf = await db.query(`SELECT * FROM fg_certificado_conformidad WHERE certificado_id = $1`, [id]);
    
    return {
        conformidad: rConf.rowCount > 0 ? rConf.rows[0] : null
    };
};

// ================= TALLERES =================

exports.obtenerTalleresActivos = async () => {
    const res = await db.query(`
        SELECT id, ruc, razon_social AS "razonSocial", razon_social AS "nombre", nombre_comercial AS "nombreComercial", 
               sede, direccion, codigo_autorizacion AS "codigoAutorizacion"
        FROM fg_taller_autorizado
        WHERE estado = true
        ORDER BY razon_social ASC
    `);
    return res.rows;
};


exports.validarEmision = async (id, userContext) => {
    const rCert = await db.query(`
        SELECT c.*, t.clave as tipo_clave 
        FROM fg_certificado c
        JOIN fg_tipo_certificado t ON c.tipo_certificado_clave = t.clave
        WHERE c.id = $1
    `, [id]);
    
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    const cert = rCert.rows[0];

    await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);

    if (cert.estado !== 'BORRADOR') {
        return { valido: false, errores: [{ seccion: 'general', campo: 'estado', codigo: 'ESTADO_INVALIDO', mensaje: 'El certificado no está en estado BORRADOR' }] };
    }

    const errores = [];
    const pushError = (seccion, campo, codigo, mensaje) => errores.push({ seccion, campo, codigo, mensaje });

    // Vehículo base
    const rVeh = await db.query('SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1', [id]);
    const veh = rVeh.rows[0];
    if (!veh) {
        pushError('vehiculo', 'general', 'SECCION_FALTANTE', 'Falta el snapshot de vehículo');
    } else {
        if (!veh.placa) pushError('vehiculo', 'placa', 'CAMPO_REQUERIDO', 'Placa requerida');
        
        const checkCampos = (campos) => {
            campos.forEach(c => {
                if (veh[c] === null || veh[c] === undefined || veh[c] === '') {
                    pushError('vehiculo', c, 'CAMPO_REQUERIDO', `Campo vehiculo requerido: ${c}`);
                }
            });
        };

        if (!veh.vin && !veh.serie_chasis) {
            pushError('vehiculo', 'vin', 'CAMPO_REQUERIDO', 'Se requiere VIN o Serie de Chasis');
        }

        if (cert.tipo_clave === 'GNV_ANUAL') {
            checkCampos([
                'categoria', 'marca', 'modelo', 'version', 'anio_fabricacion', 'numero_motor',
                'numero_cilindros', 'cilindrada', 'combustible', 'numero_ejes', 'numero_ruedas',
                'numero_asientos', 'numero_pasajeros', 'longitud', 'ancho', 'alto', 'color',
                'peso_neto', 'peso_bruto'
            ]);
        } else if (cert.tipo_clave === 'GLP_ANUAL') {
            checkCampos([
                'categoria', 'marca', 'modelo', 'version', 'anio_fabricacion', 'numero_motor',
                'numero_cilindros', 'cilindrada', 'combustible', 'numero_ejes', 'numero_ruedas',
                'numero_asientos', 'numero_pasajeros', 'longitud', 'ancho', 'alto', 
                'peso_neto', 'peso_bruto', 'carga_util'
            ]);
        } else if (cert.tipo_clave === 'CONFORMIDAD') {
            checkCampos([
                'clase', 'categoria', 'modelo', 'marca', 'numero_motor', 'color', 'carroceria',
                'combustible', 'longitud', 'ancho', 'alto', 'peso_bruto', 'peso_neto', 'carga_util',
                'anio_fabricacion', 'anio_modelo', 'formula_rodante', 'potencia', 'numero_ejes',
                'numero_ruedas', 'numero_asientos', 'numero_pasajeros', 'cilindrada', 'numero_cilindros', 'version'
            ]);
        }
    }

    // Titulares
    const rTit = await db.query('SELECT * FROM fg_certificado_titular WHERE certificado_id = $1 ORDER BY orden', [id]);
    const titulares = rTit.rows;
    
    if (cert.tipo_clave === 'GLP_ANUAL' || cert.tipo_clave === 'CONFORMIDAD') {
        if (titulares.length === 0) {
            pushError('titular', 'general', 'TITULAR_REQUERIDO', 'Se requiere al menos 1 titular');
        } else {
            titulares.forEach(t => {
                if (!t.tipo_documento) pushError('titular', 'tipo_documento', 'CAMPO_REQUERIDO', 'Tipo documento requerido');
                if (!t.nro_documento) pushError('titular', 'nro_documento', 'CAMPO_REQUERIDO', 'Nro documento requerido');
                if (!t.nombre_razon_social) pushError('titular', 'nombre_razon_social', 'CAMPO_REQUERIDO', 'Nombre requerido');
                
                if (cert.tipo_clave === 'CONFORMIDAD' && !t.direccion) {
                    pushError('titular', 'direccion', 'CAMPO_REQUERIDO', 'Dirección requerida para titular de conformidad');
                }
            });
        }
    }

    // Orden y pagos Faregas. La orden es la fuente de verdad del saldo antes de emitir.
    const rOrdenPago = await db.query(
        'SELECT estado, importe_total, importe_pagado, saldo_pendiente FROM fg_orden_pago WHERE certificado_id = $1',
        [id]
    );
    if (rOrdenPago.rowCount === 0) {
        pushError('pago', 'orden', 'ORDEN_PAGO_FALTANTE', 'Falta registrar la orden de pago del certificado');
    } else {
        const orden = rOrdenPago.rows[0];
        if (orden.estado !== 'PAGADO' || Number(orden.saldo_pendiente) > 0.009) {
            pushError('pago', 'saldo', 'PAGO_INCOMPLETO', `Pago incompleto. Saldo pendiente: S/ ${Number(orden.saldo_pendiente).toFixed(2)}`);
        }
    }

    // La facturacion electronica debe estar aceptada antes de consumir el
    // correlativo definitivo del certificado.
    const rFacturacion = await db.query(
        'SELECT estado, nro_comprobante, aceptada_sunat FROM fg_facturacion WHERE certificado_id = $1',
        [id]
    );
    if (rFacturacion.rowCount === 0) {
        pushError('facturacion', 'general', 'FACTURACION_FALTANTE', 'Faltan los datos de facturacion');
    } else if (rFacturacion.rows[0].estado !== 'ACEPTADO' || rFacturacion.rows[0].aceptada_sunat !== true) {
        pushError('facturacion', 'estado', 'FACTURACION_NO_EMITIDA', 'El comprobante debe estar aceptado por Nubefact/SUNAT antes de emitir el certificado');
    }

    // GNV Especifico
    if (cert.tipo_clave === 'GNV_ANUAL') {
        const rGnv = await db.query('SELECT * FROM fg_certificado_gnv WHERE certificado_id = $1', [id]);
        if (rGnv.rowCount === 0) {
            pushError('gnv', 'general', 'SECCION_FALTANTE', 'Faltan datos de GNV');
        } else {
            const g = rGnv.rows[0];
            if (!g.taller_autorizado_id) pushError('gnv', 'taller_autorizado_id', 'CAMPO_REQUERIDO', 'Taller autorizado requerido');
            if (!g.vigencia_hasta) pushError('gnv', 'vigencia_hasta', 'CAMPO_REQUERIDO', 'Vigencia requerida');
            // Modalidad requerida
            if (!g.modalidad || !['INICIAL', 'ANUAL'].includes(g.modalidad)) {
                pushError('gnv', 'modalidad', 'CAMPO_REQUERIDO', 'Modalidad GNV requerida (INICIAL o ANUAL)');
            }
            // Chip requerido solo para INICIAL
            if (g.modalidad === 'INICIAL') {
                pushError('gnv', 'formato', 'FORMATO_INICIAL_PENDIENTE', 'La captura GNV INICIAL está habilitada, pero su formato de emisión todavía no está configurado');
                if (!g.numero_chip) {
                    pushError('gnv', 'numero_chip', 'CAMPO_REQUERIDO', 'N° Chip requerido para GNV INICIAL');
                } else if (!/^[A-Z0-9]{1,15}$/.test(g.numero_chip)) {
                    pushError('gnv', 'numero_chip', 'FORMATO_INVALIDO', 'N° Chip inválido: solo alfanumérico, máx 15 caracteres');
                }
            }
        }

        const rVer = await db.query('SELECT * FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1', [id]);
        const verifCodes = rVer.rows.map(v => v.codigo);
        const reqCodes = ['a','b','c','d','e','f','g','h'];
        const missing = reqCodes.filter(c => !verifCodes.includes(c));
        if (missing.length > 0) {
            pushError('gnv', 'verificaciones', 'VERIFICACIONES_INCOMPLETAS', 'Faltan verificaciones GNV: ' + missing.join(', '));
        }

        rVer.rows.forEach(v => {
            if (v.cumple === null) {
                pushError('gnv', 'verificaciones', 'VERIFICACION_NO_EVALUADA', `Verificación ${v.codigo} no evaluada`);
            } else if (v.cumple === false) {
                pushError('gnv', 'verificaciones', 'VERIFICACION_NO_CUMPLE', `Verificación ${v.codigo} NO CUMPLE`);
                const obs = (v.observacion || '').trim();
                if (!obs) {
                    pushError('gnv', 'observaciones', 'CAMPO_REQUERIDO', `Verificación ${v.codigo} NO CUMPLE pero no tiene observación`);
                }
            }
        });
    }

    // GLP Especifico
    if (cert.tipo_clave === 'GLP_ANUAL') {
        const rGlp = await db.query('SELECT * FROM fg_certificado_glp WHERE certificado_id = $1', [id]);
        if (rGlp.rowCount === 0) {
            pushError('glp', 'general', 'SECCION_FALTANTE', 'Faltan datos de GLP');
        } else {
            const g = rGlp.rows[0];
            if (!g.taller_autorizado_id) pushError('glp', 'taller_autorizado_id', 'CAMPO_REQUERIDO', 'Taller autorizado requerido');
            if (!g.vigencia_hasta) pushError('glp', 'vigencia_hasta', 'CAMPO_REQUERIDO', 'Vigencia requerida');
            if (!g.expediente_tecnico) pushError('glp', 'expediente_tecnico', 'CAMPO_REQUERIDO', 'Expediente técnico requerido');
            // Modalidad requerida
            if (!g.modalidad || !['INICIAL', 'ANUAL'].includes(g.modalidad)) {
                pushError('glp', 'modalidad', 'CAMPO_REQUERIDO', 'Modalidad GLP requerida (INICIAL o ANUAL)');
            } else if (g.modalidad === 'INICIAL') {
                pushError('glp', 'formato', 'FORMATO_INICIAL_PENDIENTE', 'La captura GLP INICIAL está habilitada, pero su formato de emisión todavía no está configurado');
            }
        }

        const rComp = await db.query('SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = $1', [id]);
        const compTypes = rComp.rows.map(c => c.componente);
        if (!compTypes.includes('CILINDRO')) pushError('glp', 'componentes', 'COMPONENTE_REQUERIDO', 'Se requiere al menos 1 CILINDRO');
        if (!compTypes.includes('REGULADOR')) pushError('glp', 'componentes', 'COMPONENTE_REQUERIDO', 'Se requiere al menos 1 REGULADOR');
        
        rComp.rows.forEach(c => {
            if (!c.marca) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', `Marca requerida para componente ${c.componente}`);
            if (!c.modelo) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', `Modelo requerido para componente ${c.componente}`);
            if (c.componente === 'CILINDRO') {
                if (!c.numero_serie) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Serie requerida para CILINDRO');
                if (!c.capacidad_litros) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Capacidad requerida para CILINDRO');
                if (!c.mes_fabricacion) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Mes fabricación requerido para CILINDRO');
                if (!c.anio_fabricacion) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Año fabricación requerido para CILINDRO');
            }
        });

        const rVer = await db.query('SELECT * FROM fg_certificado_glp_verificacion WHERE certificado_id = $1', [id]);
        const verifCodes = rVer.rows.map(v => v.codigo);
        const reqCodes = ['1','2','3','4','5','6','7'];
        const missing = reqCodes.filter(c => !verifCodes.includes(c));
        if (missing.length > 0) {
            pushError('glp', 'verificaciones', 'VERIFICACIONES_INCOMPLETAS', 'Faltan verificaciones GLP: ' + missing.join(', '));
        }

        rVer.rows.forEach(v => {
            if (v.cumple === null) {
                pushError('glp', 'verificaciones', 'VERIFICACION_NO_EVALUADA', `Verificación ${v.codigo} no evaluada`);
            } else if (v.cumple === false) {
                pushError('glp', 'verificaciones', 'VERIFICACION_NO_CUMPLE', `Verificación ${v.codigo} NO CUMPLE`);
                const obs = (v.observacion || '').trim();
                if (!obs) {
                    pushError('glp', 'observaciones', 'CAMPO_REQUERIDO', `Verificación ${v.codigo} NO CUMPLE pero no tiene observación`);
                }
            }
        });
    }

    // Conformidad Especifico
    if (cert.tipo_clave === 'CONFORMIDAD') {
        const rConf = await db.query('SELECT * FROM fg_certificado_conformidad WHERE certificado_id = $1', [id]);
        if (rConf.rowCount === 0) {
            pushError('conformidad', 'general', 'SECCION_FALTANTE', 'Faltan datos de Conformidad');
        } else {
            const c = rConf.rows[0];
            const validTipos = ['MODIFICACION', 'MONTAJE', 'FABRICACION'];
            if (!validTipos.includes(c.tipo_conformidad)) pushError('conformidad', 'tipo_conformidad', 'TIPO_INVALIDO', 'Tipo de conformidad inválido');
            if (!c.tipo_tramite) pushError('conformidad', 'tipo_tramite', 'CAMPO_REQUERIDO', 'Tipo trámite requerido');
            if (!c.caracteristica_registrable) pushError('conformidad', 'caracteristica_registrable', 'CAMPO_REQUERIDO', 'Característica registrable requerida');
            if (!c.motivo) pushError('conformidad', 'motivo', 'CAMPO_REQUERIDO', 'Motivo requerido');
            if (!c.descripcion) pushError('conformidad', 'descripcion', 'CAMPO_REQUERIDO', 'Descripción requerida');
            if (!c.uso_original_vehiculo) pushError('conformidad', 'uso_original_vehiculo', 'CAMPO_REQUERIDO', 'Uso original requerido');
        }
    }

    return {
        valido: errores.length === 0,
        errores
    };
};

exports.emitirCertificado = async (id, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        // Bloquear certificado FOR UPDATE
        const rCert = await client.query(`
            SELECT c.*, t.clave as tipo_clave, t.codigo as tipo_codigo
            FROM fg_certificado c
            JOIN fg_tipo_certificado t ON c.tipo_certificado_clave = t.clave
            WHERE c.id = $1 FOR UPDATE
        `, [id]);
        
        if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCert.rows[0];

        // Validar acceso
        const { validarAccesoCertificado } = require('./faregas-auth.service');
        if(typeof validarAccesoCertificado === 'function') {
            await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
        } else {
           // fallback auth check
           const { getPlantasPorUsuario } = require('./faregas-auth.service');
           const pRes = await getPlantasPorUsuario(userContext.username, userContext.perfil_id);
           const pKeys = pRes.map(p => p.key);
           if(!pKeys.includes(cert.planta_key)) throw new Error('PLANTA_NO_AUTORIZADA');
        }

        if (cert.estado !== 'BORRADOR') throw new Error('ESTADO_INVALIDO');

        // Validar emisión internamente
        const valRes = await exports.validarEmision(id, userContext);
        if (!valRes.valido) throw new Error('NO_VALIDO_PARA_EMISION');

        // Seleccionar rango activo FOR UPDATE
        const rCorrelativo = await client.query(`
            SELECT * FROM fg_correlativo_certificado
            WHERE planta_key = $1 AND tipo_certificado_clave = $2 AND activo = true
            FOR UPDATE
        `, [cert.planta_key, cert.tipo_clave]);

        if (rCorrelativo.rowCount === 0) {
            throw new Error('NO_EXISTE_RANGO_ACTIVO');
        }

        const rango = rCorrelativo.rows[0];
        
        if (rango.nro_actual >= rango.nro_maximo) {
            throw new Error('RANGO_AGOTADO');
        }

        const siguiente = parseInt(rango.nro_actual) + 1;
        if (siguiente > rango.nro_maximo) {
            throw new Error('RANGO_AGOTADO');
        }

        let ancho = 0;
        if (cert.tipo_clave === 'GNV_ANUAL') ancho = 7;
        else if (cert.tipo_clave === 'GLP_ANUAL') ancho = 6;
        else if (cert.tipo_clave === 'CONFORMIDAD') ancho = 6;
        else throw new Error('FORMATO_NUMERO_NO_CONFIGURADO');

        const numeroFormateado = String(siguiente).padStart(ancho, '0');
        const numero_certificado = `DG-${cert.tipo_codigo}-${numeroFormateado}`;

        // Update correlativo
        await client.query(`
            UPDATE fg_correlativo_certificado
            SET nro_actual = $1, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [siguiente, rango.id]);

        // Update certificado
        await client.query(`
            UPDATE fg_certificado
            SET estado = 'EMITIDO',
                numero_certificado = $1,
                fecha_emision = CURRENT_TIMESTAMP,
                usuario_modificacion = $2,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [numero_certificado, userContext.username, id]);

        await client.query('COMMIT');
        
        return {
            numero_certificado
        };

    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const generateGnvAnualHtml = require('../templates/gnv-anual.template');
const generateGlpAnualHtml = require('../templates/glp-anual.template');
const generateConformidadHtml = require('../templates/conformidad.template');

exports.obtenerPrevisualizacion = async (id, userContext) => {
    const borrador = await exports.obtenerBorradorCompleto(id, userContext);
    const tipoClave = borrador.tipo ? borrador.tipo.clave : null;
    const vehiculoPlantilla = paraPlantilla(borrador.vehiculo || {});

    if (tipoClave === 'GNV_ANUAL') {
        const dataGnv = await exports.obtenerGNV(id, userContext);
        const gnv = dataGnv.gnv || {};
        if (gnv.modalidad === 'INICIAL') {
            throw new Error('FORMATO_PREVIEW_PENDIENTE');
        }
        const html = generateGnvAnualHtml({
            cabecera: {
                id: borrador.id,
                placa_nueva: vehiculoPlantilla.placa,
                fecha_emision: borrador.fechaEmision,
                observaciones: borrador.observaciones,
                entidad_certificadora_nombre: borrador.entidadCertificadoraNombre,
                resolucion_directoral: borrador.resolucionDirectoral,
                domicilio_fiscal: borrador.domicilioFiscal,
                telefono_certificadora: borrador.telefonoCertificadora,
                lugar_emision: borrador.lugarEmision
            },
            vehiculo: vehiculoPlantilla,
            gnv: gnv,
            verificaciones: dataGnv.verificaciones || [],
            titulares: borrador.titulares || []
        });
        return { html, tipo: 'GNV_ANUAL' };
    } else if (tipoClave === 'GLP_ANUAL') {
        const dataGlp = await exports.obtenerGLP(id, userContext);
        const glp = dataGlp.glp || {};
        if (glp.modalidad === 'INICIAL') {
            throw new Error('FORMATO_PREVIEW_PENDIENTE');
        }
        const html = generateGlpAnualHtml({
            cabecera: {
                id: borrador.id,
                placa_nueva: vehiculoPlantilla.placa,
                fecha_emision: borrador.fechaEmision,
                observaciones: borrador.observaciones,
                cliente_nombre: borrador.cliente?.nombreRazonSocial,
                entidad_certificadora_nombre: borrador.entidadCertificadoraNombre,
                resolucion_directoral: borrador.resolucionDirectoral,
                domicilio_fiscal: borrador.domicilioFiscal,
                telefono_certificadora: borrador.telefonoCertificadora,
                lugar_emision: borrador.lugarEmision
            },
            vehiculo: vehiculoPlantilla,
            glp: glp,
            componentes: dataGlp.componentes || [],
            verificaciones: dataGlp.verificaciones || [],
            titulares: borrador.titulares || []
        });
        return { html, tipo: 'GLP_ANUAL' };
    } else if (tipoClave === 'CONFORMIDAD') {
        const dataConf = await exports.obtenerConformidad(id, userContext);
        const html = generateConformidadHtml({
            cabecera: {
                id: borrador.id,
                placa_nueva: vehiculoPlantilla.placa,
                fecha_emision: borrador.fechaEmision,
                observaciones: borrador.observaciones,
                cliente_nombre: borrador.cliente?.nombreRazonSocial,
                entidad_certificadora_nombre: borrador.entidadCertificadoraNombre,
                resolucion_directoral: borrador.resolucionDirectoral,
                domicilio_fiscal: borrador.domicilioFiscal,
                telefono_certificadora: borrador.telefonoCertificadora,
                lugar_emision: borrador.lugarEmision
            },
            vehiculo: vehiculoPlantilla,
            conformidad: dataConf.conformidad || {},
            titulares: borrador.titulares || []
        });
        return { html, tipo: 'CONFORMIDAD' };
    } else {
        throw new Error('FORMATO_NUMERO_NO_CONFIGURADO');
    }
};
