const LineaService = require('../services/linea.service');

class LineaController {
  async getInspeccion(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const data = await LineaService.getInspeccionLinea(nroInspeccion);
      if (!data) return res.status(404).json({ message: 'No encontrado' });
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error al obtener inspección' });
    }
  }

  async savePaso(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const { paso, data } = req.body;
      const updated = await LineaService.updatePaso(nroInspeccion, paso, data);
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error al guardar paso' });
    }
  }
}

module.exports = new LineaController();
