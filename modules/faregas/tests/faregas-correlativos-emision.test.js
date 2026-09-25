const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const service = require('../services/faregas-certificados.service');
const controller = require('../controllers/faregas-certificados.controller');
const auditoriaService = require('../services/faregas-auditoria.service');
const { faregasFormatosService: formatosService } = require('../services/faregas-formatos.service');

const usuario = {
  username: 'OPERADOR_PRUEBA',
  perfil_id: 'SISTEMAS',
  planta_key: '201'
};

const normalizar = (sql) => String(sql).replace(/\s+/g, ' ').trim();

const clonar = (valor) => {
  if (Array.isArray(valor)) return valor.map(clonar);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([key, item]) => [key, clonar(item)]));
  }
  return valor;
};

class RangeStore {
  constructor({ nroActual = 23, nroMaximo = 1000099 } = {}) {
    this.rango = {
      id: 81,
      planta_key: '201',
      tipo_certificado_clave: 'CONFORMIDAD',
      modalidad: 'UNICA',
      nro_actual: nroActual,
      nro_maximo: nroMaximo,
      activo: true
    };
    this.certificados = new Map();
    this.queries = [];
    this.failCertUpdate = false;
    this.lockTail = Promise.resolve();
  }

  agregarCertificado(id, overrides = {}) {
    this.certificados.set(Number(id), {
      id: Number(id),
      estado: 'BORRADOR',
      planta_key: '201',
      tipo_clave: 'CONFORMIDAD',
      tipo_codigo: '39',
      ancho_correlativo: 7,
      modalidad_correlativo: 'UNICA',
      numero_certificado: null,
      ...overrides
    });
  }

  async adquirirLock() {
    let liberar;
    const siguiente = new Promise((resolve) => { liberar = resolve; });
    const anterior = this.lockTail;
    this.lockTail = anterior.then(() => siguiente);
    await anterior;
    return liberar;
  }

  crearCliente() {
    const store = this;
    let snapshot = null;
    let liberarLock = null;

    const liberar = () => {
      if (liberarLock) {
        const fn = liberarLock;
        liberarLock = null;
        fn();
      }
    };

    return {
      async query(sqlCrudo, params = []) {
        const sql = normalizar(sqlCrudo);
        store.queries.push({ sql, params: [...params] });

        if (sql === 'BEGIN') {
          snapshot = {
            rango: clonar(store.rango),
            certificados: new Map([...store.certificados.entries()].map(([id, cert]) => [id, clonar(cert)]))
          };
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'COMMIT') {
          snapshot = null;
          liberar();
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'ROLLBACK') {
          if (snapshot) {
            store.rango = snapshot.rango;
            store.certificados = snapshot.certificados;
          }
          snapshot = null;
          liberar();
          return { rowCount: 0, rows: [] };
        }

        if (/SELECT c\.\*, t\.clave as tipo_clave/i.test(sql)) {
          const certificado = store.certificados.get(Number(params[0]));
          return {
            rowCount: certificado ? 1 : 0,
            rows: certificado ? [clonar(certificado)] : []
          };
        }

        if (/SELECT \* FROM fg_correlativo_certificado/i.test(sql) && /FOR UPDATE/i.test(sql)) {
          if (!liberarLock) liberarLock = await store.adquirirLock();
          return { rowCount: 1, rows: [clonar(store.rango)] };
        }

        if (/UPDATE fg_correlativo_certificado/i.test(sql)) {
          store.rango.nro_actual = Number(params[0]);
          return { rowCount: 1, rows: [] };
        }

        if (/UPDATE fg_certificado/i.test(sql)) {
          if (store.failCertUpdate) throw new Error('FALLO_SIMULADO_ACTUALIZACION_CERTIFICADO');
          const certificado = store.certificados.get(Number(params[2]));
          if (!certificado) return { rowCount: 0, rows: [] };
          certificado.numero_certificado = params[0];
          certificado.estado = 'EMITIDO';
          return { rowCount: 1, rows: [] };
        }

        throw new Error(`Consulta no simulada: ${sql}`);
      },
      release() {}
    };
  }
}

