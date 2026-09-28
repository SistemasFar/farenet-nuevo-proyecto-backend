/**
 * Paginación y buscadores de los TRES listados de esta tarea:
 *
 *   1. CHIPS -> Inventario -> Unidades registradas
 *   2. CONFIGURACIÓN -> Sedes
 *   3. FACTURACIÓN -> Comprobantes
 *
 * Reglas que se fijan aquí:
 *  - 10 registros por página por defecto, con LIMIT/OFFSET real en el backend;
 *  - el TOTAL viene de un COUNT con los MISMOS filtros que el SELECT;
 *  - la búsqueda se aplica ANTES de LIMIT/OFFSET;
 *  - los buscadores son parciales y case-insensitive (ILIKE);
 *  - las tarjetas de resumen NO dependen de items.length.
 *
 * Los tests de base de datos son opt-in (FAREGAS_TEST_DB=1). Los de estructura
 * y de SQL son always-on: leen el código fuente y no dependen de la base.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
if (USA_BASE_DE_DATOS) {
    require('../../../config/env-loader').loadEnv(true);
}

const paginacion = require('../services/faregas-paginacion.rules');

const fuente = (nombre) => fs.readFileSync(
    path.join(__dirname, '..', 'services', nombre), 'utf8');

const fuenteChips = fuente('faregas-chips.service.js');
const fuenteConfig = fuente('faregas-config.service.js');
const fuenteFactAdmin = fuente('faregas-facturacion-admin.service.js');

const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';
const USUARIO = { username: 'gibarra', perfil_id: 'SISTEMAS', planta_key: '201', ip_direccion: '127.0.0.1' };

/** Salta el test si la base de datos no está habilitada de forma explícita. */
const conBase = (fn) => (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
    return fn(t);
};

/** Bloque fuente de un export, acotado hasta el siguiente `exports.`. */
const bloqueDe = (fuenteTexto, desde) => {
    const inicio = fuenteTexto.indexOf(desde);
    assert.notEqual(inicio, -1, `no se encontro ${desde}`);
    const fin = fuenteTexto.indexOf('\nexports.', inicio + desde.length);
    return fin === -1 ? fuenteTexto.slice(inicio) : fuenteTexto.slice(inicio, fin);
};

/**
 * Quita los comentarios de línea. Los tests que comprueban que algo NO aparece
 * deben mirar el SQL real: si el service lo explica en un comentario, eso no
 * cuenta como código prohibido.
 */
const sinComentarios = (texto) => texto.replace(/\/\/[^\n]*/g, '');

/** Salto de línea tolerante a CRLF, para comprobar que X precede a LIMIT. */
const antesDeLimit = (x) => new RegExp(`${x}\\s*\\r?\\n\\s*LIMIT`);

/** Igual que `antesDeLimit`, pero el segundo elemento puede ser cualquier cosa. */
const antesDe = (x, y) => new RegExp(`${x}[\\s\\S]{0,80}?${y}`);

// ===========================================================================
// CHIPS -> Inventario -> Unidades registradas  (casos 1 a 5)
// ===========================================================================

test('1. CHIPS: 19 chips con límite 10 dan página 1 = 10 y página 2 = 9', conBase(async () => {
    const chips = require('../services/faregas-chips.service');
    const primera = await chips.listar({ plantaKey: '201', page: 1, pageSize: 10 }, USUARIO);
    assert.equal(primera.items.length, 10, 'la página 1 debe traer 10');
    assert.equal(primera.limit, 10);
    assert.equal(primera.totalPages, 2);

    const segunda = await chips.listar({ plantaKey: '201', page: 2, pageSize: 10 }, USUARIO);
    assert.equal(segunda.items.length, 9, 'la página 2 debe traer los 9 restantes');
    assert.equal(segunda.total, primera.total, 'el total no depende de la página');

    // Las dos páginas no se solapan y cubren el total completo.
    const ids = new Set([...primera.items, ...segunda.items].map((c) => c.id));
    assert.equal(ids.size, primera.total);
}));

