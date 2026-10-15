const db = require('../../../config/database');
const farenetReadAdapter = require('../integrations/farenet-read.adapter');
const vehiculosService = require('./faregas-vehiculos.service');

const APIS_NET_PE_BASE_URL = 'https://api.decolecta.com/v1';
const TIPOS_DOCUMENTO_CONSULTA = Object.freeze({
    DNI: { longitud: 8, soloDigitos: true, proveedor: 'RENIEC' },
    RUC: { longitud: 11, soloDigitos: true, proveedor: 'SUNAT' },
    CARNETEXTRANJERIA: { longitud: null, soloDigitos: false, proveedor: null }
});

exports.buscarClientePropio = async (tipoDocumento, nroDocumento, opciones = {}) => {
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
                WHERE tipo_documento_cliente = $1
                  AND nro_documento = $2
                  AND (email IS NOT NULL OR telefono IS NOT NULL)
                ORDER BY id DESC LIMIT 1
            `, [tipoDocumento, nroDocumento]);
            if (fac.rows.length > 0) {
                if (!cliente.correo) cliente.correo = fac.rows[0].correo || null;
                if (!cliente.telefono) cliente.telefono = fac.rows[0].telefono || null;
            }
        }
    } else if (opciones.incluirFacturacionHistorica !== false) {
        const fac = await db.query(`
            SELECT email as correo, telefono, nombre_razon_social as "nombreRazonSocial", direccion
            FROM fg_facturacion 
            WHERE tipo_documento_cliente = $1 AND nro_documento = $2
            ORDER BY id DESC LIMIT 1
        `, [tipoDocumento, nroDocumento]);
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

/**
 * Consulta un documento de cliente con estrategia Local-First (fg_cliente)
 * y fallback externo a SUNAT (RUC 11 dígitos) o RENIEC/DNI (8 dígitos).
 */
exports.consultarDocumento = async (tipoDocumento, numeroDocumento, opciones = {}) => {
    // Compatibilidad con el endpoint anterior: sólo para DNI/RUC se puede
    // inferir el tipo por longitud cuando el consumidor todavía envía un dato.
    let tipoNormalizado = String(tipoDocumento || '').trim().toUpperCase();
    let numeroRecibido = numeroDocumento;
    if (numeroDocumento === undefined) {
        numeroRecibido = tipoDocumento;
        const soloDigitos = String(numeroRecibido || '').replace(/\D/g, '');
        tipoNormalizado = soloDigitos.length === 11 ? 'RUC' : soloDigitos.length === 8 ? 'DNI' : '';
        if (!tipoNormalizado) throw new Error('DOCUMENTO_INVALIDO');
    }

    const regla = TIPOS_DOCUMENTO_CONSULTA[tipoNormalizado];
    if (!regla) throw new Error('TIPO_DOCUMENTO_INVALIDO');

    const textoDocumento = String(numeroRecibido || '').trim().toUpperCase();
    const docNormalizado = regla.soloDigitos
        ? textoDocumento.replace(/\D/g, '')
        : textoDocumento.replace(/[^A-Z0-9]/g, '');
    const documentoInvalido = !docNormalizado
        || (regla.soloDigitos && !/^\d+$/.test(textoDocumento))
        || (!regla.soloDigitos && textoDocumento !== docNormalizado)
        || (regla.longitud !== null && docNormalizado.length !== regla.longitud)
        || (regla.longitud === null && docNormalizado.length > 20);
    if (documentoInvalido) throw new Error('DOCUMENTO_INVALIDO');

    // 1. FAREGAS FIRST: buscar en fg_cliente
    const clientePropio = opciones.omitirBusquedaLocal
        ? null
        : await exports.buscarClientePropio(tipoNormalizado, docNormalizado, {
            incluirFacturacionHistorica: false
        });
    if (clientePropio && clientePropio.nombreRazonSocial) {
        const cliente = {
            documento: docNormalizado,
            tipoDocumento: tipoNormalizado,
            nombreRazonSocial: clientePropio.nombreRazonSocial,
            direccion: clientePropio.direccion || null,
            correo: clientePropio.correo || null,
            telefono: clientePropio.telefono || null,
            clienteExistente: true,
            id: clientePropio.id || null
        };
        return {
            encontrado: true,
            origen: 'FAREGAS',
            mensaje: 'Datos recuperados de Faregas.',
            tipoDocumento: tipoNormalizado,
            numeroDocumento: docNormalizado,
            cliente,
            data: cliente
        };
    }

    if (!regla.proveedor) {
        return {
            encontrado: false,
            origen: 'SIN_PROVEEDOR_PARA_TIPO',
            proveedor: null,
            tipoDocumento: tipoNormalizado,
            numeroDocumento: docNormalizado,
            mensaje: 'No existe consulta externa configurada para este tipo de documento. Complete los datos manualmente.',
            data: null
        };
    }

    // 2. FALLBACK EXTERNO: SUNAT para RUC (11 dígitos) o RENIEC para DNI (8 dígitos)
    const token = process.env.API_DNI_TOKEN;

    if (!token) {
        return {
            encontrado: false,
            origen: 'EXTERNO_NO_CONFIGURADO',
            proveedor: regla.proveedor,
            tipoDocumento: tipoNormalizado,
            numeroDocumento: docNormalizado,
            mensaje: 'La consulta externa de documentos no está configurada.',
            data: null
        };
    }

    const inicioConsulta = Date.now();
    try {
        const axios = require('axios');
        const configProveedor = {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`
            },
            timeout: 6000
        };
        if (tipoNormalizado === 'RUC') {
            const response = await axios.get(
                `${APIS_NET_PE_BASE_URL}/sunat/ruc?numero=${docNormalizado}`,
                configProveedor
            );
            const nombreRazonSocial = response.data?.razonSocial || response.data?.nombre || '';
            if (nombreRazonSocial) {
                const clienteLocal = await exports.asegurarCliente({
                    tipoDocumento: 'RUC',
                    nroDocumento: docNormalizado,
                    nombreRazonSocial,
                    direccion: response.data.direccion || null
                });
                const cliente = {
                    documento: docNormalizado,
                    tipoDocumento: 'RUC',
                    nombreRazonSocial,
                    direccion: response.data.direccion || null,
                    departamento: response.data.departamento || null,
                    provincia: response.data.provincia || null,
                    distrito: response.data.distrito || null,
                    correo: null,
                    telefono: null,
                    clienteExistente: false,
                    id: clienteLocal.id
                };
                return {
                    encontrado: true,
                    origen: 'SUNAT',
                    proveedor: 'SUNAT',
                    mensaje: 'Datos obtenidos de consulta RUC.',
                    tipoDocumento: 'RUC',
                    numeroDocumento: docNormalizado,
                    httpStatus: response.status || 200,
                    duracionMs: Date.now() - inicioConsulta,
                    cliente,
                    data: cliente
                };
            }
            return {
                encontrado: false,
                origen: 'NO_ENCONTRADO',
                proveedor: 'SUNAT',
                mensaje: 'No se encontraron datos para este documento.',
                tipoDocumento: 'RUC',
                numeroDocumento: docNormalizado,
                httpStatus: response.status || 200,
                duracionMs: Date.now() - inicioConsulta,
                data: null
            };
        } else if (tipoNormalizado === 'DNI') {
            const response = await axios.get(
                `${APIS_NET_PE_BASE_URL}/reniec/dni?numero=${docNormalizado}`,
                configProveedor
            );
            if (response.data) {
                const apellidos = `${response.data.apellidoPaterno || ''} ${response.data.apellidoMaterno || ''}`.trim();
                const nombres = response.data.nombres || '';
                const nombreCompleto = `${apellidos} ${nombres}`.trim() || response.data.nombre || nombres;
                if (nombreCompleto) {
                    const clienteLocal = await exports.asegurarCliente({
                        tipoDocumento: 'DNI',
                        nroDocumento: docNormalizado,
                        nombreRazonSocial: nombreCompleto,
                        direccion: response.data.direccion || null
                    });
                    const cliente = {
                        documento: docNormalizado,
                        tipoDocumento: 'DNI',
                        nombreRazonSocial: nombreCompleto,
                        nombres: nombres || null,
                        apellidos: apellidos || null,
                        direccion: response.data.direccion || null,
                        correo: null,
                        telefono: null,
                        clienteExistente: false,
                        id: clienteLocal.id
                    };
                    return {
                        encontrado: true,
                        origen: 'RENIEC',
                        proveedor: 'RENIEC',
                        mensaje: 'Datos obtenidos de consulta DNI.',
                        tipoDocumento: 'DNI',
                        numeroDocumento: docNormalizado,
                        httpStatus: response.status || 200,
                        duracionMs: Date.now() - inicioConsulta,
                        cliente,
                        data: cliente
                    };
                }
            }
            return {
                encontrado: false,
                origen: 'NO_ENCONTRADO',
                proveedor: 'RENIEC',
                mensaje: 'No se encontraron datos para este documento.',
                tipoDocumento: 'DNI',
                numeroDocumento: docNormalizado,
                httpStatus: response.status || 200,
                duracionMs: Date.now() - inicioConsulta,
                data: null
            };
        }
    } catch (externoErr) {
        const httpStatus = externoErr.response?.status || null;
        const esTimeout = externoErr.code === 'ECONNABORTED'
            || externoErr.code === 'ETIMEDOUT'
            || httpStatus === 408
            || httpStatus === 504
            || /timeout/i.test(externoErr.message || '');
        console.warn('Consulta externa de documentos no disponible.', {
            proveedor: regla.proveedor,
            tipoDocumento: tipoNormalizado,
            httpStatus,
            codigo: externoErr.code || null,
            mensaje: externoErr.message
        });
        if (httpStatus === 401 || httpStatus === 403) {
            return {
                encontrado: false,
                origen: 'EXTERNO_NO_AUTORIZADO',
                proveedor: regla.proveedor,
                tipoDocumento: tipoNormalizado,
                numeroDocumento: docNormalizado,
                httpStatus,
                duracionMs: Date.now() - inicioConsulta,
                mensaje: 'No fue posible autenticar la consulta externa.',
                data: null
            };
        }
        if (httpStatus === 404) {
            return {
                encontrado: false,
                origen: 'NO_ENCONTRADO',
                proveedor: regla.proveedor,
                tipoDocumento: tipoNormalizado,
                numeroDocumento: docNormalizado,
                httpStatus,
                duracionMs: Date.now() - inicioConsulta,
                mensaje: 'No se encontraron datos para este documento.',
                data: null
            };
        }
        if (esTimeout) {
            return {
                encontrado: false,
                origen: 'EXTERNO_TIMEOUT',
                proveedor: regla.proveedor,
                tipoDocumento: tipoNormalizado,
                numeroDocumento: docNormalizado,
                httpStatus,
                duracionMs: Date.now() - inicioConsulta,
                mensaje: 'El servicio de consulta no está disponible temporalmente.',
                data: null
            };
        }
        return {
            encontrado: false,
            origen: 'ERROR_EXTERNO',
            proveedor: regla.proveedor,
            tipoDocumento: tipoNormalizado,
            numeroDocumento: docNormalizado,
            httpStatus,
            duracionMs: Date.now() - inicioConsulta,
            mensaje: 'No fue posible consultar el documento. Puede completar los datos manualmente.',
            data: null
        };
    }

    return {
        encontrado: false,
        origen: 'NO_ENCONTRADO',
        proveedor: regla.proveedor,
        mensaje: 'No se encontraron datos para este documento. Puede continuar ingresando los datos manualmente.',
        data: null
    };
};
