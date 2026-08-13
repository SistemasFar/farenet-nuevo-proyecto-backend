const db = require('../../../config/database');

// ============================================
// CLIENTES PROPIOS FAREGAS
// ============================================

exports.buscarClientePropio = async (tipoDocumento, nroDocumento) => {
    const q = `
        SELECT 
            id,
            tipo_documento AS "tipoDocumento",
            nro_documento AS "nroDocumento",
            nombre_razon_social AS "nombreRazonSocial",
            direccion,
            telefono,
            correo,
            estado
        FROM fg_cliente
        WHERE tipo_documento = $1 AND nro_documento = $2
    `;
    const res = await db.query(q, [tipoDocumento, nroDocumento]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

exports.crearCliente = async (data) => {
    const { tipoDocumento, nroDocumento, nombreRazonSocial, direccion, telefono, correo } = data;
    
    // Asumimos estado true por defecto
    const q = `
        INSERT INTO fg_cliente 
        (tipo_documento, nro_documento, nombre_razon_social, direccion, telefono, correo, estado)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        RETURNING id
    `;
    try {
        const res = await db.query(q, [
            tipoDocumento, 
            nroDocumento, 
            nombreRazonSocial, 
            direccion || null, 
            telefono || null, 
            correo || null
        ]);
        return res.rows[0].id;
    } catch (e) {
        if (e.code === '23505' && e.constraint === 'fg_cliente_tipo_documento_nro_documento_key') {
            throw new Error('CLIENTE_DUPLICADO');
        }
        throw e;
    }
};

exports.actualizarCliente = async (id, data) => {
    // Solo permitir actualizar campos especificos
    const campos = [];
    const values = [];
    let idx = 1;

    if (data.nombreRazonSocial !== undefined) {
        campos.push(`nombre_razon_social = $${idx++}`);
        values.push(data.nombreRazonSocial);
    }
    if (data.direccion !== undefined) {
        campos.push(`direccion = $${idx++}`);
        values.push(data.direccion);
    }
    if (data.telefono !== undefined) {
        campos.push(`telefono = $${idx++}`);
        values.push(data.telefono);
    }
    if (data.correo !== undefined) {
        campos.push(`correo = $${idx++}`);
        values.push(data.correo);
    }
    if (data.estado !== undefined) {
        campos.push(`estado = $${idx++}`);
        values.push(data.estado);
    }

    if (campos.length === 0) return true; // Nada que actualizar

    campos.push(`fecha_modificacion = CURRENT_TIMESTAMP`);
    values.push(id);

    const q = `
        UPDATE fg_cliente
        SET ${campos.join(', ')}
        WHERE id = $${idx}
        RETURNING id
    `;
    
    const res = await db.query(q, values);
    if (res.rowCount === 0) {
        throw new Error('CLIENTE_NOT_FOUND');
    }
    return true;
};

// ============================================
// AUTOCOMPLETADO PERSONA FARENET (READ-ONLY)
// ============================================

exports.buscarPersonaFarenet = async (tipoDocumento, nroDocumento) => {
    // Mapping:
    // tipoDocumento <- tipodocumentoidentidad_key
    // nroDocumento <- nrodocumentoidentidad
    // nombreRazonSocial <- nombrerazonsocial
    // direccion <- direccion
    // telefono <- telefono
    // correo <- email
    
    const q = `
        SELECT 
            tipodocumentoidentidad_key AS "tipoDocumento",
            nrodocumentoidentidad AS "nroDocumento",
            nombrerazonsocial AS "nombreRazonSocial",
            direccion,
            telefono,
            email AS "correo"
        FROM persona
        WHERE tipodocumentoidentidad_key = $1 AND nrodocumentoidentidad = $2
    `;
    const res = await db.query(q, [tipoDocumento, nroDocumento]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

// ============================================
// BÚSQUEDA VEHÍCULO FARENET (READ-ONLY)
// ============================================

exports.buscarVehiculoPorPlaca = async (placa) => {
    const q = `
        SELECT 
            v.nroplacaantigua AS placa,
            v.categoria_key,
            c.nombre AS categoria_nombre,
            v.vehiculoclase_key,
            vc.nombre AS vehiculoclase_nombre,
            v.marca_key,
            m.nombre AS marca_nombre,
            v.modelo_key,
            mo.nombre AS modelo_nombre,
            v.aniofabricacion,
            v.nroserie,
            v.nromotor,
            v.combustible_key,
            co.nombre AS combustible_nombre,
            v.color_key,
            col.nombre AS color_nombre,
            v.carroceria_key,
            ca.nombre AS carroceria_nombre,
            v.nrocilindros,
            v.nroejes,
            v.nroruedas,
            v.nroasientos,
            v.nropasajeros,
            v.longitud,
            v.ancho,
            v.alto,
            v.pesoseco,
            v.pesobruto,
            v.cargautil
        FROM vehiculo v
        LEFT JOIN categoria c ON v.categoria_key = c.key
        LEFT JOIN vehiculoclase vc ON v.vehiculoclase_key = vc.key
        LEFT JOIN marca m ON v.marca_key = m.key
        LEFT JOIN modelo mo ON v.modelo_key = mo.key
        LEFT JOIN combustible co ON v.combustible_key = co.key
        LEFT JOIN color col ON v.color_key = col.key
        LEFT JOIN carroceria ca ON v.carroceria_key = ca.key
        WHERE UPPER(TRIM(v.nroplacaantigua)) = UPPER(TRIM($1))
        LIMIT 1
    `;
    const res = await db.query(q, [placa]);
    if (res.rows.length === 0) return null;
    
    const row = res.rows[0];
    
    return {
        placa: row.placa,
        categoria: row.categoria_nombre || row.categoria_key,
        clase: row.vehiculoclase_nombre || row.vehiculoclase_key,
        marca: row.marca_nombre || row.marca_key,
        modelo: row.modelo_nombre || row.modelo_key,
        version: null,
        anioFabricacion: row.aniofabricacion,
        anioModelo: null,
        vin: null,
        serieChasis: row.nroserie,
        numeroMotor: row.nromotor,
        combustible: row.combustible_nombre || row.combustible_key,
        color: row.color_nombre || row.color_key,
        carroceria: row.carroceria_nombre || row.carroceria_key,
        numeroCilindros: row.nrocilindros,
        cilindrada: null,
        numeroEjes: row.nroejes,
        numeroRuedas: row.nroruedas,
        numeroAsientos: row.nroasientos,
        numeroPasajeros: row.nropasajeros,
        longitud: row.longitud,
        ancho: row.ancho,
        alto: row.alto,
        pesoNeto: row.pesoseco,
        pesoBruto: row.pesobruto,
        cargaUtil: row.cargautil,
        potencia: null,
        formulaRodante: null
    };
};
