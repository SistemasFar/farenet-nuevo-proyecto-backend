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
            db.query('SELECT key, nombre FROM conceptoinspeccion WHERE estado = true ORDER BY nombre ASC'),
            db.query('SELECT key, nombre FROM categoria ORDER BY nombre ASC'),
            db.query('SELECT key, codigosunat, nombre FROM tipoinspeccion ORDER BY nombre ASC'),
            db.query('SELECT key, abreviacion, nombre FROM tipocertificado ORDER BY nombre ASC'),
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

module.exports = {
    obtenerMaestrosCaja
};
