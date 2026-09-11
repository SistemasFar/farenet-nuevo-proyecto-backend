const express = require('express');
const router = express.Router();
const multer = require('multer');
const { faregasFormatosService } = require('../services/faregas-formatos.service');
const { VARIABLES_CATALOG } = require('../services/faregas-formatos.variables');
const { authFaregasMiddleware: verificarToken } = require('../middlewares/faregas-auth.middleware');

// Setup multer memory storage
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// Get dictionary of allowed variables
router.get('/variables', verificarToken, (req, res) => {
  res.json({ variables: VARIABLES_CATALOG });
});

// List all formats
router.get('/', verificarToken, async (req, res) => {
  try {
    const formatos = await faregasFormatosService.listarFormatos();
    res.json(formatos);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener formatos', error: error.message });
  }
});

// Create new Format
router.post('/', verificarToken, async (req, res) => {
  try {
    const { nombre, codigo, motor } = req.body;
    if (!nombre || !codigo || !motor) return res.status(400).json({ mensaje: 'Faltan datos obligatorios' });
    const nuevo = await faregasFormatosService.crearFormato(nombre, codigo, motor);
    res.json(nuevo);
  } catch (error) {
    res.status(400).json({ mensaje: 'Error al crear formato', error: error.message });
  }
});

// Get versions of a specific format
router.get('/:id/versiones', verificarToken, async (req, res) => {
  try {
    const versiones = await faregasFormatosService.obtenerVersionesFormato(req.params.id);
    res.json(versiones);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener versiones', error: error.message });
  }
});

// Upload a new docx version (saved as BORRADOR)
router.post('/:id/versiones', verificarToken, upload.single('archivo'), async (req, res) => {
  try {
    const formatoId = req.params.id;
    if (!req.file) return res.status(400).json({ mensaje: 'No se subi� archivo' });
    
    if (!req.file.originalname.endsWith('.docx')) {
      return res.status(400).json({ mensaje: 'El archivo debe ser un .docx v�lido' });
    }

    const resultado = await faregasFormatosService.guardarBorradorVersion(
      formatoId, 
      req.file.buffer,
      req.file.originalname
    );

    res.json({
      mensaje: 'Versi�n guardada como borrador',
      version: resultado
    });

  } catch (error) {
    res.status(400).json({ mensaje: error.message });
  }
});

// Obtener estructura legible del documento (paragraphs)
router.get('/:id/versiones/:versionId/estructura', verificarToken, async (req, res) => {
  try {
    const paragraphs = await faregasFormatosService.obtenerEstructura(req.params.id, req.params.versionId);
    res.json({ paragraphs });
  } catch (error) {
    res.status(400).json({ mensaje: error.message });
  }
});

// Guardar mappings y reconstruir template
router.post('/:id/versiones/:versionId/mappings', verificarToken, async (req, res) => {
  try {
    const { mappings } = req.body;
    if (!Array.isArray(mappings)) return res.status(400).json({ mensaje: 'mappings debe ser un array' });
    
    await faregasFormatosService.guardarMappings(req.params.id, req.params.versionId, mappings);
    res.json({ mensaje: 'Mappings guardados y template actualizado' });
  } catch (error) {
    res.status(400).json({ mensaje: error.message });
  }
});

// Descargar preview
router.get('/:id/versiones/:versionId/preview', verificarToken, async (req, res) => {
  try {
    const buffer = await faregasFormatosService.generarPreview(req.params.id, req.params.versionId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename=preview_' + req.params.versionId + '.docx');
    res.send(buffer);
  } catch (error) {
    res.status(400).json({ mensaje: error.message });
  }
});

// Activar versi�n
router.post('/:id/versiones/:versionId/activar', verificarToken, async (req, res) => {
  try {
    await faregasFormatosService.activarVersion(req.params.id, req.params.versionId);
    res.json({ mensaje: 'Versi�n activada exitosamente' });
  } catch (error) {
    res.status(400).json({ mensaje: error.message });
  }
});

module.exports = router;

