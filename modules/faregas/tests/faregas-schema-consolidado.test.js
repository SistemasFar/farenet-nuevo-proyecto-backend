const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const databaseDir = path.join(__dirname, '..', 'database');
const schemaPath = path.join(databaseDir, 'faregas_instalacion_completa.sql');

test('database separa el instalador activo de los SQL archivados', () => {
    assert.equal(fs.existsSync(path.join(databaseDir, 'migrations')), false);
    assert.equal(fs.existsSync(path.join(databaseDir, 'migrations_history')), false);
    assert.equal(fs.existsSync(schemaPath), true);
    assert.equal(fs.existsSync(path.join(databaseDir, 'faregas_roles_postgresql.template.sql')), true);

    const contarSql = (carpeta) => fs.readdirSync(carpeta).filter((file) => file.endsWith('.sql')).length;
    assert.equal(contarSql(path.join(databaseDir, 'archive', 'updates_existing')), 6);
    assert.equal(contarSql(path.join(databaseDir, 'archive', 'migrations_history')), 97);
    assert.equal(contarSql(path.join(databaseDir, 'archive', 'legacy_master')), 1);
});

test('el esquema consolidado crea todas las tablas funcionales sin parches de columnas', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const tables = Array.from(
        schema.matchAll(/CREATE TABLE public\.(fg_[a-z0-9_]+)/gi),
        (match) => match[1]
    );

    assert.equal(tables.length, 69);
    assert.equal(new Set(tables).size, 69);
    assert.ok(tables.includes('fg_certificado_duplicado'));
    assert.ok(tables.includes('fg_usuario_perfil'));
    assert.ok(tables.includes('fg_notificacion'));
    assert.ok(tables.includes('fg_notificacion_destinatario'));
    assert.doesNotMatch(schema, /\bADD\s+COLUMN\b/i);
    assert.doesNotMatch(schema, /fg_descuentodetalle_backup_20260826_reglas_compartidas/i);
});

test('el esquema conserva restricciones, función y trigger operativos', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');

    assert.match(schema, /CREATE OR REPLACE FUNCTION public\.fg_bloquear_mutacion_movimiento_inventario_cantidad/);
    assert.match(schema, /CREATE TRIGGER fg_inventario_cantidad_movimiento_inmutable/);
    assert.match(schema, /FOREIGN KEY \(moneda_key\) REFERENCES public\.moneda/);
    assert.match(schema, /CREATE TABLE public\.fg_facturacion_cuota/);
    assert.match(schema, /tipo_documento_cliente character varying/);
    assert.match(schema, /modalidad_tarjeta character varying/);
    assert.match(schema, /fecha_inicio_credito date/);
});
