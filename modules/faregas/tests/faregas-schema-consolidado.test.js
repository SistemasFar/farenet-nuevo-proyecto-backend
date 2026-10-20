const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
const schemaPath = path.join(migrationsDir, '0001_faregas_schema.sql');

test('migrations contiene solamente el esquema consolidado', () => {
    const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));
    assert.deepEqual(files, ['0001_faregas_schema.sql']);
});

test('el esquema consolidado crea todas las tablas funcionales sin parches de columnas', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const tables = Array.from(
        schema.matchAll(/CREATE TABLE public\.(fg_[a-z0-9_]+)/gi),
        (match) => match[1]
    );

    assert.equal(tables.length, 62);
    assert.equal(new Set(tables).size, 62);
    assert.ok(tables.includes('fg_certificado_duplicado'));
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
