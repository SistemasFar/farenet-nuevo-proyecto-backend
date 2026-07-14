const db = require('../config/database');

const obtenerMaestrosCaja = async (req, res) => {
    try {
        const [
            tiposPlaca,
            conceptos,
            categorias,
            tiposInspeccion,
            tiposCertificado,
            tiposAutorizacion,
            tiposDocumento
        ] = await Promise.all([
            db.query('SELECT id, nombre FROM tipoplaca ORDER BY nombre ASC'),
            db.query('SELECT key, COALESCE(abreviatura, nombre) AS abreviatura FROM conceptoinspeccion ORDER BY abreviatura ASC'),
            db.query('SELECT key, nombre FROM categoria ORDER BY nombre ASC'),
            db.query('SELECT key, codigosunat, nombre FROM tipoinspeccion ORDER BY nombre ASC'),
            db.query('SELECT key, COALESCE(abreviacion, nombre) AS abreviacion FROM tipocertificado ORDER BY abreviacion ASC'),
            db.query('SELECT key, ambito AS nombre FROM tipoautorizacion ORDER BY ambito ASC'),
            db.query('SELECT key, nombre FROM tipodocumento ORDER BY nombre ASC')
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                tiposPlaca: tiposPlaca.rows,
                conceptos: conceptos.rows,
                categorias: categorias.rows,
                tiposInspeccion: tiposInspeccion.rows,
                tiposCertificado: tiposCertificado.rows,
                tiposAutorizacion: tiposAutorizacion.rows,
                tiposDocumento: tiposDocumento.rows
            }
        });
    } catch (error) {
        console.error('Error al obtener maestros para caja:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor al consultar tablas maestras.'
        });
    }
};

const obtenerPrecioConcepto = async (req, res) => {
    try {
        const { planta_key, concepto_key } = req.query;

        if (!planta_key || !concepto_key) {
            return res.status(400).json({
                status: 'error',
                message: 'Se requieren planta_key y concepto_key.'
            });
        }

        const result = await db.query(
            'SELECT valor FROM conceptoinspecciondetalle WHERE planta_key = $1 AND conceptoinspeccion_key = $2',
            [planta_key, concepto_key]
        );

        const valor = result.rows.length > 0 ? result.rows[0].valor : 0;

        return res.status(200).json({
            status: 'success',
            data: {
                precio: valor
            }
        });
    } catch (error) {
        console.error('Error al obtener precio de concepto:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor al consultar precio.'
        });
    }
};

const obtenerMaestrosPago = async (req, res) => {
    try {
        const [
            formasPago,
            tarjetas,
            entidadesFinancieras,
            cuentasCorrientes
        ] = await Promise.all([
            db.query('SELECT key, nombre FROM formapago ORDER BY nombre ASC'),
            db.query('SELECT key, nombre FROM tarjeta ORDER BY nombre ASC'),
            db.query('SELECT key, nombre FROM entidadfinanciera ORDER BY nombre ASC'),
            db.query('SELECT key, nroctacorriente AS nombre, entidadfinanciera_key FROM cuentacorriente ORDER BY nroctacorriente ASC')
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                formasPago: formasPago.rows,
                tarjetas: tarjetas.rows,
                entidadesFinancieras: entidadesFinancieras.rows,
                cuentasCorrientes: cuentasCorrientes.rows
            }
        });
    } catch (error) {
        console.error('Error al obtener maestros de pago:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor al consultar maestros de pago.'
        });
    }
};