test('2. CHIPS: buscar "CHIP78" encuentra la coincidencia por código', conBase(async () => {
    const chips = require('../services/faregas-chips.service');
    const r = await chips.listar({ plantaKey: '201', buscar: 'CHIP78', page: 1 }, USUARIO);
    assert.ok(r.total >= 1, 'debe encontrar al menos un chip por código');
    assert.ok(
        r.items.every((c) => c.numero_chip.toUpperCase().includes('CHIP78')),
        'todas las filas deben coincidir por el código del chip'
    );
}));

test('3. CHIPS: buscar por nombre/tipo devuelve coincidencias', conBase(async () => {
    const chips = require('../services/faregas-chips.service');
    // El tipo/nombre vive en fg_producto_inventariable, no en fg_chip.
    const r = await chips.listar({ plantaKey: '201', buscar: 'Chip y porta chip', page: 1 }, USUARIO);
    assert.ok(r.total >= 1, 'debe encontrar por el nombre del tipo de chip');
    assert.ok(
        r.items.every((c) => /chip/i.test(`${c.producto_nombre || ''} ${c.producto_codigo || ''}`)),
        'las filas deben coincidir por nombre o código de producto'
    );
}));

test('4. CHIPS: el buscador usa la relación real y ninguna columna nueva', () => {
    const bloque = bloqueDe(fuenteChips, 'exports.listar = async');
    // Se resuelve por la JOIN existente, sin alterar el esquema.
    assert.match(bloque, /pi\.nombre ILIKE/);
    assert.match(bloque, /pi\.codigo ILIKE/);
    assert.match(bloque, /c\.numero_chip ILIKE/);
    assert.doesNotMatch(fuenteChips, /ALTER TABLE fg_chip/i);
    assert.doesNotMatch(fuenteChips, /ADD COLUMN/i);
});

test('5. CHIPS: el resumen usa el total real, no items.length', conBase(async () => {
    const chips = require('../services/faregas-chips.service');
    const pagina = await chips.listar({ plantaKey: '201', page: 1, pageSize: 10 }, USUARIO);
    const resumen = await chips.resumen('201', USUARIO, null);
    const datos = resumen.resumen || resumen;
    // El resumen describe el inventario completo, no las 10 filas visibles.
    assert.ok(datos.total >= pagina.total, 'el resumen debe ver al menos todo lo que lista la página');
    assert.equal(
        datos.disponibles + datos.reservados + datos.vendidos + datos.baja,
        datos.total,
        'los estados deben sumar el total real'
    );
}));

test('5b. CHIPS: la paginación va en el SQL, no en un slice del frontend', () => {
    const bloque = sinComentarios(bloqueDe(fuenteChips, 'exports.listar = async'));
    assert.match(bloque, /LIMIT \$\$\{params\.length - 1\} OFFSET \$\$\{params\.length\}/);
    // COUNT separado: un COUNT(*) OVER() devolvería 0 en una página vacía.
    assert.match(bloque, /SELECT COUNT\(\*\)::int AS total/);
    assert.doesNotMatch(bloque, /COUNT\(\*\) OVER\(\)/);
    // El ORDER BY de negocio se conserva y precede al LIMIT.
    assert.match(bloque, antesDeLimit('ORDER BY c\\.id DESC'));
});

test('5c. CHIPS: una página vacía conserva el total real', conBase(async () => {
    const chips = require('../services/faregas-chips.service');
    const r = await chips.listar({ plantaKey: '201', page: 99, pageSize: 10 }, USUARIO);
    assert.equal(r.items.length, 0, 'la página 99 no debe traer filas');
    assert.ok(r.total > 0, 'pero el total debe seguir siendo el real, no 0');
}));

