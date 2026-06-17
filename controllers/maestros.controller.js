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
            colores,
            carrocerias,
            combustibles
        ] = await Promise.all([
            db.query("SELECT MIN(key) as key, nombre FROM vehiculoclase WHERE nombre ~ '[a-zA-Z]' GROUP BY nombre ORDER BY nombre ASC"),
            db.query("SELECT MIN(key) as key, nombre FROM marca WHERE nombre ~ '[a-zA-Z]' GROUP BY nombre ORDER BY nombre ASC"),
            // Modelos removidos para cargarse asíncronamente
            db.query("SELECT MIN(key) as key, nombre FROM color WHERE nombre ~ '[a-zA-Z]' GROUP BY nombre ORDER BY nombre ASC"),
            db.query("SELECT MIN(key) as key, nombre FROM carroceria WHERE nombre ~ '[a-zA-Z]' GROUP BY nombre ORDER BY nombre ASC"),
            db.query("SELECT MIN(key) as key, nombre FROM combustible WHERE nombre ~ '[a-zA-Z]' GROUP BY nombre ORDER BY nombre ASC")
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                clases: clases.rows,
                marcas: marcas.rows,
                modelos: [], // Array vacío por retrocompatibilidad
                colores: colores.rows,
                carrocerias: carrocerias.rows,
                combustibles: combustibles.rows
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
                    clases: [], marcas: [], modelos: [], colores: [], carrocerias: [], combustibles: []
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

module.exports = {
    obtenerMaestrosCaja,
    obtenerPrecioConcepto,
    obtenerMaestrosPago,
    obtenerMaestrosVehiculo,
    buscarModelosVehiculo
};