const obtenerMaestrosVehiculo = async (req, res) => {
    try {
        const [
            clases,
            marcas,
            carrocerias,
            combustibles,
            categoriasExtra,
            tiposPoliza,
            aseguradoras
        ] = await Promise.all([
            db.query("SELECT MIN(key) as key, nombre FROM vehiculoclase WHERE nombre ~ '[a-zA-Z]' GROUP BY nombre ORDER BY nombre ASC"),
            db.query("SELECT MIN(key) as key, nombre FROM marca WHERE nombre ~ '[a-zA-Z]' GROUP BY nombre ORDER BY nombre ASC"),
            // Modelos y Colores removidos para cargarse asíncronamente
            db.query("SELECT MIN(key) as key, nombre FROM carroceria WHERE nombre ~ '[a-zA-Z]' GROUP BY nombre ORDER BY nombre ASC"),
            db.query("SELECT MIN(key) as key, nombre FROM combustible WHERE nombre ~ '[a-zA-Z]' GROUP BY nombre ORDER BY nombre ASC"),
            db.query("SELECT DISTINCT categoriaextra as key, categoriaextra as nombre FROM vehiculo WHERE categoriaextra IS NOT NULL AND categoriaextra != '-SD' ORDER BY categoriaextra ASC"),
            db.query("SELECT MIN(key) as key, nombre FROM tipopoliza WHERE nombre ~ '[a-zA-Z]' GROUP BY nombre ORDER BY nombre ASC"),
            db.query("SELECT MIN(key) as key, nombre FROM aseguradora WHERE nombre ~ '[a-zA-Z]' GROUP BY nombre ORDER BY nombre ASC")
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                clases: clases.rows,
                marcas: marcas.rows,
                modelos: [], // Array vacío por retrocompatibilidad
                colores: [], // Array vacío porque ahora es AsyncSelect

                carrocerias: carrocerias.rows,
                combustibles: combustibles.rows,
                categoriasExtra: categoriasExtra.rows,
                tiposPoliza: tiposPoliza.rows,
                aseguradoras: aseguradoras.rows
            }
        });
    } catch (error) {
        console.error('Error al obtener maestros para vehículo:', error);
        // Si hay error por una tabla que no existe, devolver array vacío para no quebrar el frontend
        if (error.code === '42P01') {
            console.warn('Algunas tablas maestras de vehículos no existen aún. Devolviendo data vacía.');
            return res.status(200).json({
                status: 'success',
                data: {
                    clases: [], marcas: [], modelos: [], colores: [], carrocerias: [], combustibles: [], categoriasExtra: [], tiposPoliza: [], aseguradoras: []
                }
            });
        }
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor al consultar maestros de vehículo.'
        });
    }
};

const buscarModelosVehiculo = async (req, res) => {
    try {
        const query = req.query.q || '';
        const limit = 50;

        let sql = "SELECT MIN(key) as key, nombre FROM modelo WHERE nombre ~ '[a-zA-Z]' ";
        let params = [];

        if (query.trim() !== '') {
            sql += " AND nombre ILIKE $1 ";
            params.push(`%${query.trim()}%`);
        }

        sql += " GROUP BY nombre ORDER BY nombre ASC LIMIT " + limit;

        const result = await db.query(sql, params);

        return res.status(200).json({
            status: 'success',
            data: result.rows
        });
    } catch (error) {
        console.error('Error al buscar modelos de vehículo:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor al buscar modelos.'
        });
    }
};

const buscarColoresVehiculo = async (req, res) => {
    try {
        const query = req.query.q || '';
        const limit = 50;

        let sql = "SELECT MIN(key) as key, nombre FROM color WHERE nombre ~ '[a-zA-Z]' ";
        let params = [];

        if (query.trim() !== '') {
            sql += " AND nombre ILIKE $1 ";
            params.push(`%${query.trim()}%`);
        }

        sql += " GROUP BY nombre ORDER BY nombre ASC LIMIT " + limit;

        const result = await db.query(sql, params);

        return res.status(200).json({
            status: 'success',
            data: result.rows
        });
    } catch (error) {
        console.error('Error al buscar colores:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor.'
        });
    }
};

const agregarNuevoMaestro = async (req, res) => {
    try {
        const { tabla, nombre } = req.body;
        
        // Tablas permitidas para evitar SQL Injection
        const tablasPermitidas = {
            'clase': 'vehiculoclase',
            'marca': 'marca',
            'carroceria': 'carroceria',
            'modelo': 'modelo',
            'color': 'color'
        };

        const tablaReal = tablasPermitidas[tabla];
        if (!tablaReal) {
            return res.status(400).json({ status: 'error', message: 'Tabla no válida' });
        }

        // Validación extra en el backend: Solo mayúsculas, números y guiones intermedios
        if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(nombre)) {
            return res.status(400).json({ status: 'error', message: 'Formato inválido. Solo mayúsculas, números y guiones intermedios permitidos.' });
        }

        // Verificar si existe
        const existe = await db.query(`SELECT key, nombre FROM ${tablaReal} WHERE nombre ILIKE $1 LIMIT 1`, [nombre]);
        
        if (existe.rows.length > 0) {
            return res.status(400).json({ status: 'error', message: `El valor "${nombre}" ya existe.` });
        }

        await db.query(`INSERT INTO ${tablaReal} (key, nombre) VALUES ($1, $2)`, [nombre, nombre]);

        return res.status(200).json({
            status: 'success',
            message: `Agregado correctamente a ${tabla}`,
            data: { key: nombre, nombre: nombre }
        });

    } catch (error) {
        console.error('Error al agregar maestro:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor al agregar el maestro.'
        });
    }
};

