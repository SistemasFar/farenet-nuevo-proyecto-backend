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
      res.json({ status: 'success', message: `Acción ${accion} ejecutada simuladamente para ${nroInspeccion}` });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error al ejecutar acción de soporte' });
    }
  }

  async appresultado(req, res) {
    try {
      const payload = req.body;
      const result = await LineaService.guardarResultadoMaquina(payload);
      res.json({ status: 'success', data: result });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: error.message || 'Error en appresultado' });
    }
  }

  async getPruebasObligatorias(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const ValidarEtapaService = require('../services/validar_etapa.service');
      const pruebas = await ValidarEtapaService.getPruebasObligatorias(nroInspeccion);
      res.json({ status: 'success', data: pruebas });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: error.message || 'Error al obtener pruebas obligatorias' });
    }
  }

  async getEstado(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const ValidarEtapaService = require('../services/validar_etapa.service');
      const validacionEtapa = await ValidarEtapaService.validarEtapa(nroInspeccion);
      
      const insp = await LineaService.getInspeccionLinea(nroInspeccion);
      
      res.json({
        ok: true,
        nrodocumentoinspeccion: nroInspeccion,
        posicionActual: insp ? insp.posicion : null,
        obligatorias: validacionEtapa.obligatorias,
        recibidas: validacionEtapa.recibidas,
        faltantes: validacionEtapa.faltantes,
        noAplicables: validacionEtapa.noAplicables,
        etapaCompleta: validacionEtapa.etapaCompleta,
        puedeConsolidar: validacionEtapa.etapaCompleta,
        resultadoPreliminar: validacionEtapa.resultadoPreliminar
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, message: error.message || 'Error al consultar estado' });
    }
  }

  async getConsolidacionDatos(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const datos = await LineaService.obtenerDatosConsolidacion(nroInspeccion);
      
      let modo = 'SOLO_LECTURA';
      if (datos.inspeccion.posicion === 14 && datos.inspeccion.inspeccionestado_key !== 'CON') {
          modo = 'LISTO_PARA_CONSOLIDAR';
      }

      res.json({
        ok: true,
        modo,
        ...datos
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, message: error.message || 'Error al consultar consolidación' });
    }
  }

  // =========================================================================
  // FASE 9.5 — Endpoint de guardado transaccional de consolidación
  // =========================================================================
  async guardarConsolidacion(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const payload = req.body;

      // Validar que vengan los campos requeridos
      if (!payload.ingenieroCertificadorUsername) {
        return res.status(400).json({ ok: false, message: 'Se requiere ingenieroCertificadorUsername.' });
      }
      if (!payload.usuarioConsolidadorUsername) {
        return res.status(400).json({ ok: false, message: 'Se requiere usuarioConsolidadorUsername. (Provisional hasta JWT)' });
      }

      const resultado = await LineaService.guardarConsolidacion(nroInspeccion, payload);
      return res.status(200).json(resultado);

    } catch (err) {
      console.error('[guardarConsolidacion] ERROR:', err);

      const statusCode = err.statusCode || 500;
      // Si el error tiene estructura rica (409 con info adicional), la devolvemos
      if (err.statusCode) {
        return res.status(statusCode).json({
          ok: false,
          message: err.message,
          nrodocumentoinspeccion: err.nrodocumentoinspeccion,
          estado: err.estado,
          posicion: err.posicion
        });
      }
      return res.status(500).json({ ok: false, message: err.message || 'Error interno al guardar consolidación.' });
    }
  }
}

module.exports = new LineaController();