test('5d. CHIPS: el estado y la búsqueda se combinan', conBase(async () => {
    const chips = require('../services/faregas-chips.service');
    const conFiltro = await chips.listar(
        { plantaKey: '201', estado: 'VENDIDO', buscar: 'CHIP', page: 1 }, USUARIO);
    const soloEstado = await chips.listar(
        { plantaKey: '201', estado: 'VENDIDO', page: 1 }, USUARIO);
    assert.ok(conFiltro.total <= soloEstado.total, 'añadir texto no puede ampliar el conjunto');
    assert.ok(
        conFiltro.items.every((c) => c.estado === 'VENDIDO'),
        'el filtro de estado debe seguir aplicándose'
    );
}));

// ===========================================================================
// CONFIGURACIÓN -> Sedes  (casos 6 a 9)
// ===========================================================================

test('6. SEDES: más de 10 sedes pagina en el backend', conBase(async () => {
    const config = require('../services/faregas-config.service');
    const primera = await config.getSedes({ page: 1, pageSize: 10 });
    assert.equal(primera.items.length, 10);
    assert.ok(primera.total > 10, 'debe haber más de 10 sedes para que la paginación tenga sentido');
    assert.equal(primera.totalPages, Math.ceil(primera.total / 10));

    const ultima = await config.getSedes({ page: primera.totalPages, pageSize: 10 });
    assert.ok(ultima.items.length > 0 && ultima.items.length <= 10, 'la última página está parcial');
    assert.equal(ultima.total, primera.total);
}));

test('7. SEDES: buscar "CHORR" encuentra CHORRILLOS', conBase(async () => {
    const config = require('../services/faregas-config.service');
    const r = await config.getSedes({ buscar: 'CHORR', page: 1, pageSize: 10 });
    assert.ok(r.total >= 1, 'debe encontrar CHORRILLOS por coincidencia parcial');
    assert.ok(
        r.items.every((s) => /chorr/i.test(s.nombre)),
        'sólo puede devolver sedes cuyo nombre contiene CHORR'
    );
}));

test('8. SEDES: la búsqueda es case-insensitive', conBase(async () => {
    const config = require('../services/faregas-config.service');
    const mayus = await config.getSedes({ buscar: 'CHORR', pageSize: 10 });
    const minus = await config.getSedes({ buscar: 'chorr', pageSize: 10 });
    const mezclado = await config.getSedes({ buscar: 'ChOrR', pageSize: 10 });
    assert.equal(mayus.total, minus.total, 'CHORR y chorr deben dar el mismo total');
    assert.equal(mayus.total, mezclado.total);
    assert.deepEqual(
        mayus.items.map((s) => s.key).sort(),
        minus.items.map((s) => s.key).sort(),
        'deben devolver exactamente las mismas sedes'
    );
}));

test('9. SEDES: la búsqueda se aplica antes de LIMIT/OFFSET y el COUNT la incluye', () => {
    const bloque = sinComentarios(bloqueDe(fuenteConfig, 'exports.getSedes = async'));
    // COUNT con el mismo FROM/WHERE que el listado.
    assert.match(bloque, /SELECT COUNT\(\*\)::int AS total \$\{FROM\} \$\{where\}/);
    // La condición obligatoria es el NOMBRE de la sede.
    assert.match(bloque, /p\.nombre ILIKE \$\{patron\}/);
    // El ORDER BY de negocio se conserva y precede a la paginación.
    assert.match(bloque, antesDe('ORDER BY p\\.activo DESC, p\\.nombre ASC', 'paginacionSql'));
    // Y existe un OFFSET de verdad: sin él el LIMIT devolvería siempre la
    // primera página y "Siguiente" no avanzaría.
    assert.match(bloque, /LIMIT \$\$\{params\.length \+ 1\} OFFSET \$\$\{params\.length \+ 2\}/);
});

