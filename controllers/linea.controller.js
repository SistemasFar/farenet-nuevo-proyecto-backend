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

  async consolidar(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const payload = req.body;
      const updated = await LineaService.consolidarInspeccion(nroInspeccion, payload);
      res.json({ status: 'success', data: updated });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: error.message || 'Error al consolidar la inspección' });
    }
  }

  async soporteAction(req, res) {
    try {
      const { nroInspeccion, accion } = req.params;
      // Aquí se simularía la acción de soporte (Ej. Registro MTC)
      res.json({ status: 'success', message: `Acción ${accion} ejecutada simuladamente para ${nroInspeccion}` });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error al ejecutar acción de soporte' });
    }
  }
}

module.exports = new LineaController();
