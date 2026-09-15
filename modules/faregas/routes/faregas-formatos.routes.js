const express = require('express');
const multer = require('multer');
const db = require('../../../config/database');
const { faregasFormatosService } = require('../services/faregas-formatos.service');
const { VARIABLES_CATALOG } = require('../services/faregas-formatos.variables');
const { authFaregasMiddleware: verificarToken } = require('../middlewares/faregas-auth.middleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const requireAdministrarFormatos = async (req, res, next) => {
  try {
    const permiso = await db.query(
      `SELECT 1
       FROM fg_perfil_permiso
       WHERE perfil_clave = $1
         AND permiso_clave IN ('MENU_CONFIGURACION', 'CONFIGURACION_SERVICIOS')
       GROUP BY perfil_clave
       HAVING COUNT(DISTINCT permiso_clave) = 2`,
      [req.user.perfil_id]
    );
    if (permiso.rowCount === 0) {
      return res.status(403).json({ message: 'No tiene permisos para administrar formatos.' });
    }
    next();
  } catch (_error) {
    res.status(500).json({ message: 'Error al verificar permisos de formatos.' });
  }
};

router.get('/variables', verificarToken, (_req, res) => {
  res.json({ variables: VARIABLES_CATALOG });
});

router.get('/', verificarToken, async (_req, res) => {
  try {
    res.json(await faregasFormatosService.listarFormatos());
  } catch (error) {
    res.status(500).json({ message: error.message || 'Error al obtener formatos.' });
  }
});

router.post('/', verificarToken, requireAdministrarFormatos, async (req, res) => {
  try {
    const { nombre, codigo, motor, formato_padre_id = null } = req.body;
    if (!nombre || !codigo || !motor) return res.status(400).json({ message: 'Faltan datos obligatorios.' });
    res.json(await faregasFormatosService.crearFormato(nombre, codigo, motor, formato_padre_id));
  } catch (error) {
    res.status(400).json({ message: error.message || 'Error al crear formato.' });
  }
});
router.get('/:id/operaciones', verificarToken, async (req, res) => {
  try {
    res.json(await faregasFormatosService.obtenerOperacionesPorFormato(req.params.id));
  } catch (error) {
    res.status(500).json({ message: error.message || 'Error al obtener operaciones vinculadas.' });
  }
});

router.get('/:id/versiones', verificarToken, async (req, res) => {
  try {
    res.json(await faregasFormatosService.obtenerVersionesFormato(req.params.id));
  } catch (error) {
    res.status(500).json({ message: error.message || 'Error al obtener versiones.' });
  }
});

router.post('/:id/versiones', verificarToken, requireAdministrarFormatos, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No se subió archivo.' });
    if (!req.file.originalname.toLowerCase().endsWith('.docx')) {
      return res.status(400).json({ message: 'El archivo debe ser un .docx válido.' });
    }
    const version = await faregasFormatosService.guardarBorradorVersion(
      req.params.id,
      req.file.buffer,
      req.file.originalname
    );
    res.json({ message: 'Versión guardada como borrador.', version });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/versiones/html', verificarToken, requireAdministrarFormatos, async (req, res) => {
  try {
    const version = await faregasFormatosService.crearBorradorHtml(req.params.id, req.body?.origen);
    res.json({ message: 'Versión HTML guardada como borrador.', version });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/versiones/html/importar-docx', verificarToken, requireAdministrarFormatos, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No se subió archivo.' });
    if (!req.file.originalname.toLowerCase().endsWith('.docx')) {
      return res.status(400).json({ message: 'El archivo debe ser un Word .docx válido.' });
    }
    const resultado = await faregasFormatosService.crearBorradorHtmlDesdeWord(
      req.params.id,
      req.file.buffer,
      req.file.originalname
    );
    res.json({ message: 'Word convertido a borrador HTML.', ...resultado });
  } catch (error) {
    res.status(400).json({ message: error.message || 'No se pudo convertir el documento Word.' });
  }
});

router.get('/:id/versiones/:versionId/estructura', verificarToken, async (req, res) => {
  try {
    const paragraphs = await faregasFormatosService.obtenerEstructura(req.params.id, req.params.versionId);
    res.json({ paragraphs });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/versiones/:versionId/mappings', verificarToken, requireAdministrarFormatos, async (req, res) => {
  try {
    const { mappings } = req.body;
    if (!Array.isArray(mappings)) return res.status(400).json({ message: 'mappings debe ser un array.' });
    await faregasFormatosService.guardarMappings(req.params.id, req.params.versionId, mappings);
    res.json({ message: 'Mappings guardados y plantilla actualizada.' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put('/:id/versiones/:versionId', verificarToken, requireAdministrarFormatos, async (req, res) => {
  try {
    await faregasFormatosService.guardarConfiguracion(req.params.id, req.params.versionId, req.body.configuracion);
    res.json({ message: 'Configuración guardada.' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/:id/versiones/:versionId/preview', verificarToken, async (req, res) => {
  try {
    const preview = await faregasFormatosService.generarPreview(req.params.id, req.params.versionId);
    if (preview.tipo === 'HTML_DINAMICO') {
      return res.json({ tipo: preview.tipo, html: preview.data });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=preview_${req.params.versionId}.docx`);
    res.send(preview.data);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put('/:id/versiones/:versionId/activar', verificarToken, requireAdministrarFormatos, async (req, res) => {
  try {
    await faregasFormatosService.activarVersion(req.params.id, req.params.versionId);
    res.json({ message: 'Versión activada exitosamente.' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put('/:id/versiones/:versionId/desactivar', verificarToken, requireAdministrarFormatos, async (req, res) => {
  try {
    await faregasFormatosService.desactivarVersion(req.params.id, req.params.versionId);
    res.json({ message: 'Versión desactivada exitosamente.' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put('/:id/estado', verificarToken, requireAdministrarFormatos, async (req, res) => {
  try {
    res.json(await faregasFormatosService.cambiarEstado(req.params.id));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id/versiones/:versionId', verificarToken, requireAdministrarFormatos, async (req, res) => {
  try {
    await faregasFormatosService.eliminarVersion(req.params.id, req.params.versionId);
    res.json({ message: 'Versión eliminada.' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
