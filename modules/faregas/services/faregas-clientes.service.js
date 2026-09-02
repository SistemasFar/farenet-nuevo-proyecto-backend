const db = require('../../../config/database');
const farenetReadAdapter = require('../integrations/farenet-read.adapter');

exports.buscarClientePropio = async (tipoDocumento, nroDocumento) => {
    const res = await db.query(`
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
    `, [tipoDocumento, nroDocumento]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

exports.crearCliente = async (data) => {
    const { tipoDocumento, nroDocumento, nombreRazonSocial, direccion, telefono, correo } = data;
    try {
        const res = await db.query(`
            INSERT INTO fg_cliente
            (tipo_documento, nro_documento, nombre_razon_social, direccion, telefono, correo, estado)
            VALUES ($1, $2, $3, $4, $5, $6, true)
            RETURNING id
        `, [
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

    if (campos.length === 0) return true;

    campos.push('fecha_modificacion = CURRENT_TIMESTAMP');
    values.push(id);
    const res = await db.query(`
        UPDATE fg_cliente
        SET ${campos.join(', ')}
        WHERE id = $${idx}
        RETURNING id
    `, values);

    if (res.rowCount === 0) throw new Error('CLIENTE_NOT_FOUND');
    return true;
};

// El servicio conserva sus contratos; el acceso a tablas legacy vive en una
// frontera explicita y de solo lectura.
exports.buscarPersonaFarenet = farenetReadAdapter.buscarPersona;
const mapFaregasVehiculo = (row) => ({
    placa: row.placa,
    categoria: row.categoria,
    clase: row.clase,
    marca: row.marca,
    modelo: row.modelo,
    version: row.version,
    anioFabricacion: row.anio_fabricacion,
    anioModelo: row.anio_modelo,
    vin: row.vin,
    serieChasis: row.serie_chasis,
    numeroMotor: row.numero_motor,
    combustible: row.combustible,
    color: row.color,
    carroceria: row.carroceria,
    numeroCilindros: row.numero_cilindros,
    cilindrada: row.cilindrada,
    numeroEjes: row.numero_ejes,
    numeroRuedas: row.numero_ruedas,
    numeroAsientos: row.numero_asientos,
    numeroPasajeros: row.numero_pasajeros,
    longitud: row.longitud,
    ancho: row.ancho,
    alto: row.alto,
    pesoNeto: row.peso_neto,
    pesoBruto: row.peso_bruto,
    cargaUtil: row.carga_util,
    potencia: row.potencia,
    formulaRodante: row.formula_rodante
});

exports.buscarVehiculoPorPlaca = async (placa) => {
    const vehiculoFarenet = await farenetReadAdapter.buscarVehiculoPorPlaca(placa);
    
    const resFaregas = await db.query(`
        SELECT v.* 
        FROM fg_certificado_vehiculo v
        JOIN fg_certificado c ON c.id = v.certificado_id
        WHERE UPPER(v.placa) = UPPER($1)
        ORDER BY (c.estado = 'EMITIDO') DESC, (v.version IS NOT NULL OR v.anio_modelo IS NOT NULL) DESC, c.fecha_creacion DESC
        LIMIT 1
    `, [placa]);

    if (resFaregas.rowCount > 0) {
        const vehiculoFaregas = mapFaregasVehiculo(resFaregas.rows[0]);
        const certificadoId = resFaregas.rows[0].certificado_id;
        
        // Fetch adicionales
        const titulares = await db.query('SELECT * FROM fg_certificado_titular WHERE certificado_id = $1 ORDER BY orden ASC', [certificadoId]);
        const glp = await db.query('SELECT * FROM fg_certificado_glp WHERE certificado_id = $1', [certificadoId]);
        const gnv = await db.query('SELECT * FROM fg_certificado_gnv WHERE certificado_id = $1', [certificadoId]);
        const conformidad = await db.query('SELECT * FROM fg_certificado_conformidad WHERE certificado_id = $1', [certificadoId]);

        // Fetch subtablas GLP
        const glpComponentes = await db.query('SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = $1 ORDER BY orden ASC', [certificadoId]);
        const glpVerificaciones = await db.query('SELECT * FROM fg_certificado_glp_verificacion WHERE certificado_id = $1', [certificadoId]);
        
        // Fetch subtablas GNV
        const gnvComponentes = await db.query('SELECT * FROM fg_certificado_gnv_componente WHERE certificado_id = $1 ORDER BY orden ASC', [certificadoId]);
        const gnvVerificaciones = await db.query('SELECT * FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1', [certificadoId]);
        
        let result = vehiculoFaregas;
        if (vehiculoFarenet) {
            const merged = { ...vehiculoFarenet };
            for (const [key, value] of Object.entries(vehiculoFaregas)) {
                if (value !== null && value !== undefined && String(value).trim() !== '') {
                    merged[key] = value;
                }
            }
            result = merged;
        }

        result.titularesFaregas = titulares.rows;
        
        result.glpFaregas = glp.rowCount > 0 ? {
            ...glp.rows[0],
            componentes: glpComponentes.rows,
            verificaciones: glpVerificaciones.rows
        } : null;

        result.gnvFaregas = gnv.rowCount > 0 ? {
            ...gnv.rows[0],
            componentes: gnvComponentes.rows,
            verificaciones: gnvVerificaciones.rows,
                    } : null;
        result.conformidadFaregas = conformidad.rowCount > 0 ? conformidad.rows[0] : null;

        return result;
    }

    return vehiculoFarenet;
};
