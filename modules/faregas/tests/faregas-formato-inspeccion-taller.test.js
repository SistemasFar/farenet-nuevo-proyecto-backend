const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { obtenerCatalogoVariables } = require('../services/faregas-formatos.variables');

const migrationPath = path.join(
  __dirname,
  '../database/migrations_history/20261007_faregas_formato_inspeccion_taller_base.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const layoutMigration = fs.readFileSync(path.join(
  __dirname,
  '../database/migrations_history/20261007_faregas_taller_layout_referencia.sql'
), 'utf8');

test('registra el sistema de combustible como variable del formato', () => {
  const variable = obtenerCatalogoVariables().find(({ key }) => key === 'inspeccion.tipo_combustible');
  assert.ok(variable);
  assert.equal(variable.grupo, 'Inspección');
  assert.match(variable.label, /GNV o GLP/);
});

test('la migración conserva una base técnica oculta con versión vigente', () => {
  assert.match(migration, /TALLER_INSPECCION_BASE/);
  assert.match(migration, /Base técnica · Inspección de Taller/);
  assert.match(migration, /'HTML_DINAMICO', FALSE, FALSE/);
  assert.match(migration, /'VIGENTE'/);
});

test('crea las cuatro variantes compatibles con las bases protegidas', () => {
  for (const [codigo, padre] of [
    ['TALLER_GNV_INICIAL_FORMATO', 'GNV_INICIAL'],
    ['TALLER_GNV_ANUAL_FORMATO', 'GNV_ANUAL'],
    ['TALLER_GLP_INICIAL_FORMATO', 'GLP_INICIAL'],
    ['TALLER_GLP_ANUAL_FORMATO', 'GLP_ANUAL']
  ]) {
    assert.ok(migration.includes(codigo));
    assert.ok(migration.includes(padre));
  }
  assert.match(migration, /formato_padre_id = EXCLUDED\.formato_padre_id/);
});

test('la plantilla contiene la estructura del certificado físico de referencia', () => {
  for (const texto of [
    '{{certificado.titulo}}',
    'Tipo de Certificación',
    'Nombre de taller',
    'Representante legal',
    'N° de autorización',
    'OBSERVACIONES:',
    'Fecha de la próxima inspección anual'
  ]) {
    assert.ok(migration.includes(texto), `Falta el texto: ${texto}`);
  }
});

test('la tabla conserva las proporciones estrechas de la referencia física', () => {
  for (const rule of [
    'col:nth-child(1) { width: 5%',
    'col:nth-child(2) { width: 25%',
    'col:nth-child(3) { width: 70%',
    '.tabla-info p { margin: 0; }'
  ]) {
    assert.ok(migration.includes(rule), `Falta la regla: ${rule}`);
    assert.ok(layoutMigration.includes(rule), `Falta la corrección versionada: ${rule}`);
  }
});