const withServiceMocks = async (store, accion) => {
  const originales = {
    connect: db.connect,
    validarAccesoPlanta: authService.validarAccesoPlanta,
    getPlantasPorUsuario: authService.getPlantasPorUsuario,
    validarEmision: service.validarEmision
  };

  db.connect = async () => store.crearCliente();
  authService.validarAccesoPlanta = async () => true;
  authService.getPlantasPorUsuario = async () => [{ key: '201' }];
  service.validarEmision = async () => ({ valido: true, errores: [] });

  try {
    return await accion();
  } finally {
    db.connect = originales.connect;
    authService.validarAccesoPlanta = originales.validarAccesoPlanta;
    authService.getPlantasPorUsuario = originales.getPlantasPorUsuario;
    service.validarEmision = originales.validarEmision;
  }
};

const crearBorradorParaPreview = (numeroCertificado = null) => ({
  id: 50,
  estado: 'BORRADOR',
  numeroCertificado: numeroCertificado,
  tipo: { clave: 'CONFORMIDAD', codigo: '39', nombre: 'Certificado de Conformidad' },
  vehiculo: {},
  cliente: null,
  titulares: [],
  chipSeleccion: null,
  fechaEmision: null,
  observaciones: null,
  entidadCertificadoraNombre: null,
  resolucionDirectoral: null,
  domicilioFiscal: null,
  telefonoCertificadora: null,
  lugarEmision: null,
  formatoDatosSnapshot: {},
  formatoVersionId: null,
  servicio: null
});

