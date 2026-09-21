const db = require('../../../config/database');
const farenetReadAdapter = require('../integrations/farenet-read.adapter');
const vehiculosService = require('./faregas-vehiculos.service');

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
    
    let cliente = res.rows.length > 0 ? res.rows[0] : null;
    
    if (cliente) {
        if (!cliente.correo || !cliente.telefono) {
            const fac = await db.query(`
                SELECT email as correo, telefono 
                FROM fg_facturacion 
                WHERE nro_documento = $1 AND (email IS NOT NULL OR telefono IS NOT NULL)
                ORDER BY id DESC LIMIT 1
            `, [nroDocumento]);
            if (fac.rows.length > 0) {
                if (!cliente.correo) cliente.correo = fac.rows[0].correo || null;
                if (!cliente.telefono) cliente.telefono = fac.rows[0].telefono || null;
            }
        }
    } else {
        const fac = await db.query(`
            SELECT email as correo, telefono, nombre_razon_social as "nombreRazonSocial", direccion
            FROM fg_facturacion 
            WHERE nro_documento = $1
            ORDER BY id DESC LIMIT 1
        `, [nroDocumento]);
        if (fac.rows.length > 0) {
            cliente = {
                tipoDocumento,
                nroDocumento,
                nombreRazonSocial: fac.rows[0].nombreRazonSocial,
                direccion: fac.rows[0].direccion,
                correo: fac.rows[0].correo || null,
                telefono: fac.rows[0].telefono || null
            };
        }
    }
    
    return cliente;
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
exports.buscarVehiculoPorPlaca = async (placa, opciones = {}) => {
    const resolucion = await vehiculosService.resolverVehiculoPorPlaca(placa, opciones);
    if (!resolucion.vehiculo) return null;

    const result = {
        ...resolucion.vehiculo,
        origen: resolucion.origen,
        completadoDesdeFarenet: resolucion.completadoDesdeFarenet
    };
    const certificadoId = resolucion.snapshotLegacyId;

    if (certificadoId) {
        
        // Fetch adicionales - Titulares siempre del último certificado (sin importar tipo)
        const titulares = await db.query('SELECT * FROM fg_certificado_titular WHERE certificado_id = $1 ORDER BY orden ASC', [certificadoId]);
        result.titularesFaregas = titulares.rows;

        // Fetch de información específica de trámites (GLP, GNV, Conformidad)
        const { tipoCertificado, excludeCertificadoId } = opciones;
        const certificadoEspecificoId = tipoCertificado
            ? await vehiculosService.buscarCertificadoCompatiblePorPlaca(placa, tipoCertificado, excludeCertificadoId)
            : certificadoId;

        if (certificadoEspecificoId) {
            const glp = await db.query('SELECT * FROM fg_certificado_glp WHERE certificado_id = $1', [certificadoEspecificoId]);
            const gnv = await db.query('SELECT * FROM fg_certificado_gnv WHERE certificado_id = $1', [certificadoEspecificoId]);
            const conformidad = await db.query('SELECT * FROM fg_certificado_conformidad WHERE certificado_id = $1', [certificadoEspecificoId]);

            // Fetch subtablas GLP
            const glpComponentes = await db.query('SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = $1 ORDER BY orden ASC', [certificadoEspecificoId]);
            const glpVerificaciones = await db.query('SELECT * FROM fg_certificado_glp_verificacion WHERE certificado_id = $1', [certificadoEspecificoId]);
            
            // Fetch subtablas GNV
            const gnvComponentes = await db.query('SELECT * FROM fg_certificado_gnv_componente WHERE certificado_id = $1 ORDER BY orden ASC', [certificadoEspecificoId]);
            const gnvVerificaciones = await db.query('SELECT * FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1', [certificadoEspecificoId]);
            
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
        }
    }
    return result;
};
