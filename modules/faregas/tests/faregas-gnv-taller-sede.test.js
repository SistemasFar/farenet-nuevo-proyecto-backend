const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const certificados = require('../services/faregas-certificados.service');
const tarifasService = require('../services/faregas-tarifas.service');
const generarGnvInicial = require('../templates/gnv-inicial.template');
const generarGnvAnual = require('../templates/gnv-anual.template');

const TALLERES = Object.freeze({
  '13': { id: 13, planta_key: '13', sede: 'COLINA', razon_social: 'CHARING S.A.C. SEDE COLINA' },
  '98': { id: 98, planta_key: '98', sede: 'SURCO', razon_social: 'CONVERTIGAS S.A.C. FAREGAS I SURCO' },
  '160': { id: 160, planta_key: '160', sede: 'SURQUILLO', razon_social: 'CHARING S.A.C. SEDE SURQUILLO' }
});

const ejecutarGuardado = async ({
  plantaKey,
  modalidad,
  estado = 'BORRADOR',
  combustibleOriginal = 'GASOLINA',
  combustiblePosterior = 'BI - COMBUSTIBLE GNV',
  pesoOriginal = '1301',
  pesoPosterior = '1450'
}) => {
  const originalConnect = db.connect;
  const originalAcceso = authService.validarAccesoPlanta;
  let parametrosGuardados = null;
  const consultas = [];

  db.connect = async () => ({
    async query(sql, params = []) {
      const texto = String(sql);
      consultas.push(texto.trim());
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto)) return { rowCount: 0, rows: [] };
      if (texto.includes('SELECT estado, planta_key, tipo_certificado_clave')) {
        return { rowCount: 1, rows: [{ estado, planta_key: plantaKey, tipo_certificado_clave: 'GNV_ANUAL' }] };
      }
      if (texto.includes('FROM fg_taller_autorizado ta')) {
        const taller = TALLERES[String(params[0])];
        return taller
          ? { rowCount: 1, rows: [{ ...taller, direccion: null, codigo_autorizacion: null }] }
          : { rowCount: 0, rows: [] };
      }
      if (texto.includes('SELECT modalidad FROM fg_certificado_gnv')) {
        return { rowCount: 0, rows: [] };
      }
      if (texto.includes('FROM fg_certificado_vehiculo')) {
        return {
          rowCount: 1,
          rows: [{ combustible: combustibleOriginal, peso_neto: pesoOriginal }]
        };
      }
      if (texto.includes('INSERT INTO fg_certificado_gnv')) {
        parametrosGuardados = params;
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Consulta inesperada: ${texto}`);
    },
    release() {}
  });
  authService.validarAccesoPlanta = async () => true;

  try {
    await certificados.guardarGNV(701, {
      tallerAutorizadoId: 999999,
      vigenciaHasta: '2027-10-06',
      modalidad,
      combustiblePosterior,
      pesoNetoPosterior: pesoPosterior
    }, { username: 'test', perfil_id: 1 });
    return { parametrosGuardados, consultas };
  } finally {
    db.connect = originalConnect;
    authService.validarAccesoPlanta = originalAcceso;
  }
};

for (const modalidad of ['INICIAL', 'ANUAL']) {
  for (const [plantaKey, taller] of Object.entries(TALLERES)) {
    test(`GNV ${modalidad} resuelve ${taller.sede} por planta e ignora el taller manipulado`, async () => {
      const { parametrosGuardados } = await ejecutarGuardado({ plantaKey, modalidad });
      assert.ok(parametrosGuardados);
      assert.equal(parametrosGuardados[1], taller.id);
      assert.equal(parametrosGuardados[2], plantaKey);
      assert.equal(parametrosGuardados[4], taller.razon_social);
      assert.equal(parametrosGuardados[5], taller.sede);
      assert.equal(parametrosGuardados[8], modalidad);
      assert.notEqual(parametrosGuardados[1], 999999);
    });
  }
}

test('GNV rechaza una sede sin configuración y no inventa un taller', async () => {
  await assert.rejects(
    ejecutarGuardado({ plantaKey: '201', modalidad: 'ANUAL' }),
    (error) => error.code === 'GNV_NO_HABILITADO_EN_SEDE'
  );
});

test('GNV INICIAL rechaza combustibles equivalentes aunque cambie la puntuación', async () => {
  await assert.rejects(
    ejecutarGuardado({
      plantaKey: '13',
      modalidad: 'INICIAL',
      combustibleOriginal: 'BI COMBUSTIBLE/GNV',
      combustiblePosterior: 'BI - COMBUSTIBLE GNV'
    }),
    (error) => error.code === 'GNV_COMBUSTIBLE_SIN_CAMBIO'
  );
});

test('GNV INICIAL rechaza el mismo peso neto antes y después', async () => {
  await assert.rejects(
    ejecutarGuardado({
      plantaKey: '13',
      modalidad: 'INICIAL',
      pesoOriginal: '1301.000',
      pesoPosterior: '1301'
    }),
    (error) => error.code === 'GNV_PESO_NETO_SIN_CAMBIO'
  );
});

test('GNV ANUAL conserva compatibilidad y no exige datos de conversión', async () => {
  const { parametrosGuardados } = await ejecutarGuardado({
    plantaKey: '13',
    modalidad: 'ANUAL',
    combustibleOriginal: 'BI COMBUSTIBLE/GNV',
    combustiblePosterior: 'BI - COMBUSTIBLE GNV',
    pesoOriginal: '1301',
    pesoPosterior: '1301'
  });
  assert.ok(parametrosGuardados);
});

test('un nuevo borrador GNV se rechaza desde una sede no habilitada', async () => {
  const originalQuery = db.query;
  const originalObtenerTarifa = tarifasService.obtenerTarifaOperativaPorCodigo;
  const originalValidarTarifa = tarifasService.validarTarifaCertificacion;
  tarifasService.obtenerTarifaOperativaPorCodigo = async () => ({ tipo_certificado_clave: 'GNV_ANUAL' });
  tarifasService.validarTarifaCertificacion = (tarifa) => tarifa;
  db.query = async (sql) => {
    const texto = String(sql);
    if (texto.includes('SELECT activo FROM fg_tipo_certificado')) {
      return { rowCount: 1, rows: [{ activo: true }] };
    }
    if (texto.includes('FROM fg_taller_autorizado ta')) {
      return { rowCount: 0, rows: [] };
    }
    throw new Error(`Consulta inesperada: ${texto}`);
  };

  try {
    await assert.rejects(
      certificados.crearBorrador(
        { tarifaCodigo: 'GNV-PRUEBA' },
        { username: 'test', perfil_id: 1, planta_key: '133' }
      ),
      (error) => error.code === 'GNV_NO_HABILITADO_EN_SEDE'
    );
  } finally {
    db.query = originalQuery;
    tarifasService.obtenerTarifaOperativaPorCodigo = originalObtenerTarifa;
    tarifasService.validarTarifaCertificacion = originalValidarTarifa;
  }
});

test('un certificado GNV emitido no se normaliza ni se actualiza', async () => {
  await assert.rejects(
    ejecutarGuardado({ plantaKey: '13', modalidad: 'ANUAL', estado: 'EMITIDO' }),
    /CERTIFICADO_NO_EDITABLE/
  );
});

for (const taller of Object.values(TALLERES)) {
  test(`las plantillas GNV muestran la entidad oficial de ${taller.sede}`, () => {
    const gnv = {
      taller_planta_key: taller.planta_key,
      taller_razon_social: taller.razon_social,
      vigencia_hasta: '2027-10-06'
    };
    const cabecera = { numero_certificado: 'DG-TEST', fecha_emision: '2026-10-06' };
    const htmlInicial = generarGnvInicial({ cabecera, gnv, vehiculo: {}, componentes: [] });
    const htmlAnual = generarGnvAnual({ cabecera, gnv, vehiculo: {}, verificaciones: [], titulares: [] });
    assert.match(htmlInicial, new RegExp(taller.razon_social.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(htmlAnual, new RegExp(taller.razon_social.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

test('la plantilla legacy conserva el texto histórico cuando no existe taller_planta_key', () => {
  const cabecera = { numero_certificado: 'DG-HISTORICO', fecha_emision: '2026-01-01' };
  const htmlInicial = generarGnvInicial({ cabecera, gnv: { taller_razon_social: 'NO CAMBIAR' }, vehiculo: {}, componentes: [] });
  const htmlAnual = generarGnvAnual({ cabecera, gnv: { taller_razon_social: 'NO CAMBIAR' }, vehiculo: {}, verificaciones: [], titulares: [] });
  assert.match(htmlInicial, /CONVERTIGAS S\.A\.C FAREGAS I/);
  assert.match(htmlAnual, /CHARING S\.A\.C\. SEDE SURQUILLO/);
  assert.doesNotMatch(htmlInicial, /NO CAMBIAR/);
  assert.doesNotMatch(htmlAnual, /NO CAMBIAR/);
});
