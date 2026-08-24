const tarifasService = require('../services/faregas-tarifas.service');

exports.obtenerTarifasPorPlanta = async (req, res) => {
    try {
        const plantaKey = req.user.planta_key;
        if (!plantaKey) {
            return res.status(400).json({ success: false, message: 'No se encontró la planta en la sesión.' });
        }

        const catalogo = await tarifasService.obtenerCatalogoPorPlanta(plantaKey);
        if (!catalogo) {
            return res.status(404).json({ success: false, message: 'La sede no está disponible.' });
        }

        res.status(200).json({
            success: true,
            catalogo
        });
    } catch (error) {
        console.error('[obtenerTarifasPorPlanta Error]', error);
        res.status(500).json({ success: false, message: 'Error interno al obtener tarifas.' });
    }
};