test('9b. SEDES: el total cuenta el conjunto filtrado, no las filas de la página', conBase(async () => {
    const config = require('../services/faregas-config.service');
    const todas = await config.getSedes({ page: 1, pageSize: 10 });
    const filtradas = await config.getSedes({ buscar: 'CHORR', page: 1, pageSize: 10 });
    assert.ok(filtradas.total < todas.total, 'el filtro debe reducir el total');
    assert.equal(
        filtradas.totalPages,
        filtradas.total === 0 ? 0 : Math.ceil(filtradas.total / 10),
        'con pocas coincidencias debe decir Página 1 de 1, no Página 1 de 3'
    );
}));

test('9c. SEDES: sin coincidencias devuelve 0 y ninguna página', conBase(async () => {
    const config = require('../services/faregas-config.service');
    const r = await config.getSedes({ buscar: 'zzz-sede-inexistente-zzz' });
    assert.equal(r.total, 0);
    assert.equal(r.items.length, 0);
    assert.equal(r.totalPages, 0);
}));

test('9e. SEDES: el catálogo auxiliar de empresas sigue trayendo TODAS las sedes', conBase(async () => {
    // `getSedesEmpresas` alimenta un select: si recibiera el sobre de
    // paginación o una página, el desplegable mostraría solo 10 sedes.
    const config = require('../services/faregas-config.service');
    const todas = await config.getSedes({ page: 1, pageSize: 10 });
    const catalogo = await config.getSedes({ todos: true });
    assert.equal(catalogo.total, todas.total, 'el catálogo no debe truncar el conjunto');
    assert.equal(catalogo.items.length, todas.total,
        'el catálogo auxiliar debe traer todas las sedes, no una página');
}));

test('9f. SEDES: el catálogo auxiliar no se cuelga de la paginación de la pantalla', () => {
    const controller = fs.readFileSync(
        path.join(__dirname, '..', 'controllers', 'faregas-config.controller.js'), 'utf8');
    const bloque = sinComentarios(bloqueDe(controller, 'exports.getSedesEmpresas'));
    // Debe pedir el catálogo completo y devolver el arreglo.
    assert.match(bloque, /getSedes\(\{ todos: true \}\)/);
    assert.match(bloque, /sedes: resultado\.items/);
});

test('9d. SEDES: la búsqueda no filtra por fecha (es un catálogo maestro)', () => {
    // Un catálogo maestro no lleva rango de fechas: si lo llevara, las sedes
    // creadas antes de "hoy" desaparecerían del listado.
    const bloque = bloqueDe(fuenteConfig, 'exports.getSedes = async');
    assert.doesNotMatch(bloque, /fecha_creacion/);
    assert.doesNotMatch(bloque, /normalizarRangoFechas/);
});

// ===========================================================================
// FACTURACIÓN -> Comprobantes  (casos 10 a 17)
// ===========================================================================

test('10. FACTURACIÓN: más de 10 comprobantes pagina en el backend', conBase(async () => {
    const admin = require('../services/faregas-facturacion-admin.service');
    const hoy = paginacion.hoyLocal();
    const primera = await admin.listar(
        { plantaKey: '201', fechaDesde: hoy, fechaHasta: hoy, pagina: 1 }, USUARIO);
    assert.equal(primera.documentos.length, 10, 'el límite por defecto es 10');
    assert.equal(primera.limite, 10);
    assert.ok(primera.total > 10, 'debe haber más de 10 comprobantes');
    assert.equal(primera.totalPages, Math.ceil(primera.total / 10));
}));

test('11. FACTURACIÓN: busca por nombre / razón social del cliente', () => {
    // Usa el snapshot fiscal de fg_facturacion; no hace lookup a fg_cliente
    // porque la propia fila de facturación ya guarda el nombre congelado.
    const bloque = bloqueDe(fuenteFactAdmin, 'const construirFiltros');
    assert.match(bloque, /f\.nombre_razon_social ILIKE/);
    assert.doesNotMatch(bloque, /JOIN fg_cliente/);
});

