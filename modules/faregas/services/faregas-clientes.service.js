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

const texto = (value) => String(value ?? '').trim();

/**
 * Devuelve el maestro del cliente a partir de su identidad
 * (tipo_documento + nro_documento), creándolo si todavía no existe.
 *
 * Es la operación que usan todos los flujos que deben quedar relacionados con
 * fg_cliente en lugar de copiar sólo texto. Acepta un `queryable` para poder
 * participar de la transacción del llamador; por defecto usa el pool.
 *
 * Regla no destructiva: si el maestro ya existe sólo se COMPLETAN los campos
 * que están vacíos. Nunca se sobreescribe un dato válido con uno vacío, ni se
 * borra información previa. El histórico exacto de cada transacción lo
 * guardan los snapshots de la operación, no este maestro.
 */
exports.asegurarCliente = async (data, queryable = db) => {
    const tipoDocumento = texto(data?.tipoDocumento).toUpperCase();
    const nroDocumento = texto(data?.nroDocumento);
    const nombreRazonSocial = texto(data?.nombreRazonSocial);
    if (!tipoDocumento || !nroDocumento || !nombreRazonSocial) {
        throw new Error('DATOS_CLIENTE_REQUERIDOS');
    }

    const direccion = texto(data?.direccion) || null;
    const correo = texto(data?.correo).toLowerCase() || null;
    const telefono = texto(data?.telefono) || null;

    const SELECT_CLIENTE = `
        SELECT id, tipo_documento, nro_documento, nombre_razon_social,
               direccion, telefono, correo
        FROM fg_cliente
        WHERE tipo_documento = $1 AND nro_documento = $2
    `;
    const leer = async () => (await queryable.query(SELECT_CLIENTE, [tipoDocumento, nroDocumento])).rows[0] || null;

    let cliente = await leer();

    if (cliente) {
        // Completado no destructivo: sólo columnas vacías del maestro.
        const columnas = [];
        const valores = [];
        let idx = 1;
        if (!texto(cliente.direccion) && direccion) { columnas.push(`direccion = $${idx++}`); valores.push(direccion); }
        if (!texto(cliente.correo) && correo) { columnas.push(`correo = $${idx++}`); valores.push(correo); }
        if (!texto(cliente.telefono) && telefono) { columnas.push(`telefono = $${idx++}`); valores.push(telefono); }
        if (columnas.length > 0) {
            columnas.push('fecha_modificacion = CURRENT_TIMESTAMP');
            valores.push(cliente.id);
            await queryable.query(`UPDATE fg_cliente SET ${columnas.join(', ')} WHERE id = $${idx}`, valores);
            cliente = await leer();
        }
        return { ...cliente, id: Number(cliente.id), creado: false };
    }

    try {
        const insertado = await queryable.query(`
            INSERT INTO fg_cliente
            (tipo_documento, nro_documento, nombre_razon_social, direccion, telefono, correo, estado)
            VALUES ($1, $2, $3, $4, $5, $6, true)
            RETURNING id, tipo_documento, nro_documento, nombre_razon_social, direccion, telefono, correo
        `, [tipoDocumento, nroDocumento, nombreRazonSocial, direccion, telefono, correo]);
        return { ...insertado.rows[0], id: Number(insertado.rows[0].id), creado: true };
    } catch (e) {
        // Dos ventas simultáneas con el mismo documento: la UNIQUE
        // (tipo_documento, nro_documento) resuelve la carrera y la segunda
        // reutiliza el registro que ganó, en vez de fallar o duplicar.
        if (e.code === '23505') {
            const ganador = await leer();
            if (!ganador) throw e;
            return { ...ganador, id: Number(ganador.id), creado: false };
        }
        throw e;
    }
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