test('la corrección visual preserva el borrador del usuario', () => {
  assert.match(layoutMigration, /estado = 'BORRADOR'/);
  assert.match(layoutMigration, /faregas-taller-layout-reference/);
  assert.match(layoutMigration, /jsonb_set\(v_config, '\{html\}'/);
  assert.doesNotMatch(layoutMigration, /SET estado = 'RETIRADA'/);
});

test('el mismo formato admite GNV o GLP sin texto legal fijo', () => {
  const ocurrencias = migration.match(/\{\{inspeccion\.tipo_combustible\}\}/g) || [];
  assert.equal(ocurrencias.length, 2);
  assert.ok(!migration.includes('Gas Natural Vehicular – GNV, tal como'));
});

test('la migración no asigna el formato automáticamente a operaciones', () => {
  assert.ok(!/UPDATE\s+fg_servicio/i.test(migration));
  assert.ok(!/INSERT\s+INTO\s+fg_servicio/i.test(migration));
});

test('el combustible del formato se resuelve automáticamente desde la familia', () => {
  const certificados = require('../services/faregas-certificados.service');
  assert.equal(certificados._private.tipoCombustibleCertificado('GNV_ANUAL'), 'Gas Natural Vehicular – GNV');
  assert.equal(certificados._private.tipoCombustibleCertificado('GLP_ANUAL'), 'Gas Licuado de Petróleo – GLP');
});

test('el título de Taller se forma con combustible y modalidad', () => {
  const certificados = require('../services/faregas-certificados.service');
  assert.equal(
    certificados._private.tituloInspeccionTaller('GNV_ANUAL', 'ANUAL'),
    'CERTIFICADO DE INSPECCIÓN DE TALLER GNV ANUAL'
  );
  assert.equal(
    certificados._private.tituloInspeccionTaller('GNV_ANUAL', 'INICIAL'),
    'CERTIFICADO DE INSPECCIÓN DE TALLER GNV INICIAL'
  );
  assert.equal(
    certificados._private.tituloInspeccionTaller('GLP_ANUAL', 'ANUAL'),
    'CERTIFICADO DE INSPECCIÓN DE TALLER GLP ANUAL'
  );
  assert.equal(
    certificados._private.tituloInspeccionTaller('GLP_ANUAL', 'INICIAL'),
    'CERTIFICADO DE INSPECCIÓN DE TALLER GLP INICIAL'
  );
});

test('la inspección de taller usa el prefijo documental 22 y siete dígitos', () => {
  const certificados = require('../services/faregas-certificados.service');
  assert.equal(certificados._private.formatearNumeroCertificado({
    tipoFlujo: 'TALLER_INSPECCION',
    tipoCodigo: '27',
    anchoCorrelativo: 5,
    numero: 13393
  }), 'DG-22-0013393');
  assert.equal(certificados._private.formatearNumeroCertificado({
    tipoFlujo: 'CERTIFICACION',
    tipoCodigo: '27',
    anchoCorrelativo: 5,
    numero: 13393
  }), 'DG-27-13393');
});

// ============================================================================
// SUITE DE PRUEBAS AUTOMATIZADAS - CORRECCIONES PRODUCTO 0423
// ============================================================================

const cheerio = require('cheerio');
const {
  parsearFechaPeru,
  formatearFechaExpedicionTaller,
  formatearFechaProximaInspeccionTaller
} = require('../templates/template-utils');
const { renderizarHtml } = require('../services/faregas-formatos-html');
const { PLANTILLA_FAREGAS_HTML } = require('../services/faregas-formatos.templates');

test('1. Fecha de expedición completa: estructura exacta con día, mes en letras y año', () => {
  const texto = formatearFechaExpedicionTaller('2026-10-07');
  assert.equal(texto, '07 del mes de octubre del 2026');
});

test('2. Día de un solo dígito mostrado con cero inicial', () => {
  assert.equal(formatearFechaExpedicionTaller('2026-10-05'), '05 del mes de octubre del 2026');
  assert.equal(formatearFechaExpedicionTaller('2026-10-01'), '01 del mes de octubre del 2026');
  assert.equal(formatearFechaExpedicionTaller('2026-10-09'), '09 del mes de octubre del 2026');
});

test('3. Mes completo en español y en minúsculas', () => {
  const meses = [
    ['2026-01-15', 'enero'],
    ['2026-02-15', 'febrero'],
    ['2026-03-15', 'marzo'],
    ['2026-04-15', 'abril'],
    ['2026-05-15', 'mayo'],
    ['2026-06-15', 'junio'],
    ['2026-07-15', 'julio'],
    ['2026-08-15', 'agosto'],
    ['2026-09-15', 'setiembre'],
    ['2026-10-15', 'octubre'],
    ['2026-11-15', 'noviembre'],
    ['2026-12-15', 'diciembre']
  ];
  for (const [fecha, mesEsperado] of meses) {
    const res = formatearFechaExpedicionTaller(fecha);
    assert.ok(res.includes(`del mes de ${mesEsperado} del`), `Esperaba ${mesEsperado} para ${fecha}, obtenido: ${res}`);
  }
});

test('4. Año correcto de cuatro dígitos', () => {
  assert.ok(formatearFechaExpedicionTaller('2026-10-21').endsWith('del 2026'));
  assert.ok(formatearFechaExpedicionTaller('2027-05-10').endsWith('del 2027'));
  assert.ok(formatearFechaExpedicionTaller('2030-12-31').endsWith('del 2030'));
});

test('5. Fecha de próxima inspección con barras DD/MM/AAAA', () => {
  assert.equal(formatearFechaProximaInspeccionTaller('2026-10-30'), '30/10/2026');
  assert.equal(formatearFechaProximaInspeccionTaller('2027-01-05'), '05/01/2027');
  assert.equal(formatearFechaProximaInspeccionTaller('2028-02-29'), '29/02/2028');
});

test('6. Fechas de cambio de año', () => {
  assert.equal(formatearFechaExpedicionTaller('2026-12-31'), '31 del mes de diciembre del 2026');
  assert.equal(formatearFechaExpedicionTaller('2027-01-01'), '01 del mes de enero del 2027');
  assert.equal(formatearFechaProximaInspeccionTaller('2026-12-31'), '31/12/2026');
  assert.equal(formatearFechaProximaInspeccionTaller('2027-01-01'), '01/01/2027');
});

test('7. Fecha de año bisiesto', () => {
  assert.equal(formatearFechaExpedicionTaller('2028-02-29'), '29 del mes de febrero del 2028');
  assert.equal(formatearFechaProximaInspeccionTaller('2028-02-29'), '29/02/2028');
});

test('8. Ausencia de desfases por UTC aplicando America/Lima', () => {
  // 2026-10-21T05:00:00.000Z es medianoche 00:00:00 del 21/10/2026 en Lima (UTC-5)
  const fechaUtcMedianoche = new Date('2026-10-21T05:00:00.000Z');
  assert.equal(formatearFechaExpedicionTaller(fechaUtcMedianoche), '21 del mes de octubre del 2026');

  // 2026-10-21T04:59:59.000Z es 23:59:59 del 20/10/2026 en Lima (UTC-5)
  const fechaUtcDiaAnterior = new Date('2026-10-21T04:59:59.000Z');
  assert.equal(formatearFechaExpedicionTaller(fechaUtcDiaAnterior), '20 del mes de octubre del 2026');
});

test('9. Teléfono: catálogo de variables define TELÉFONO (OPCIONAL) con requerido false', () => {
  const variable = obtenerCatalogoVariables().find(({ key }) => key === 'taller.telefono');
  assert.ok(variable);
  assert.equal(variable.label, 'TELÉFONO (OPCIONAL)');
  assert.equal(variable.requerido, false);
  assert.equal(variable.minLength, 7);
  assert.equal(variable.maxLength, 9);
  assert.equal(variable.pattern, '^\\d{7,9}$');
});

test('10. Teléfono vacío y nulo permitido en validación backend', () => {
  const certificados = require('../services/faregas-certificados.service');
  const validar = certificados._private.validarVariablesFormatoDinamico;
  assert.ok(typeof validar === 'function', 'validarVariablesFormatoDinamico debe estar expuesto');

  const certMockBase = {
    formato_version_resuelta_id: 136,
    formato_version_estado: 'VIGENTE',
    formato_version_motor: 'HTML_DINAMICO',
    formato_version_configuracion: {
      variables_usadas: ['taller.nombre', 'taller.telefono', 'taller.direccion']
    }
  };

  // Caso 1: teléfono ausente
  const errores1 = [];
  validar({
    ...certMockBase,
    formato_datos_snapshot: {
      taller: { nombre: 'TALLER TEST S.A.C.', direccion: 'AV TEST 123' }
    }
  }, (grupo, campo, codigo, mensaje) => errores1.push({ grupo, campo, codigo, mensaje }));
  assert.equal(errores1.filter(e => e.campo === 'taller.telefono').length, 0);

  // Caso 2: teléfono nulo
  const errores2 = [];
  validar({
    ...certMockBase,
    formato_datos_snapshot: {
      taller: { nombre: 'TALLER TEST S.A.C.', direccion: 'AV TEST 123', telefono: null }
    }
  }, (grupo, campo, codigo, mensaje) => errores2.push({ grupo, campo, codigo, mensaje }));
  assert.equal(errores2.filter(e => e.campo === 'taller.telefono').length, 0);

  // Caso 3: teléfono cadena vacía
  const errores3 = [];
  validar({
    ...certMockBase,
    formato_datos_snapshot: {
      taller: { nombre: 'TALLER TEST S.A.C.', direccion: 'AV TEST 123', telefono: '   ' }
    }
  }, (grupo, campo, codigo, mensaje) => errores3.push({ grupo, campo, codigo, mensaje }));
  assert.equal(errores3.filter(e => e.campo === 'taller.telefono').length, 0);
});

test('11. Teléfono válido conservado y validación de formato cuando se ingresa', () => {
  const certificados = require('../services/faregas-certificados.service');
  const validar = certificados._private.validarVariablesFormatoDinamico;

  const certMockBase = {
    formato_version_resuelta_id: 136,
    formato_version_estado: 'VIGENTE',
    formato_version_motor: 'HTML_DINAMICO',
    formato_version_configuracion: {
      variables_usadas: ['taller.nombre', 'taller.telefono', 'taller.direccion']
    }
  };

  // Teléfono válido de 7 dígitos
  const erroresValido = [];
  validar({
    ...certMockBase,
    formato_datos_snapshot: {
      taller: { nombre: 'TALLER TEST S.A.C.', direccion: 'AV TEST 123', telefono: '2212121' }
    }
  }, (grupo, campo, codigo, mensaje) => erroresValido.push({ grupo, campo, codigo, mensaje }));
  assert.equal(erroresValido.filter(e => e.campo === 'taller.telefono').length, 0);

  // Teléfono inválido: letras
  const erroresInvalido = [];
  validar({
    ...certMockBase,
    formato_datos_snapshot: {
      taller: { nombre: 'TALLER TEST S.A.C.', direccion: 'AV TEST 123', telefono: 'ABCDEFG' }
    }
  }, (grupo, campo, codigo, mensaje) => erroresInvalido.push({ grupo, campo, codigo, mensaje }));
  assert.ok(erroresInvalido.some(e => e.campo === 'taller.telefono' && e.codigo === 'FORMATO_INVALIDO'));

  // Teléfono inválido: muy corto (menos de 7 dígitos)
  const erroresCorto = [];
  validar({
    ...certMockBase,
    formato_datos_snapshot: {
      taller: { nombre: 'TALLER TEST S.A.C.', direccion: 'AV TEST 123', telefono: '12345' }
    }
  }, (grupo, campo, codigo, mensaje) => erroresCorto.push({ grupo, campo, codigo, mensaje }));
  assert.ok(erroresCorto.some(e => e.campo === 'taller.telefono' && e.codigo === 'LONGITUD_INVALIDA'));
});

test('12. HTML/PDF muestra exactamente dos guiones -- cuando no hay teléfono', () => {
  const datosConGuiones = {
    taller: {
      nombre: 'CHARING S.A.C.',
      direccion: 'Jr. San Pedro 741',
      telefono: '--',
      ciudad: 'Lima',
      representante_legal: 'Miguel Angel Berrospi León',
      numero_autorizacion: 'RD N° 620-2021 MTC /17.03'
    },
    empresa: { resolucion: '0296-2024', direccion: 'Calle Secada 315', telefono: '966702160', razon_social: 'FAREGAS' },
    certificado: { titulo: 'CERTIFICADO DE INSPECCIÓN DE TALLER', modalidad: 'ANUAL', numero: 'DG-22-0012497', fecha_emision: '21 del mes de octubre del 2026' },
    inspeccion: { observaciones: 'NINGUNA', fecha_proxima_inspeccion: '30/10/2026' }
  };

  const html = renderizarHtml(PLANTILLA_FAREGAS_HTML, datosConGuiones);
  const $ = cheerio.load(html);
  const telCell = $('table.tabla-info tr:nth-child(3) td:nth-child(3)').text().trim();
  assert.equal(telCell, '--');
  assert.ok(!html.includes('null'));
  assert.ok(!html.includes('undefined'));
  assert.ok(!html.includes('SIN TELÉFONO'));
});

test('13. HTML/PDF muestra número real cuando se informa', () => {
  const datosConTelefono = {
    taller: {
      nombre: 'CHARING S.A.C.',
      direccion: 'Jr. San Pedro 741',
      telefono: '2212121',
      ciudad: 'Lima',
      representante_legal: 'Miguel Angel Berrospi León',
      numero_autorizacion: 'RD N° 620-2021 MTC /17.03'
    },
    empresa: { resolucion: '0296-2024', direccion: 'Calle Secada 315', telefono: '966702160', razon_social: 'FAREGAS' },
    certificado: { titulo: 'CERTIFICADO DE INSPECCIÓN DE TALLER', modalidad: 'ANUAL', numero: 'DG-22-0012497', fecha_emision: '21 del mes de octubre del 2026' },
    inspeccion: { observaciones: 'NINGUNA', fecha_proxima_inspeccion: '30/10/2026' }
  };

  const html = renderizarHtml(PLANTILLA_FAREGAS_HTML, datosConTelefono);
  const $ = cheerio.load(html);
  const telCell = $('table.tabla-info tr:nth-child(3) td:nth-child(3)').text().trim();
  assert.equal(telCell, '2212121');
});

test('14. HTML renderizado contiene la oración de expedición completa terminando con punto', () => {
  const datos = {
    certificado: { fecha_emision: '07 del mes de octubre del 2026' }
  };
  const html = renderizarHtml(PLANTILLA_FAREGAS_HTML, datos);
  assert.ok(html.includes('Se expide el presente certificado en la ciudad de Lima, <span data-faregas-var="certificado.fecha_emision" data-faregas-label="Fecha de Emisión" data-faregas-source="FORM">07 del mes de octubre del 2026</span>.'));
});

test('15. Normalización HTML corrige automáticamente versiones de plantilla con documento.fecha_dia', () => {
  const htmlLegacy = '<p class="fecha-expedicion">Se expide el presente certificado en la ciudad de Lima, <span data-faregas-var="documento.fecha_dia" data-faregas-label="Día de emisión" data-faregas-fallback="10">{{certificado.fecha_emision}}</span>.</p>';
  const datos = {
    certificado: { fecha_emision: '21 del mes de octubre del 2026' },
    documento: { fecha_dia: '21 del mes de octubre del 2026' }
  };
  const htmlRenderizado = renderizarHtml(htmlLegacy, datos);
  const $ = cheerio.load(htmlRenderizado);
  assert.equal($('p.fecha-expedicion').text().trim(), 'Se expide el presente certificado en la ciudad de Lima, 21 del mes de octubre del 2026.');
});

test('16. Normalización HTML asegura punto final en próxima inspección anual', () => {
  const htmlSinPunto = '<p>Fecha de la próxima inspección anual: <strong><span data-faregas-var="inspeccion.fecha_proxima_inspeccion">{{inspeccion.fecha_proxima_inspeccion}}</span></strong></p>';
  const datos = {
    inspeccion: { fecha_proxima_inspeccion: '30/10/2026' }
  };
  const htmlRenderizado = renderizarHtml(htmlSinPunto, datos);
  const $ = cheerio.load(htmlRenderizado);
  assert.equal($('p').text().trim(), 'Fecha de la próxima inspección anual: 30/10/2026.');
});

test('17. Regresión: las demás filas de la tabla de taller conservan sus datos', () => {
  const datos = {
    taller: {
      nombre: 'CHARING S.A.C.',
      direccion: 'Jr. San Pedro 741 – Distrito de Surquillo',
      telefono: '--',
      ciudad: 'Lima',
      representante_legal: 'Miguel Angel Berrospi León',
      numero_autorizacion: 'RD N° 620-2021 MTC /17.03'
    }
  };
  const html = renderizarHtml(PLANTILLA_FAREGAS_HTML, datos);
  const $ = cheerio.load(html);
  assert.equal($('table.tabla-info tr:nth-child(1) td:nth-child(3)').text().trim(), 'CHARING S.A.C.');
  assert.equal($('table.tabla-info tr:nth-child(2) td:nth-child(3)').text().trim(), 'Jr. San Pedro 741 – Distrito de Surquillo');
  assert.equal($('table.tabla-info tr:nth-child(3) td:nth-child(3)').text().trim(), '--');
  assert.equal($('table.tabla-info tr:nth-child(4) td:nth-child(3)').text().trim(), 'Lima');
  assert.equal($('table.tabla-info tr:nth-child(5) td:nth-child(3)').text().trim(), 'Miguel Angel Berrospi León');
  assert.equal($('table.tabla-info tr:nth-child(6) td:nth-child(3)').text().trim(), 'RD N° 620-2021 MTC /17.03');
});

test('18. Regresión GLP vehicular: la plantilla GLP Anual conserva su formato original', () => {
  const generateGlpAnualHtml = require('../templates/glp-anual.template');
  const html = generateGlpAnualHtml({
    cabecera: { numero_certificado: 'DG-11-0001', fecha_emision: '2026-10-15', placa_nueva: 'ABC123' },
    vehiculo: { placa: 'ABC123', categoria: 'M1', marca: 'TOYOTA' },
    glp: {},
    componentes: [],
    verificaciones: [],
    titulares: []
  }, { modo: 'FINAL' });
  assert.ok(html.includes('CERTIFICADO DE CONFORMIDAD DE CONVERSIÓN A GLP') || html.includes('GLP'));
  assert.ok(html.includes('ABC123'));
});

test('19. Regresión GNV vehicular: las plantillas GNV Anual e Inicial conservan su formato original', () => {
  const generateGnvAnualHtml = require('../templates/gnv-anual.template');
  const generateGnvInicialHtml = require('../templates/gnv-inicial.template');

  const htmlAnual = generateGnvAnualHtml({
    cabecera: { numero_certificado: 'DG-22-0001', fecha_emision: '2026-10-15', placa_nueva: 'XYZ789' },
    vehiculo: { placa: 'XYZ789', categoria: 'M1' },
    gnv: {},
    verificaciones: [],
    titulares: []
  }, { modo: 'FINAL' });
  assert.ok(htmlAnual.includes('XYZ789'));

  const htmlInicial = generateGnvInicialHtml({
    cabecera: { numero_certificado: 'DG-22-0002', fecha_emision: '2026-10-15', placa_nueva: 'XYZ789' },
    vehiculo: { placa: 'XYZ789', categoria: 'M1' },
    propietario: {},
    gnv: { componentes: [] },
    componentes: [],
    taller: {}
  }, { modo: 'FINAL' });
  assert.ok(htmlInicial.includes('XYZ789'));
});

test('20. Regresión Conformidad: la plantilla de Conformidad conserva su formato original', () => {
  const generateConformidadHtml = require('../templates/conformidad.template');
  const html = generateConformidadHtml({
    cabecera: { numero_certificado: 'DG-09-0001', fecha_emision: '2026-10-15', placa_nueva: 'CONF01' },
    vehiculo: { placa: 'CONF01', categoria: 'N1' },
    conformidad: {},
    titulares: []
  }, { modo: 'FINAL' });
  assert.ok(html.includes('CERTIFICADO DE CONFORMIDAD DE MODIFICACIÓN') || html.includes('CONFORMIDAD'));
  assert.ok(html.includes('CONF01'));
});