test('11b. FACTURACIÓN: busca por DNI/RUC y por número de comprobante', () => {
    const bloque = bloqueDe(fuenteFactAdmin, 'const construirFiltros');
    assert.match(bloque, /f\.nro_documento ILIKE/);
    assert.match(bloque, /f\.nro_comprobante ILIKE/);
    // Parcial y case-insensitive.
    assert.match(bloque, /ILIKE '%' \|\| \? \|\| '%'/);
});

test('12. FACTURACIÓN: busca por placa', () => {
    const bloque = bloqueDe(fuenteFactAdmin, 'const construirFiltros');
    assert.match(bloque, /COALESCE\(v\.placa, ''\) ILIKE/);
});

test('13. FACTURACIÓN: el texto se combina con empresa, sede y estado', () => {
    const bloque = bloqueDe(fuenteFactAdmin, 'const construirFiltros');
    assert.match(bloque, /p\.empresa_key = \?/);
    assert.match(bloque, /COALESCE\(f\.planta_key, oc\.planta_key\) = \?/);
    assert.match(bloque, /ESTADO_INVALIDO/);
});

test('14. FACTURACIÓN: COUNT y SELECT comparten exactamente el mismo FROM/WHERE', () => {
    const bloque = sinComentarios(bloqueDe(fuenteFactAdmin, 'exports.listar'));
    // Un único `from` interpolado en ambas consultas: no pueden divergir.
    assert.match(bloque, /const from = `/);
    // El `from` es el que lleva el WHERE, así que el SELECT hereda los filtros.
    assert.match(bloque, /WHERE \$\{filtros\.where\}`;/);
    // El COUNT interpola `${from}` y NADA más: si se le añadiera un WHERE
    // propio, el total dejaría de usar los mismos filtros que el listado.
    assert.match(bloque, /SELECT COUNT\(\*\)::int AS total \$\{from\}`/);
    assert.doesNotMatch(bloque, /total \$\{from\}\s+WHERE/);
    // El ORDER BY de negocio se conserva y precede al LIMIT.
    assert.match(bloque, antesDeLimit('ORDER BY f\\.fecha_creacion DESC, f\\.id DESC'));
});

test('15. FACTURACIÓN: la página 2 no repite comprobantes de la página 1', conBase(async () => {
    const admin = require('../services/faregas-facturacion-admin.service');
    const hoy = paginacion.hoyLocal();
    const a = await admin.listar(
        { plantaKey: '201', fechaDesde: hoy, fechaHasta: hoy, pagina: 1 }, USUARIO);
    const b = await admin.listar(
        { plantaKey: '201', fechaDesde: hoy, fechaHasta: hoy, pagina: 2 }, USUARIO);
    assert.equal(b.pagina, 2);
    assert.equal(b.page, 2);
    const idsA = new Set(a.documentos.map((d) => d.id));
    assert.ok(
        b.documentos.every((d) => !idsA.has(d.id)),
        'la página 2 no puede repetir comprobantes de la página 1'
    );
}));

test('16. FACTURACIÓN: los filtros de fecha y el texto se combinan antes del LIMIT', conBase(async () => {
    const admin = require('../services/faregas-facturacion-admin.service');
    const hoy = paginacion.hoyLocal();
    const soloHoy = await admin.listar(
        { plantaKey: '201', fechaDesde: hoy, fechaHasta: hoy, pagina: 1 }, USUARIO);
    const conTexto = await admin.listar(
        { plantaKey: '201', fechaDesde: hoy, fechaHasta: hoy, texto: 'GRACE', pagina: 1 }, USUARIO);
    assert.ok(conTexto.total <= soloHoy.total, 'el texto no puede ampliar el rango de fechas');
    // El total es el del resultado filtrado, no el de la página ni el general.
    assert.equal(conTexto.totalPages,
        conTexto.total === 0 ? 0 : Math.ceil(conTexto.total / conTexto.limite));
}));

test('16b. FACTURACIÓN: un rango vacío nunca significa "todo el histórico"', () => {
    const hoy = paginacion.hoyLocal();
    const rango = paginacion.normalizarRangoFechas({});
    assert.equal(rango.fechaDesde, hoy);
    assert.equal(rango.fechaHasta, hoy);
    // Tampoco con fechas basura o incompletas.
    const parcial = paginacion.normalizarRangoFechas({ fechaDesde: '2026-01-01' });
    assert.equal(parcial.fechaHasta, hoy, 'un rango incompleto se completa con hoy');
    assert.equal(parcial.fechaDesde, '2026-01-01');
});

test('17. FACTURACIÓN: el sobre trae totalPages y conserva `pagina`/`limite`', conBase(async () => {
    const admin = require('../services/faregas-facturacion-admin.service');
    const hoy = paginacion.hoyLocal();
    const r = await admin.listar(
        { plantaKey: '201', fechaDesde: hoy, fechaHasta: hoy, pagina: 1 }, USUARIO);
    // Alias del sobre estándar, sin quitar los nombres históricos.
    assert.equal(r.page, r.pagina);
    assert.equal(r.limit, r.limite);
    assert.equal(r.totalPages, r.total === 0 ? 0 : Math.ceil(r.total / r.limite));
}));

// ===========================================================================
// Reglas transversales de los tres listados
// ===========================================================================

test('18. los tres listados usan el helper de paginación compartido', () => {
    for (const [nombre, archivo] of [
        ['chips', fuenteChips],
        ['sedes', fuenteConfig],
        ['facturación', fuenteFactAdmin]
    ]) {
        assert.match(archivo, /paginacion\.normalizarPaginacion|enteroAcotado/,
            `${nombre} debe usar el helper de paginación`);
    }
});

test('18b. el helper compartido imposes 10 registros por página', () => {
    assert.equal(paginacion._private.PAGE_SIZE_POR_DEFECTO, 10,
        'si sube el default, las tres pantallas dejan de mostrar 10 por página');
    assert.equal(paginacion.normalizarPaginacion({}).limit, 10);
    assert.equal(paginacion.normalizarPaginacion({ page: 3 }).offset, 20);
    // El tope protege de un pageSize absurdo mandado por el cliente.
    assert.equal(paginacion.normalizarPaginacion({ pageSize: 100000 }).limit, 100);
    assert.equal(paginacion.normalizarPaginacion({ pageSize: -5 }).limit, 1);
    assert.equal(paginacion.normalizarPaginacion({ page: 0 }).page, 1);
});

test('19. el backend no pagina en memoria con .slice()', () => {
    for (const [nombre, archivo] of [
        ['chips', fuenteChips],
        ['sedes', fuenteConfig],
        ['facturación', fuenteFactAdmin]
    ]) {
        assert.doesNotMatch(archivo, /\.slice\(\s*\(?\s*\(?\s*page/, `${nombre} no debe paginar en memoria`);
    }
});

test('20. `hasta` cubre el día completo', () => {
    const params = [];
    const { condiciones } = paginacion.condicionesRangoFechas(
        'f.fecha_creacion', '2026-09-01', '2026-09-01', params, 1);
    assert.equal(condiciones.length, 2);
    assert.match(condiciones[1], /<\s*\$\d+::date \+ INTERVAL '1 day'/,
        'el límite superior debe ser exclusivo del día siguiente');
});

test('21. desde > hasta se rechaza sin intercambiar las fechas', () => {
    assert.throws(
        () => paginacion.normalizarRangoFechas({ fechaDesde: '2026-09-30', fechaHasta: '2026-09-01' }),
        (e) => e.statusCode === 400 && e.codigo === 'RANGO_FECHAS_INVALIDO'
    );
});