test('correlativos de certificados: asignación al emitir', async (t) => {
  await t.test('crear borrador deja numero_certificado NULL', () => {
    const fuente = fs.readFileSync(require.resolve('../services/faregas-certificados.service'), 'utf8');
    assert.match(
      fuente,
      /INSERT INTO fg_certificado\s*\([\s\S]*?numero_certificado, fecha_emision, estado, paso_actual[\s\S]*?VALUES\s*\([\s\S]*?NULL, NULL, 'BORRADOR'/i
    );
  });

  await t.test('previsualización no conecta ni consume correlativo y muestra placeholder', async () => {
    const originales = {
      connect: db.connect,
      obtenerBorradorCompleto: service.obtenerBorradorCompleto,
      obtenerConformidad: service.obtenerConformidad
    };
    let conexiones = 0;
    const borradores = new Map([
      [50, crearBorradorParaPreview()],
      [51, crearBorradorParaPreview()]
    ]);

    db.connect = async () => {
      conexiones += 1;
      throw new Error('La previsualización no debe abrir una transacción.');
    };
    service.obtenerBorradorCompleto = async (id) => ({ ...borradores.get(Number(id)) });
    service.obtenerConformidad = async () => ({ conformidad: {} });

    try {
      const primera = await service.obtenerPrevisualizacion(50, usuario);
      const segunda = await service.obtenerPrevisualizacion(51, usuario);
      const repetida = await service.obtenerPrevisualizacion(50, usuario);
      assert.match(primera.html, /PENDIENTE DE EMISIÓN/);
      assert.match(segunda.html, /PENDIENTE DE EMISIÓN/);
      assert.match(repetida.html, /PENDIENTE DE EMISIÓN/);
      assert.equal(conexiones, 0);
      assert.equal(borradores.get(50).numeroCertificado, null);
      assert.equal(borradores.get(51).numeroCertificado, null);
      const fuente = fs.readFileSync(require.resolve('../services/faregas-certificados.service'), 'utf8');
      const inicio = fuente.indexOf('exports.obtenerPrevisualizacion = async');
      const fin = fuente.indexOf('const buildFormatoData', inicio);
      const bloquePreview = fuente.slice(inicio, fin);
      assert.doesNotMatch(bloquePreview, /reservarNumeroPrevisualizacion|fg_correlativo_certificado|nro_actual/i);
    } finally {
      db.connect = originales.connect;
      service.obtenerBorradorCompleto = originales.obtenerBorradorCompleto;
      service.obtenerConformidad = originales.obtenerConformidad;
    }
  });

  await t.test('los cinco templates muestran el placeholder no vinculante', () => {
    const generadores = [
      require('../templates/gnv-inicial.template'),
      require('../templates/gnv-anual.template'),
      require('../templates/glp-inicial.template'),
      require('../templates/glp-anual.template'),
      require('../templates/conformidad.template')
    ];
    const data = {
      cabecera: {},
      vehiculo: {},
      gnv: {},
      glp: {},
      conformidad: {},
      componentes: [],
      verificaciones: [],
      titulares: []
    };
    for (const generar of generadores) {
      assert.match(generar(data, { modo: 'PREVIEW' }), /PENDIENTE DE EMISIÓN/);
    }
  });

  await t.test('formatos dinámicos no heredan un número provisional del snapshot', async () => {
    const originales = {
      connect: db.connect,
      obtenerBorradorCompleto: service.obtenerBorradorCompleto,
      renderVersion: formatosService.renderVersion
    };
    const borrador = crearBorradorParaPreview();
    borrador.servicio = { tipoFlujo: 'TALLER_INSPECCION' };
    borrador.formatoVersionId = 7;
    borrador.formatoDatosSnapshot = { certificado: { numero: 'NUMERO_PROVISIONAL_SNAPSHOT' } };
    let dataRecibida = null;
    db.connect = async () => { throw new Error('La previsualización no debe abrir una transacción.'); };
    service.obtenerBorradorCompleto = async () => ({ ...borrador });
    formatosService.renderVersion = async (_id, data) => {
      dataRecibida = data;
      return { data: '<html>preview</html>' };
    };
    try {
      await service.obtenerPrevisualizacion(50, usuario);
      assert.equal(dataRecibida.certificado.numero, 'PENDIENTE DE EMISIÓN');
    } finally {
      db.connect = originales.connect;
      service.obtenerBorradorCompleto = originales.obtenerBorradorCompleto;
      formatosService.renderVersion = originales.renderVersion;
    }
  });

  await t.test('emitir asigna el siguiente correlativo dentro de la transacción', async () => {
    const store = new RangeStore({ nroActual: 1000023 });
    store.agregarCertificado(50);
    await withServiceMocks(store, async () => {
      const resultado = await service.emitirCertificado(50, usuario);
      assert.equal(resultado.numero_certificado, 'DG-39-1000024');
      assert.equal(resultado.numeroAsignado, true);
      assert.equal(store.rango.nro_actual, 1000024);
      assert.equal(store.certificados.get(50).numero_certificado, 'DG-39-1000024');
      assert.ok(store.queries.some(({ sql }) => /SELECT c\.\*, t\.clave as tipo_clave/i.test(sql) && /FOR UPDATE OF c/i.test(sql)));
      assert.ok(store.queries.some(({ sql }) => /SELECT \* FROM fg_correlativo_certificado/i.test(sql) && /FOR UPDATE/i.test(sql)));
      assert.ok(store.queries.some(({ sql }) => /UPDATE fg_correlativo_certificado/i.test(sql)));
      assert.ok(store.queries.some(({ sql }) => /estado = 'EMITIDO'/i.test(sql)));
    });
  });

  await t.test('B emitido antes que A recibe el número menor aunque A sea más antiguo', async () => {
    const store = new RangeStore({ nroActual: 1000023 });
    store.agregarCertificado(1, { fecha_creacion: '2026-01-01T10:00:00Z' });
    store.agregarCertificado(2, { fecha_creacion: '2026-01-01T10:05:00Z' });
    await withServiceMocks(store, async () => {
      const b = await service.emitirCertificado(2, usuario);
      const a = await service.emitirCertificado(1, usuario);
      assert.equal(b.numero_certificado, 'DG-39-1000024');
      assert.equal(a.numero_certificado, 'DG-39-1000025');
      assert.equal(store.rango.nro_actual, 1000025);
    });
  });

  await t.test('dos emisiones concurrentes no obtienen el mismo número', async () => {
    const store = new RangeStore({ nroActual: 1000023 });
    store.agregarCertificado(1);
    store.agregarCertificado(2);
    await withServiceMocks(store, async () => {
      const resultados = await Promise.all([
        service.emitirCertificado(1, usuario),
        service.emitirCertificado(2, usuario)
      ]);
      const numeros = resultados.map((item) => item.numero_certificado).sort();
      assert.deepEqual(numeros, ['DG-39-1000024', 'DG-39-1000025']);
      assert.equal(store.rango.nro_actual, 1000025);
    });
  });

  await t.test('rollback de una emission no avanza el rango', async () => {
    const store = new RangeStore({ nroActual: 1000023 });
    store.agregarCertificado(50);
    store.failCertUpdate = true;
    await withServiceMocks(store, async () => {
      await assert.rejects(service.emitirCertificado(50, usuario), /FALLO_SIMULADO_ACTUALIZACION_CERTIFICADO/);
      assert.equal(store.rango.nro_actual, 1000023);
      assert.equal(store.certificados.get(50).numero_certificado, null);
      store.failCertUpdate = false;
      const siguiente = await service.emitirCertificado(50, usuario);
      assert.equal(siguiente.numero_certificado, 'DG-39-1000024');
      assert.equal(store.rango.nro_actual, 1000024);
    });
  });

  await t.test('rango agotado devuelve RANGO_AGOTADO y hace rollback', async () => {
    const store = new RangeStore({ nroActual: 1000023, nroMaximo: 1000023 });
    store.agregarCertificado(50);
    await withServiceMocks(store, async () => {
      await assert.rejects(service.emitirCertificado(50, usuario), /RANGO_AGOTADO/);
      assert.equal(store.rango.nro_actual, 1000023);
      assert.equal(store.certificados.get(50).numero_certificado, null);
      assert.ok(store.queries.some(({ sql }) => sql === 'ROLLBACK'));
    });
  });

  await t.test('certificado legacy con numero existente conserva numero y no consume otro', async () => {
    const store = new RangeStore({ nroActual: 1000023 });
    store.agregarCertificado(50, { numero_certificado: 'DG-39-1000020' });
    await withServiceMocks(store, async () => {
      const resultado = await service.emitirCertificado(50, usuario);
      assert.equal(resultado.numero_certificado, 'DG-39-1000020');
      assert.equal(resultado.numeroAsignado, false);
      assert.equal(store.rango.nro_actual, 1000023);
      assert.equal(store.queries.some(({ sql }) => /fg_correlativo_certificado/i.test(sql)), false);
    });
  });

  await t.test('anular borrador nuevo sin numero no toca correlativo', async () => {
    const originales = {
      connect: db.connect,
      validarAccesoPlanta: authService.validarAccesoPlanta
    };
    const consultas = [];
    let estado = 'BORRADOR';
    const client = {
      async query(sql, params = []) {
        const texto = normalizar(sql);
        consultas.push({ texto, params });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto)) return { rowCount: 0, rows: [] };
        if (/SELECT estado, planta_key, paso_actual, numero_certificado FROM fg_certificado/i.test(texto)) {
          return { rowCount: 1, rows: [{ estado, planta_key: '201', paso_actual: 'PREVISUALIZACION', numero_certificado: null }] };
        }
        if (/SELECT 1 FROM fg_facturacion/i.test(texto)) return { rowCount: 0, rows: [] };
        if (/UPDATE fg_certificado SET estado = 'ANULADO'/i.test(texto)) {
          estado = 'ANULADO';
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Consulta no simulada: ${texto}`);
      },
      release() {}
    };
    db.connect = async () => client;
    authService.validarAccesoPlanta = async () => true;
    try {
      const resultado = await service.anularBorrador(50, usuario);
      assert.equal(resultado.estado, 'ANULADO');
      assert.equal(resultado.numeroCertificado, null);
      assert.equal(consultas.some(({ texto }) => /fg_correlativo_certificado/i.test(texto)), false);
    } finally {
      db.connect = originales.connect;
      authService.validarAccesoPlanta = originales.validarAccesoPlanta;
    }
  });

  await t.test('un certificado emitido no se libera por anulación de borrador', async () => {
    const originales = {
      connect: db.connect,
      validarAccesoPlanta: authService.validarAccesoPlanta
    };
    db.connect = async () => ({
      async query(sql) {
        const texto = normalizar(sql);
        if (['BEGIN', 'ROLLBACK'].includes(texto)) return { rowCount: 0, rows: [] };
        if (/SELECT estado, planta_key, paso_actual, numero_certificado FROM fg_certificado/i.test(texto)) {
          return { rowCount: 1, rows: [{ estado: 'EMITIDO', planta_key: '201', paso_actual: 'VERIFICACION_EMISION', numero_certificado: 'DG-39-1000020' }] };
        }
        throw new Error(`No se debía consultar: ${texto}`);
      },
      release() {}
    });
    authService.validarAccesoPlanta = async () => true;
    try {
      await assert.rejects(service.anularBorrador(50, usuario), /CERTIFICADO_NO_EDITABLE/);
    } finally {
      db.connect = originales.connect;
      authService.validarAccesoPlanta = originales.validarAccesoPlanta;
    }
  });

  await t.test('el controller audita CERTIFICADO_NUMERO_ASIGNADO solo para asignaciones nuevas', async () => {
    const originales = {
      emitir: service.emitirCertificado,
      registrarEvento: auditoriaService.registrarEventoCertificado
    };
    const eventos = [];
    service.emitirCertificado = async () => ({ numero_certificado: 'DG-39-1000024', numeroAsignado: true });
    auditoriaService.registrarEventoCertificado = async (evento) => { eventos.push(evento); };
    const req = { params: { id: '50' }, user: usuario, headers: {}, ip: '127.0.0.1' };
    const res = { json() {} };
    try {
      await controller.emitir(req, res);
      assert.deepEqual(eventos.map((evento) => evento.evento), [
        'CERTIFICADO_NUMERO_ASIGNADO',
        'CERTIFICADO_EMITIDO'
      ]);
      assert.equal(eventos[0].datos.numeroCertificado, 'DG-39-1000024');

      service.emitirCertificado = async () => ({ numero_certificado: 'DG-39-1000020', numeroAsignado: false });
      await controller.emitir(req, res);
      assert.equal(eventos.filter((evento) => evento.evento === 'CERTIFICADO_NUMERO_ASIGNADO').length, 1);
    } finally {
      service.emitirCertificado = originales.emitir;
      auditoriaService.registrarEventoCertificado = originales.registrarEvento;
    }
  });

  // -------------------------------------------------------------------------
  // Regresión: nro_actual y nro_maximo son bigint y node-postgres los devuelve
  // como string. Compararlos sin convertir hace que "11" >= "100" sea true y
  // declare agotado un rango con 89 números libres (caso real: INDEPENDENCIA /
  // GNV ANUAL, rango id 76). Estos casos fijan que la comparación sea numérica.
  // -------------------------------------------------------------------------
  const montarRangoComoTexto = (nroActual, nroMaximo) => {
    const store = new RangeStore();
    store.rango.tipo_certificado_clave = 'GNV_ANUAL';
    store.rango.modalidad = 'ANUAL';
    store.rango.nro_inicio = '1';
    store.rango.nro_actual = String(nroActual);
    store.rango.nro_maximo = String(nroMaximo);
    store.agregarCertificado(50, {
      tipo_clave: 'GNV_ANUAL',
      tipo_codigo: '22',
      ancho_correlativo: 7,
      modalidad_correlativo: 'ANUAL'
    });
    return store;
  };

  await t.test('nro_actual con menos dígitos que nro_maximo no se declara agotado', async () => {
    // "11" >= "100" es true como texto, pero 11 >= 100 es false: debe emitir.
    assert.equal('11' >= '100', true, 'el caso que reproducía el bug');
    const store = montarRangoComoTexto(11, 100);
    await withServiceMocks(store, async () => {
      const resultado = await service.emitirCertificado(50, usuario);
      assert.equal(resultado.numero_certificado, 'DG-22-0000012');
      assert.equal(resultado.numeroAsignado, true);
      assert.equal(store.rango.nro_actual, 12);
      assert.equal(store.certificados.get(50).estado, 'EMITIDO');
    });
  });

  await t.test('rango realmente agotado con valores de texto sí lanza RANGO_AGOTADO', async () => {
    const store = montarRangoComoTexto(100, 100);
    await withServiceMocks(store, async () => {
      await assert.rejects(service.emitirCertificado(50, usuario), /RANGO_AGOTADO/);
      assert.equal(store.rango.nro_actual, '100');
      assert.equal(store.certificados.get(50).numero_certificado, null);
      assert.ok(store.queries.some(({ sql }) => sql === 'ROLLBACK'));
    });
  });

  await t.test('nro_actual de cinco dígitos contra máximo de seis no se declara agotado', async () => {
    // "99999" >= "100099" es true como texto, pero 99999 >= 100099 es false.
    assert.equal('99999' >= '100099', true, 'el caso que reproducía el bug');
    const store = montarRangoComoTexto(99999, 100099);
    await withServiceMocks(store, async () => {
      const resultado = await service.emitirCertificado(50, usuario);
      assert.equal(resultado.numero_certificado, 'DG-22-0100000');
      assert.equal(store.rango.nro_actual, 100000);
    });
  });
});

test.after(() => db.end());
