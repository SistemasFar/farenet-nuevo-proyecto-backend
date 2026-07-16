const LineaService = require('../services/linea.service');
const CertificadoPreviewService = require('../services/certificadoPreview.service');

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

  async cambiarFoto(req, res) {
    try {
      const userPerfil = String(req.user?.perfilId || '').toLowerCase().trim();
      const esSistemas = userPerfil.includes('sistema') || userPerfil.includes('admin') || userPerfil.includes('desarrollador');
      if (!esSistemas) {
        return res.status(403).json({ message: 'Solo usuarios del perfil Sistemas pueden ejecutar esta acción.' });
      }

      const { nroInspeccion } = req.params;
      const { tipoFoto } = req.body;
      const file = req.file;
      const username = req.user ? req.user.username : 'sistema';
      
      if (!file) {
        return res.status(400).json({ message: 'Archivo de foto es requerido' });
      }
      
      const result = await LineaService.cambiarFoto(nroInspeccion, tipoFoto, file, username);
      res.json({ message: 'Foto actualizada correctamente', result });
    } catch (error) {
      console.error('Error al cambiar foto:', error.message);
      res.status(500).json({ message: error.message || 'Error interno' });
    }
  }

  async reiniciarFoto(req, res) {
    try {
      const userPerfil = String(req.user?.perfilId || '').toLowerCase().trim();
      const esSistemas = userPerfil.includes('sistema') || userPerfil.includes('admin') || userPerfil.includes('desarrollador');
      if (!esSistemas) {
        return res.status(403).json({ message: 'Solo usuarios del perfil Sistemas pueden ejecutar esta acción.' });
      }

      const { nroInspeccion } = req.params;
      const { tipoFoto } = req.body;
      
      const result = await LineaService.reiniciarFoto(nroInspeccion, tipoFoto);
      res.json({ message: 'Foto reiniciada correctamente', result });
    } catch (error) {
      console.error('Error al reiniciar foto:', error.message);
      res.status(500).json({ message: error.message || 'Error interno' });
    }
  }

  async reiniciarPrueba(req, res) {
    try {
      const userPerfil = String(req.user?.perfilId || '').toLowerCase().trim();
      const esSistemas = userPerfil.includes('sistema') || userPerfil.includes('admin') || userPerfil.includes('desarrollador');
      if (!esSistemas) {
        return res.status(403).json({ message: 'Solo usuarios del perfil Sistemas pueden ejecutar esta acción.' });
      }

      const { nroInspeccion } = req.params;
      const { resultadoMaquinaId, tipoMaquinaKey } = req.body;
      
      if (!resultadoMaquinaId) {
        return res.status(400).json({ message: 'ID de resultado requerido' });
      }
      
      const result = await LineaService.reiniciarPrueba(nroInspeccion, resultadoMaquinaId, tipoMaquinaKey);
      res.json({ message: 'Prueba reiniciada correctamente', result });
    } catch (error) {
      console.error('Error al reiniciar prueba:', error.message);
      res.status(500).json({ message: error.message || 'Error interno' });
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

  async anularInspeccion(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const { motivo } = req.body;
      
      const updated = await LineaService.anularInspeccion(nroInspeccion, motivo, req.user.username);
      res.json({ status: 'success', data: updated });
    } catch (error) {
      console.error(error);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Error al anular la inspección' });
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

  async cambiarObservacion(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const { observacion } = req.body;
      
      if (typeof observacion !== 'string') {
        return res.status(400).json({ message: 'La observación debe ser un texto válido' });
      }

      if (observacion.length > 1000) {
        return res.status(400).json({ message: 'La observación no puede superar los 1000 caracteres' });
      }

      const result = await LineaService.cambiarObservacion(nroInspeccion, observacion);
      res.json({ status: 'success', data: result });
    } catch (error) {
      console.error(error);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Error al cambiar observación' });
    }
  }

  async guardarDatosConsolidacion(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const { ingenieroCertificadorUsername, observacion } = req.body;
      const result = await LineaService.guardarDatosConsolidacion(nroInspeccion, ingenieroCertificadorUsername, observacion);
      res.json({ status: 'success', data: result });
    } catch (error) {
      console.error(error);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Error al guardar datos de consolidación' });
    }
  }

  async registrarPoliza(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const data = req.body;
      const result = await LineaService.registrarPoliza(nroInspeccion, data);
      res.json({ status: 'success', data: result });
    } catch (error) {
      console.error(error);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Error al registrar póliza' });
    }
  }

  async cambiarLinea(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const { lineaKey } = req.body;
      const result = await LineaService.cambiarLinea(nroInspeccion, lineaKey);
      res.json({ status: 'success', data: result });
    } catch (error) {
      console.error(error);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Error al cambiar línea' });
    }
  }

  async cambiarMotor(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const { nroMotor } = req.body;
      const result = await LineaService.cambiarMotor(nroInspeccion, nroMotor);
      res.json({ status: 'success', data: result });
    } catch (error) {
      console.error(error);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Error al cambiar motor' });
    }
  }

  async cambiarFirma(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const { ingenieroCertificadorUsername } = req.body;
      const result = await LineaService.cambiarFirma(nroInspeccion, ingenieroCertificadorUsername);
      res.json({ status: 'success', data: result });
    } catch (error) {
      console.error(error);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Error al cambiar firma' });
    }
  }

  async appresultado(req, res) {
    try {
      const payload = req.body;
      const result = await LineaService.guardarResultadoMaquina(payload);
      res.json({ status: 'success', data: result });
    } catch (error) {
      console.error(error);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Error en appresultado' });
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
      
      let modo = 'LINEA_EN_PROCESO';
      if (insp) {
        if (insp.inspeccionestado_key === 'CON') modo = 'HISTORICO_CONSOLIDADO';
        else if (insp.inspeccionestado_key === 'ANU') modo = 'HISTORICO_ANULADO';
        else if (insp.inspeccionestado_key === 'RETIRADO') modo = 'HISTORICO_RETIRADO';
        else if (insp.posicion === 14) modo = 'LISTA_PARA_CONSOLIDAR';
      }

      const isHistorico = modo.startsWith('HISTORICO_');

      // Si es histórico, lo que rige es lo que hay, no lo que falta
      const recibidasReales = isHistorico ? validacionEtapa.recibidas : validacionEtapa.recibidas;
      const faltantesReales = isHistorico ? [] : validacionEtapa.faltantes;

      res.json({
        ok: true,
        nrodocumentoinspeccion: nroInspeccion,
        posicionActual: insp ? insp.posicion : null,
        inspeccionestado_key: insp ? insp.inspeccionestado_key : null,
        modo,
        resultado: insp ? (insp.resultado || validacionEtapa.resultadoPreliminar) : validacionEtapa.resultadoPreliminar,
        fechconsolidado: insp ? insp.fechconsolidado : null,
        fechiniciovigencia: insp ? insp.fechiniciovigencia : null,
        obligatorias: isHistorico ? recibidasReales : validacionEtapa.obligatorias,
        recibidas: recibidasReales,
        faltantes: faltantesReales,
        noAplicables: validacionEtapa.noAplicables,
        etapaCompleta: validacionEtapa.etapaCompleta,
        puedeConsolidar: isHistorico ? false : validacionEtapa.etapaCompleta,
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
      
      const usuarioConsolidadorUsername = req.user.username;
      
      // Ignorar cualquier usuario en el body maliciosamente enviado
      delete payload.usuarioConsolidadorUsername;
      
      payload.usuarioConsolidadorUsername = usuarioConsolidadorUsername;

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
  async obtenerRecibo(req, res, next) {
    try {
      const { nroInspeccion } = req.params;
      const recibo = await LineaService.obtenerRecibo(nroInspeccion);
      res.json({ ok: true, recibo });
    } catch (error) {
      next(error);
    }
  }

  async getWizardModel(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const data = await LineaService.getWizardModel(nroInspeccion);
      res.json({ ok: true, ...data });
    } catch (error) {
      console.error('Error al obtener wizard model:', error);
      res.status(500).json({ 
        ok: false, 
        message: error.message || 'Error al obtener los datos del wizard.'
      });
    }
  }

  async getPropietario(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const propietario = await LineaService.obtenerPropietario(nroInspeccion);
      res.json({ ok: true, propietario });
    } catch (error) {
      console.error('Error al obtener propietario:', error);
      const status = error.statusCode || 500;
      res.status(status).json({ 
        ok: false, 
        message: error.message || 'Error al obtener los datos del propietario.'
      });
    }
  }

  async modificarPropietario(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const payload = req.body;
      const usuarioActualUsername = req.user?.username || 'sistema';

      const result = await LineaService.modificarPropietario(nroInspeccion, payload, usuarioActualUsername);

      res.json({ ok: true, propietario: result });
    } catch (error) {
      console.error('Error al modificar propietario:', error);
      const status = error.statusCode || 500;
      res.status(status).json({ 
        ok: false, 
        message: error.message || 'Error al modificar los datos del propietario.'
      });
    }
  }

  async obtenerPreVisualizacion(req, res) {
    try {
      const { nroInspeccion } = req.params;
      const user = req.user;
      
      const html = await CertificadoPreviewService.generarHtmlPrevisualizacion(nroInspeccion, user);

      return res.json({
        ok: true,
        html: html
      });

    } catch (error) {
      console.error('[PREVISUALIZACION_ERROR]', {
        nroInspeccion: req.params.nroInspeccion,
        message: error.message,
        stack: error.stack
      });
      res.status(500).json({ 
        ok: false,
        message: 'Error al generar la previsualización del certificado.',
        detail: error.message
      });
    }
  }
}

module.exports = new LineaController();
