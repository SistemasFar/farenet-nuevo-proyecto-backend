const db = require('../config/database');

const obtenerMaestrosCaja = async (req, res) => {
    try {
        const [
            tiposPlaca,
            conceptos,
            categorias,
            tiposInspeccion,
            tiposCertificado,
            tiposAutorizacion
        ] = await Promise.all([
            db.query('SELECT id, nombre FROM tipoplaca ORDER BY nombre ASC'),
            db.query('SELECT key, COALESCE(abreviatura, nombre) AS abreviatura FROM conceptoinspeccion ORDER BY abreviatura ASC'),
            db.query('SELECT key, nombre FROM categoria ORDER BY nombre ASC'),
            db.query('SELECT key, codigosunat, nombre FROM tipoinspeccion ORDER BY nombre ASC'),
            db.query('SELECT key, COALESCE(abreviacion, nombre) AS abreviacion FROM tipocertificado ORDER BY abreviacion ASC'),
            db.query('SELECT key, ambito AS nombre FROM tipoautorizacion ORDER BY ambito ASC')
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                tiposPlaca: tiposPlaca.rows,
                conceptos: conceptos.rows,
                categorias: categorias.rows,
                tiposInspeccion: tiposInspeccion.rows,
                tiposCertificado: tiposCertificado.rows,
                tiposAutorizacion: tiposAutorizacion.rows
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

module.exports = {
    obtenerMaestrosCaja,
    obtenerPrecioConcepto
};
