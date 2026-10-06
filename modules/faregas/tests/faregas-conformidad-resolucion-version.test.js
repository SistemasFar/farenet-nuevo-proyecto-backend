const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const certificados = require('../services/faregas-certificados.service');
const { faregasFormatosService } = require('../services/faregas-formatos.service');
const authService = require('../services/faregas-auth.service');

const borradorBase = () => ({
  id: 501,
  estado: 'EMITIDO',
  numeroCertificado: 'DG-41-12345',
  fechaEmision: '2026-10-06',
  tipo: { clave: 'CONFORMIDAD', nombre: 'Certificado Conformidad' },
  servicio: { tipoFlujo: 'CERTIFICADO', modalidad: 'UNICA' },
  cliente: { nombreRazonSocial: 'CLIENTE PRUEBA' },
  vehiculo: { placa: 'ABC123' },
  titulares: [],
  formatoFormulario: { motor: 'HTML_DINAMICO' },
  formatoVersionId: 113
});

test('Conformidad histórica emitida sin formato_version_id conserva el renderer legacy', async () => {
  const originales = {
    obtenerBorradorCompleto: certificados.obtenerBorradorCompleto,
    obtenerConformidad: certificados.obtenerConformidad,
    renderVersion: faregasFormatosService.renderVersion
  };
  let rendersDinamicos = 0;
  try {
    certificados.obtenerBorradorCompleto = async () => ({
      ...borradorBase(),
      formatoVersionAsignadaId: null
    });
    certificados.obtenerConformidad = async () => ({
      conformidad: { tipo_conformidad: 'MODIFICACION', marca_modificacion: true }
    });
    faregasFormatosService.renderVersion = async () => {
      rendersDinamicos += 1;
      return { data: '<p>DINAMICO</p>' };
    };

    const resultado = await certificados.obtenerPrevisualizacion(501, { username: 'test', perfil_id: 1 });
    assert.equal(rendersDinamicos, 0);
    assert.match(resultado.html, /CERTIFICADO DE CONFORMIDAD/);
    assert.doesNotMatch(resultado.html, /DINAMICO/);
  } finally {
    certificados.obtenerBorradorCompleto = originales.obtenerBorradorCompleto;
    certificados.obtenerConformidad = originales.obtenerConformidad;
    faregasFormatosService.renderVersion = originales.renderVersion;
  }
});

test('Conformidad emitida con formato_version_id reimprime exactamente esa versión', async () => {
  const originales = {
    obtenerBorradorCompleto: certificados.obtenerBorradorCompleto,
    obtenerConformidad: certificados.obtenerConformidad,
    renderVersion: faregasFormatosService.renderVersion
  };
  let versionRenderizada = null;
  try {
    certificados.obtenerBorradorCompleto = async () => ({
      ...borradorBase(),
      formatoVersionAsignadaId: 113,
      formatoVersionId: 113
    });
    certificados.obtenerConformidad = async () => ({ conformidad: { tipo_conformidad: 'MONTAJE' } });
    faregasFormatosService.renderVersion = async (versionId, data) => {
      versionRenderizada = versionId;
      assert.equal(data.conformidad.clase_montaje, 'active');
      assert.equal(data.vehiculo.placa, 'ABC123');
      return { data: '<p>VERSION 113</p>' };
    };

    const resultado = await certificados.obtenerPrevisualizacion(501, { username: 'test', perfil_id: 1 });
    assert.equal(versionRenderizada, 113);
    assert.equal(resultado.html, '<p>VERSION 113</p>');
  } finally {
    certificados.obtenerBorradorCompleto = originales.obtenerBorradorCompleto;
    certificados.obtenerConformidad = originales.obtenerConformidad;
    faregasFormatosService.renderVersion = originales.renderVersion;
  }
});

test('cada nueva emisión fija la VIGENTE de su momento y una publicación posterior no cambia la anterior', async () => {
  const originalConnect = db.connect;
  const originalValidarEmision = certificados.validarEmision;
  const originalValidarAcceso = authService.validarAccesoCertificado;
  let versionVigente = 120;
  const versionesFijadas = [];

  db.connect = async () => ({
    async query(sql, params = []) {
      const texto = String(sql);
      if (texto === 'BEGIN' || texto === 'COMMIT' || texto === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (texto.includes('FROM fg_certificado c') && texto.includes('FOR UPDATE OF c')) {
        return {
          rowCount: 1,
          rows: [{
            id: params[0], estado: 'BORRADOR', planta_key: 13,
            numero_certificado: `DG-41-${params[0]}`,
            servicio_formato_id: 5, formato_version_id: null
          }]
        };
      }
      if (texto.includes('FROM fg_certificado_formato_version')) {
        return { rowCount: 1, rows: [{ id: versionVigente }] };
      }
      if (texto.includes('UPDATE fg_certificado')) {
        versionesFijadas.push(params[3]);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Consulta inesperada: ${texto}`);
    },
    release() {}
  });
  certificados.validarEmision = async () => ({ valido: true, errores: [] });
  authService.validarAccesoCertificado = async () => true;

  try {
    await certificados.emitirCertificado(700, { username: 'test', perfil_id: 1 });
    versionVigente = 121;
    await certificados.emitirCertificado(701, { username: 'test', perfil_id: 1 });

    assert.deepEqual(versionesFijadas, [120, 121]);
    assert.equal(versionesFijadas[0], 120);
  } finally {
    db.connect = originalConnect;
    certificados.validarEmision = originalValidarEmision;
    authService.validarAccesoCertificado = originalValidarAcceso;
  }
});