const obtenerMaestrosPropietario = async (req, res) => {
    try {
        const [tiposDocumento, paises, departamentos] = await Promise.all([
            db.query("SELECT key, nombre FROM tipodocumentoidentidad ORDER BY nombre ASC"),
            db.query("SELECT key, nombre FROM pais ORDER BY nombre ASC"),
            db.query("SELECT key, nombre FROM departamento ORDER BY nombre ASC")
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                tiposDocumento: tiposDocumento.rows,
                paises: paises.rows,
                departamentos: departamentos.rows
            }
        });
    } catch (error) {
        console.error('Error al obtener maestros para propietario:', error);
        return res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
};

const obtenerProvincias = async (req, res) => {
    try {
        const { departamento_key } = req.params;
        const result = await db.query("SELECT key, nombre FROM provincia WHERE departamento_key = $1 ORDER BY nombre ASC", [departamento_key]);
        return res.status(200).json({ status: 'success', data: result.rows });
    } catch (error) {
        console.error('Error al obtener provincias:', error);
        return res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
};

const obtenerDistritos = async (req, res) => {
    try {
        const { provincia_key } = req.params;
        const result = await db.query("SELECT key, nombre FROM distrito WHERE provincia_key = $1 ORDER BY nombre ASC", [provincia_key]);
        return res.status(200).json({ status: 'success', data: result.rows });
    } catch (error) {
        console.error('Error al obtener distritos:', error);
        return res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
};

const obtenerMaestrosVerificacion = async (req, res) => {
    try {
        const [
            tiposInspeccion,
            tiposCertificado,
            tiposAutorizacion
        ] = await Promise.all([
            db.query("SELECT key, nombre FROM tipoinspeccion ORDER BY nombre ASC"),
            db.query("SELECT key, COALESCE(abreviacion, nombre) AS nombre FROM tipocertificado ORDER BY nombre ASC"),
            db.query("SELECT key, ambito AS nombre FROM tipoautorizacion ORDER BY ambito ASC")
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                tiposInspeccion: tiposInspeccion.rows,
                tiposCertificado: tiposCertificado.rows,
                tiposAutorizacion: tiposAutorizacion.rows
            }
        });
    } catch (error) {
        console.error('Error al obtener maestros para verificacion:', error);
        return res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
};

const obtenerLineasPorPlanta = async (req, res) => {
    try {
        const { planta_key } = req.params;
        const result = await db.query("SELECT key, nombre FROM linea WHERE planta_key = $1 ORDER BY nombre ASC", [planta_key]);
        return res.status(200).json({ status: 'success', data: result.rows });
    } catch (error) {
        console.error('Error al obtener lineas:', error);
        return res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
};

const obtenerIngenieros = async (req, res) => {
    try {
        const { planta_key } = req.params;
        
        if (!planta_key) {
            return res.status(400).json({
                status: 'error',
                message: 'Se requiere planta_key.'
            });
        }

        const result = await db.query(
            `SELECT 
               u.username as id, 
               u.username,
               p.nombres, 
               p.apellidos,
               perf.clave as perfil,
               CASE WHEN u.firmacertificador IS NOT NULL AND u.firmacertificador != '' THEN true ELSE false END as tiene_firma
             FROM usuario u
             JOIN perfil perf ON u.perfil_id = perf.clave
             JOIN usuario_planta up ON u.username = up.usuario_username
             LEFT JOIN persona p ON u.persona_nrodocumentoidentidad = p.nrodocumentoidentidad
             WHERE perf.clave = 'ing_certificador' 
               AND up.plantas_key = $1 
               AND u.estado = true`,
            [planta_key]
        );

        return res.status(200).json({
            ok: true,
            planta: planta_key,
            ingenieros: result.rows.map(row => ({
                id: row.id,
                username: row.username,
                nombre: `${row.nombres || ''} ${row.apellidos || ''}`.trim(),
                nombreCompleto: `${row.nombres || ''} ${row.apellidos || ''}`.trim(),
                perfil: row.perfil,
                tieneFirma: row.tiene_firma
            }))
        });
    } catch (error) {
        console.error('Error al obtener ingenieros:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor al consultar ingenieros.'
        });
    }
};

module.exports = {
    obtenerMaestrosCaja,
    obtenerPrecioConcepto,
    obtenerMaestrosPago,
    obtenerMaestrosVehiculo,
    buscarModelosVehiculo,
    buscarColoresVehiculo,
    agregarNuevoMaestro,
    obtenerMaestrosPropietario,
    obtenerProvincias,
    obtenerDistritos,
    obtenerMaestrosVerificacion,
    obtenerLineasPorPlanta,
    obtenerIngenieros
};
