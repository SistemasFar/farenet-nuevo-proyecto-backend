const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sqlPath = path.join(
    __dirname,
    '..',
    'database',
    'faregas_instalacion_completa.sql'
);
const sql = fs.readFileSync(sqlPath, 'utf8');
const sqlSinComentarios = sql.replace(/--.*$/gm, '');

const obtenerNombres = (expresion) => Array.from(
    sql.matchAll(expresion),
    (match) => match[1].toLowerCase()
);

test('la instalacion completa declara las 69 tablas funcionales esperadas', () => {
    const tablas = obtenerNombres(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(fg_[a-z0-9_]+)/gi);

    assert.equal(tablas.length, 69);
    assert.equal(new Set(tablas).size, 69);
    assert.ok(tablas.includes('fg_usuario_perfil'));
    assert.ok(tablas.includes('fg_notificacion'));
    assert.ok(tablas.includes('fg_notificacion_destinatario'));
    assert.ok(tablas.includes('fg_certificado_version'));
    assert.ok(tablas.includes('fg_nota_credito_trabajo'));
    assert.ok(!tablas.includes('fg_descuentodetalle_backup_20260826_reglas_compartidas'));
});

test('el esquema final no depende de parches incrementales de columnas', () => {
    assert.doesNotMatch(sql, /\bADD\s+COLUMN\b/i);
    assert.match(sql, /CREATE TABLE public\.fg_descuentocomprobante[\s\S]*?descuento_id bigint,/i);
    assert.match(sql, /CONSTRAINT chk_fg_descom_descuento_ref/i);
    assert.match(sql, /CONSTRAINT fk_fg_descom_descuento/i);
    assert.match(sql, /CREATE INDEX idx_fg_descom_descuento_id/i);
});

test('incluye funciones, triggers, notificaciones, solicitudes y permisos finales', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fg_bloquear_mutacion_movimiento_inventario_cantidad/i);
    assert.match(sql, /CREATE TRIGGER fg_inventario_cantidad_movimiento_inmutable/i);
    assert.match(sql, /CREATE FUNCTION public\.fg_bloquear_mutacion_solicitud_evento/i);
    assert.match(sql, /CREATE TRIGGER trg_fg_solicitud_evento_inmutable/i);
    assert.match(sql, /tipo_operacion = 'EMITIR_NOTA_CREDITO' AND certificado_id IS NOT NULL AND facturacion_id IS NOT NULL/i);
    assert.match(sql, /'FAREGAS_NOTA_CREDITO_APROBAR'/i);
    assert.match(sql, /'FAREGAS_NOTA_CREDITO_AUTOAPROBAR'/i);
    assert.match(sql, /UNIQUE \(notificacion_id, usuario_id\)/i);

    const catalogoRbac = sql.match(
        /-- BEGIN CATALOGO_RBAC_FAREGAS_GENERADO([\s\S]*?)-- END CATALOGO_RBAC_FAREGAS_GENERADO/
    )?.[1];
    assert.ok(catalogoRbac);
    const bloquePermisos = catalogoRbac.match(
        /INSERT INTO public\.fg_permiso[\s\S]*?VALUES([\s\S]*?)ON CONFLICT \(clave\)/
    )?.[1];
    assert.ok(bloquePermisos);
    const permisos = [...bloquePermisos.matchAll(/^\s*\('([A-Z0-9_]+)'\s*,/gm)];
    assert.equal(permisos.length, 50);
    for (const perfil of ['AMINISTRADOR', 'CONTADOR', 'JEFE_PLANTA', 'OPERADOR', 'SISTEMAS', 'SUPERVISOR']) {
        assert.match(sql, new RegExp(`\\('${perfil}'\\s*,`));
    }
});

test('todas las mutaciones del instalador se limitan a objetos fg_*', () => {
    const mutaciones = sqlSinComentarios
        .split(';')
        .map((sentencia) => sentencia.trim())
        .map((sentencia) => sentencia.match(
            /^(ALTER\s+TABLE|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/i
        ))
        .filter(Boolean);

    const indices = [...sqlSinComentarios.matchAll(/CREATE(?:\s+UNIQUE)?\s+INDEX\s+[^\s]+\s+ON\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)];
    const triggers = [...sqlSinComentarios.matchAll(/CREATE\s+TRIGGER\s+[^\s]+[\s\S]*?\s+ON\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)];

    assert.ok(mutaciones.length > 0);
    for (const match of mutaciones) {
        assert.match(
            match[2],
            /^fg_/i,
            `La operacion ${match[1]} no debe apuntar a ${match[2]}`
        );
    }
    for (const match of [...indices, ...triggers]) {
        assert.match(match[1], /^fg_/i);
    }

    assert.doesNotMatch(
        sql,
        /\b(?:ALTER\s+TABLE|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE(?:\s+TABLE)?|CREATE(?:\s+UNIQUE)?\s+INDEX\s+[^\s]+\s+ON)\s+(?:public\.)?(?:persona|usuario|vehiculo|tarjetapropiedad|cuentacorriente)\b/i
    );
    assert.doesNotMatch(
        sqlSinComentarios,
        /CREATE\s+TRIGGER\s+[^\s]+[\s\S]*?\s+ON\s+(?:public\.)?(?:persona|usuario|vehiculo|tarjetapropiedad|cuentacorriente)\b/i
    );
});

test('las referencias heredadas son solamente prerrequisitos y no contienen secretos', () => {
    assert.match(sql, /FOREIGN KEY \(moneda_key\) REFERENCES public\.moneda/i);
    assert.match(sql, /FOREIGN KEY \(formapago_key\) REFERENCES public\.formapago/i);
    assert.match(sql, /FOREIGN KEY \(cuentacorriente_key\) REFERENCES public\.cuentacorriente/i);
    assert.doesNotMatch(sql, /(?:password|token|secret|api[_-]?key)\s*=\s*['"][^'"]+['"]/i);
    assert.doesNotMatch(sql, /(?:postgres(?:ql)?:\/\/)[^\s]+/i);
});

test('no existen nombres duplicados entre tablas, secuencias, funciones y triggers declarados', () => {
    const grupos = [
        obtenerNombres(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(fg_[a-z0-9_]+)/gi),
        obtenerNombres(/CREATE\s+SEQUENCE\s+public\.(fg_[a-z0-9_]+)/gi),
        obtenerNombres(/CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+public\.(fg_[a-z0-9_]+)/gi),
        obtenerNombres(/CREATE\s+TRIGGER\s+([a-z_][a-z0-9_]*)/gi)
    ];

    for (const nombres of grupos) {
        assert.equal(nombres.length, new Set(nombres).size);
    }

    const indices = obtenerNombres(/CREATE(?:\s+UNIQUE)?\s+INDEX\s+([a-z_][a-z0-9_]*)/gi);
    assert.equal(indices.length, new Set(indices).size);
});

test('cada FK propia se declara después de crear su tabla de destino', () => {
    const creaciones = new Map(
        [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(fg_[a-z0-9_]+)/gi)]
            .map((match) => [match[1].toLowerCase(), match.index])
    );

    for (const referencia of sql.matchAll(/REFERENCES\s+public\.(fg_[a-z0-9_]+)/gi)) {
        const tabla = referencia[1].toLowerCase();
        assert.ok(creaciones.has(tabla), `Falta CREATE TABLE para ${tabla}`);
        assert.ok(
            creaciones.get(tabla) < referencia.index,
            `La FK hacia ${tabla} aparece antes de crear la tabla`
        );
    }
});
