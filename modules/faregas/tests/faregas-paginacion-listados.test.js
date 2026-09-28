/**
 * Estandarización de paginación y filtros de fecha de FAREGAS.
 *
 * Cubre las reglas que deben cumplir TODOS los listados:
 *  - máximo 10 por página por defecto;
 *  - el total viene de un COUNT con los mismos filtros, no de items.length;
 *  - los listados transaccionales abren en HOY -> HOY;
 *  - "hasta" incluye el día completo;
 *  - desde > hasta se rechaza sin intercambiar fechas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const paginacion = require('../services/faregas-paginacion.rules');

const hoy = paginacion.hoyLocal();
const ayer = paginacion.hoyLocal(new Date(Date.now() - 86400000));

// ===========================================================================
// 1. Paginación
// ===========================================================================

test('1. por defecto son 10 registros por página en la página 1', () => {
    const r = paginacion.normalizarPaginacion({});
    assert.equal(r.page, 1);
    assert.equal(r.limit, 10);
    assert.equal(r.offset, 0);
});

test('2. 20 registros con pageSize 10 dan 2 páginas', () => {
    const r = paginacion.respuestaPaginada(new Array(20), 20, 1, 10);
    assert.equal(r.totalPages, 2);
});

test('3. 21 registros dan 3 páginas', () => {
    const r = paginacion.respuestaPaginada(new Array(10), 21, 1, 10);
    assert.equal(r.totalPages, 3);
});

test('4. la página 2 usa LIMIT 10 OFFSET 10', () => {
    const r = paginacion.normalizarPaginacion({ page: 2, pageSize: 10 });
    assert.equal(r.limit, 10);
    assert.equal(r.offset, 10);
});

test('5. la página 3 con 21 registros devuelve 1 elemento y offset 20', () => {
    const r = paginacion.normalizarPaginacion({ page: 3, pageSize: 10 });
    assert.equal(r.offset, 20);
    const envelope = paginacion.respuestaPaginada([1], 21, 3, 10);
    assert.equal(envelope.items.length, 1);
    assert.equal(envelope.totalPages, 3);
});

test('6. sin registros el total es 0 y no hay páginas', () => {
    const r = paginacion.respuestaPaginada([], 0, 1, 10);
    assert.equal(r.total, 0);
    assert.equal(r.totalPages, 0);
    assert.equal(r.items.length, 0);
});

test('7. el total es el del COUNT, no items.length', () => {
    // Página 2 de 500: solo 10 elementos, pero el total sigue siendo 500.
    const r = paginacion.respuestaPaginada(new Array(10), 500, 2, 10);
    assert.equal(r.items.length, 10);
    assert.equal(r.total, 500);
    assert.equal(r.totalPages, 50);
});

test('8. acepta los alias de parametros pagina/limite que ya usan algunos servicios', () => {
    const r = paginacion.normalizarPaginacion({ pagina: 3, limite: 20 });
    assert.equal(r.page, 3);
    assert.equal(r.limit, 20);
    assert.equal(r.offset, 40);
});

test('9. valores basura caen en el default sin romper', () => {
    ['abc', null, undefined, NaN, {}].forEach((valor) => {
        const r = paginacion.normalizarPaginacion({ page: valor, pageSize: valor });
        assert.equal(r.page, 1);
        assert.equal(r.limit, 10);
    });
});

test('10. el pageSize se acota y nunca supera 100', () => {
    assert.equal(paginacion.normalizarPaginacion({ pageSize: 5000 }).limit, 100);
    assert.equal(paginacion.normalizarPaginacion({ pageSize: 0 }).limit, 1);
    assert.equal(paginacion.normalizarPaginacion({ pageSize: 20 }).limit, 20);
});

test('11. la página nunca baja de 1', () => {
    assert.equal(paginacion.normalizarPaginacion({ page: 0 }).page, 1);
    assert.equal(paginacion.normalizarPaginacion({ page: -5 }).page, 1);
    // Con esto "anterior" en la página 1 queda deshabilitado en la UI.
    assert.equal(paginacion.normalizarPaginacion({ page: 1 }).page, 1);
});

// ===========================================================================
// 2. Filtros de fecha de listados transaccionales
// ===========================================================================

test('12. sin rango se normaliza a HOY -> HOY, nunca a todo el histórico', () => {
    [{}, { fechaDesde: '' }, { fechaDesde: '', fechaHasta: '' }].forEach((query) => {
        const r = paginacion.normalizarRangoFechas(query);
        assert.equal(r.fechaDesde, hoy);
        assert.equal(r.fechaHasta, hoy);
    });
});

test('13. un rango incompleto se completa con HOY', () => {
    const r = paginacion.normalizarRangoFechas({ fechaDesde: ayer });
    assert.equal(r.fechaDesde, ayer);
    assert.equal(r.fechaHasta, hoy);
});

test('14. un rango válido se respeta tal cual', () => {
    const r = paginacion.normalizarRangoFechas({ fechaDesde: ayer, fechaHasta: hoy });
    assert.equal(r.fechaDesde, ayer);
    assert.equal(r.fechaHasta, hoy);
});

test('15. desde > hasta se rechaza y NO se intercambian las fechas', () => {
    assert.throws(
        () => paginacion.normalizarRangoFechas({ fechaDesde: hoy, fechaHasta: ayer }),
        (error) => {
            assert.equal(error.codigo, 'RANGO_FECHAS_INVALIDO');
            assert.equal(error.statusCode, 400);
            assert.match(error.message, /no puede ser posterior/);
            return true;
        }
    );
});

test('16. una fecha con formato inválido cae en HOY en vez de romper', () => {
    const r = paginacion.normalizarRangoFechas({ fechaDesde: 'ayer', fechaHasta: 'tarde' });
    assert.equal(r.fechaDesde, hoy);
    assert.equal(r.fechaHasta, hoy);
});

test('17. el rango usa la fecha LOCAL, sin pasar por UTC', () => {
    // Aunque ya sea casi medianoche, hoyLocal devuelve ese dia local y no el
    // dia siguiente por un corrimiento de zona horaria.
    const casiNoche = new Date(2026, 8, 28, 23, 30, 0);
    assert.equal(paginacion.hoyLocal(casiNoche), '2026-09-28');
    const apenasMedianoche = new Date(2026, 8, 28, 0, 5, 0);
    assert.equal(paginacion.hoyLocal(apenasMedianoche), '2026-09-28');
});

// ===========================================================================
// 3. La condición SQL del rango
// ===========================================================================

test('18. "hasta" cubre el día completo con la forma robusta', () => {
    const params = [];
    const r = paginacion.condicionesRangoFechas('a.fecha_evento', '2026-09-28', '2026-09-28', params, 1);
    assert.deepEqual(params, ['2026-09-28', '2026-09-28']);
    assert.match(r.condiciones[0], /a\.fecha_evento >= \$1::date/);
    // La forma clave: < hasta::date + 1 día, no <= hasta::date.
    assert.match(r.condiciones[1], /a\.fecha_evento < \$2::date \+ INTERVAL '1 day'/);
    assert.doesNotMatch(r.condiciones[1], /<=\s*\$2::date\s*$/);
    assert.equal(r.siguienteIndice, 3);
});

test('19. el rango se puede combinar con otros filtros sin romper la numeración', () => {
    // Dos filtros previos, luego el rango continúa en $3 y $4.
    const params = ['planta', 'buscar'];
    const r = paginacion.condicionesRangoFechas('f.fecha', '2026-09-01', '2026-09-28', params, 3);
    assert.deepEqual(params, ['planta', 'buscar', '2026-09-01', '2026-09-28']);
    assert.match(r.condiciones[0], /\$3::date/);
    assert.match(r.condiciones[1], /\$4::date/);
    assert.equal(r.siguienteIndice, 5);
});

test('20. sin fechas no agrega condiciones ni parámetros', () => {
    const params = [];
    const r = paginacion.condicionesRangoFechas('x', '', '', params, 1);
    assert.equal(r.condiciones.length, 0);
    assert.equal(params.length, 0);
});

// ===========================================================================
// 4. Los listados que ya existían se estandarizan
// ===========================================================================

const leer = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

test('21. Ventas de chips pagina en el backend y cuenta con los mismos filtros', () => {
    const src = leer('..', 'services', 'faregas-chips.service.js');
    const i = src.indexOf('exports.listarVentas = async');
    const bloque = src.slice(i, src.indexOf('exports.', i + 10));
    assert.match(bloque, /LIMIT \$\$\{params\.length \+ 1\} OFFSET \$\$\{params\.length \+ 2\}/);
    assert.match(bloque, /COUNT\(\*\)::int AS total/);
    // Ya no hay tope fijo: el antiguo LIMIT 100 se reemplaza por paginación real.
    assert.doesNotMatch(bloque, /LIMIT 100/);
    // El ORDER BY de negocio se conserva.
    assert.match(bloque, /ORDER BY oc\.fecha_creacion DESC, oc\.id DESC/);
});

test('22. Auditoría pagina en vez de truncar a 500 filas', () => {
    const src = leer('..', 'services', 'faregas-auditoria.service.js');
    assert.doesNotMatch(src, /LIMIT 500/);
    assert.match(src, /COUNT\(\*\)::int AS total/);
    assert.match(src, /LIMIT \$\$\{paramIndex\} OFFSET \$\$\{paramIndex \+ 1\}/);
    // El ORDER BY de negocio se conserva.
    assert.match(src, /ORDER BY a\.fecha_evento DESC/);
    // Y la fecha cubre el día completo.
    assert.match(src, /a\.fecha_evento < \$\$\{paramIndex\}::date \+ INTERVAL '1 day'/);
});

test('23. Productos fiscales pagina y NO se filtra por fecha', () => {
    const src = leer('..', 'services', 'faregas-productos.service.js');
    const i = src.indexOf('exports.listar = async');
    const bloque = src.slice(i, src.indexOf('exports.', i + 10));
    assert.match(bloque, /COUNT\(\*\)::int AS total/);
    assert.match(bloque, /LIMIT/);
    // Catalogo maestro: ninguna condicion de fecha, ni siquiera CURRENT_DATE.
    assert.doesNotMatch(bloque, /fecha_creacion\s*(>=|<|>|<=)/);
    assert.doesNotMatch(bloque, /CURRENT_DATE|normalizarRangoFechas|fechaDesde|fechaHasta/);
    // El ORDER BY de negocio se conserva.
    assert.match(bloque, /ORDER BY p\.codigo_sku ASC/);
});

test('23b. el total viene del COUNT y no de items.length', () => {
    // Si alguien reemplaza el conteo por el largo del arreglo, el "total" pasa
    // a ser como maximo 10 y la paginacion miente.
    const productos = leer('..', 'services', 'faregas-productos.service.js');
    const auditoria = leer('..', 'services', 'faregas-auditoria.service.js');
    [productos, auditoria].forEach((src) => {
        assert.doesNotMatch(src, /Number\(result\.rows\.length\)/);
    });
    // El sobre se arma con el valor leido del COUNT.
    assert.match(productos, /Number\(conteo\.rows\[0\]\?\.total \|\| 0\),\s*pagina,\s*limit/);
    assert.match(auditoria, /Number\(conteo\.rows\[0\]\?\.total \|\| 0\),\s*page,\s*limit/);
});

test('23c. el COUNT reutiliza el mismo WHERE que el listado', () => {
    // Si el COUNT se hiciera sin filtros, el total seria el de toda la tabla.
    const productos = leer('..', 'services', 'faregas-productos.service.js');
    const conteoProductos = productos.slice(productos.indexOf('const conteo = await db.query'));
    assert.match(conteoProductos.slice(0, 500), /\$\{where\}/);
    const auditoria = leer('..', 'services', 'faregas-auditoria.service.js');
    assert.match(auditoria, /const where = ' WHERE 1=1' \+ query\.slice/);
    assert.match(auditoria, /SELECT COUNT\(\*\)::int AS total FROM fg_auditoria_acceso a\$\{where\}/);
});

test('23d. Usuarios pagina y NO se filtra por fecha', () => {
    const src = leer('..', 'services', 'faregas-usuarios.service.js');
    const i = src.indexOf('exports.obtenerUsuariosPaginado');
    const bloque = src.slice(i);
    assert.match(bloque, /COUNT\(\*\)::int AS total/);
    assert.doesNotMatch(bloque, /normalizarRangoFechas|fecha_creacion|CURRENT_DATE|fechaDesde|fechaHasta/);
    assert.match(bloque, /ORDER BY u\.username/);
});

test('24. Usuarios pagina y NO se filtra por fecha', () => {
    const src = leer('..', 'services', 'faregas-usuarios.service.js');
    const i = src.indexOf('exports.obtenerUsuariosPaginado');
    const bloque = src.slice(i);
    assert.match(bloque, /COUNT\(\*\)::int AS total/);
    assert.doesNotMatch(bloque, /normalizarRangoFechas|fecha_creacion/);
    assert.match(bloque, /ORDER BY u\.username/);
});

test('25. Inventario de chips baja a 10 por página sin filtro de fecha', () => {
    const src = leer('..', 'services', 'faregas-chips.service.js');
    const i = src.indexOf('exports.listar = async');
    const bloque = src.slice(i, src.indexOf('exports.', i + 10));
    assert.match(bloque, /pageSize = 10/);
    // Es estado de stock: no se le aplica rango de fechas.
    assert.doesNotMatch(bloque, /normalizarRangoFechas/);
});

test('26. Facturación admin baja a 10 comprobantes por página', () => {
    const src = leer('..', 'services', 'faregas-facturacion-admin.service.js');
    assert.match(src, /enteroAcotado\(query\.limite, 10, 1, 100\)/);
    // Sigue contando con los mismos filtros.
    assert.match(src, /SELECT COUNT\(\*\)::int AS total/);
});

test('27. Nubefact, SUNAT y correlativos de certificados no se tocaron', () => {
    // El alcance de esta tarea es consulta/listado: la emision no se modifica.
    const facturacion = leer('..', 'services', 'faregas-facturacion.service.js');
    assert.doesNotMatch(facturacion, /faregas-paginacion\.rules/);
    // La emision de venta directa sigue intacta.
    const canonica = leer('..', 'services', 'faregas-venta-directa-canonica.service.js');
    assert.match(canonica, /const crearVentaDirecta = async/);
    assert.doesNotMatch(canonica, /faregas-paginacion\.rules/);
    // Y el cliente Nubefact queda igual: ni timeout ni retries se tocaron.
    const nubefact = leer('..', '..', '..', 'services', 'integrations', 'nubefact.service.js');
    assert.match(nubefact, /timeout: config\.nubefact\.timeoutMs/);
});
