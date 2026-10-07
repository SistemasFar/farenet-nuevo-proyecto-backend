const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { obtenerCatalogoVariables } = require('../services/faregas-formatos.variables');

const migrationPath = path.join(
  __dirname,
  '../database/migrations/20261007_faregas_formato_inspeccion_taller_base.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const layoutMigration = fs.readFileSync(path.join(
  __dirname,
  '../database/migrations/20261007_faregas_taller_layout_referencia.sql'
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
