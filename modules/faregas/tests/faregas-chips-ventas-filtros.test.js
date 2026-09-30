/**
 * Filtros de fecha y paginación de "Ventas de chips".
 *
 * El bug reportado era que BUSCAR y LIMPIAR no hacían nada, pero la causa no
 * estaba en la consulta: `listarVentas` ya paginaba y filtraba en el backend.
 * El fallo estaba en que el hook que maneja los filtros no disparaba la
 * consulta, y en que el backend nunca recibía las fechas.
 *
 * Estos tests fijan las dos capas por separado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
if (USA_BASE_DE_DATOS) {
    require('../../../config/env-loader').loadEnv(true);
}

const db = require('../../../config/database');
const chips = require('../services/faregas-chips.service');
const paginacion = require('../services/faregas-paginacion.rules');

const FRONT = path.join(__dirname, '..', '..', '..', '..', 'farenetFrontend', 'src', 'modules', 'faregas');
const HOOK = fs.readFileSync(path.join(FRONT, 'views', 'hooks', 'useListadoPaginado.ts'), 'utf8');
const VISTA = fs.readFileSync(path.join(FRONT, 'views', 'Chips', 'ChipsView.tsx'), 'utf8');
const API = fs.readFileSync(path.join(FRONT, 'services', 'faregas-chips.api.ts'), 'utf8');

const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';
const conBase = (fn) => (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
    return fn(t);
};

const USUARIO = { perfil_id: 'SISTEMAS', planta_key: '201' };
const hoy = () => paginacion.hoyLocal();
const ayer = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
};

/** Recorta la función `listarVentas` del service. */
const bloqueListarVentas = () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'services', 'faregas-chips.service.js'), 'utf8');
    const ini = src.indexOf('exports.listarVentas = async');
    const fin = src.indexOf('\nexports.', ini + 10);
    return src.slice(ini, fin === -1 ? undefined : fin);
};

// ===========================================================================
// 1. El backend filtra y pagina de verdad
// ===========================================================================

test('1. la consulta aplica LIMIT/OFFSET y cuenta sobre los mismos filtros', conBase(async () => {
    const bloque = bloqueListarVentas();
    assert.match(bloque, /paginacion\.normalizarPaginacion\(filtros\)/, 'pagina con el helper');
    assert.match(bloque, /LIMIT \$\$[\s\S]{0,20}OFFSET \$\$/, 'LIMIT/OFFSET en la consulta');
    // El COUNT se arma con el mismo WHERE que el listado.
    assert.match(bloque, /WHERE \$\{where\}/);
    assert.equal((bloque.match(/WHERE \$\{where\}/g) || []).length, 2,
        'el conteo y el listado comparten el WHERE');
    // El total sale del COUNT, nunca de la longitud de la página.
    assert.match(bloque, /Number\(conteo\.rows\[0\]\?\.total \|\| 0\)/);
}));

test('2. sin rango explícito se abre en HOY -> HOY, nunca en todo el histórico', conBase(async () => {
    const r = await chips.listarVentas('201', USUARIO, { pagina: 1 });
    const rango = paginacion.normalizarRangoFechas({});
    assert.equal(rango.fechaDesde, hoy());
    assert.equal(rango.fechaHasta, hoy());
    // Y todas las ventas devueltas son de hoy.
    const listado = await chips.listarVentas('201', USUARIO, { pagina: 1 });
    listado.ventas.forEach((v) => {
        const dia = new Date(v.creadoEn).toISOString().slice(0, 10);
        assert.equal(dia, hoy(), `la venta ${v.operacionId} es de ${dia}, no de hoy`);
    });
}));

test('3. un rango de un solo día devuelve sólo ese día', conBase(async () => {
    const dia = ayer();
    const r = await chips.listarVentas('201', USUARIO, { fechaDesde: dia, fechaHasta: dia, pagina: 1 });
    r.ventas.forEach((v) => {
        assert.equal(new Date(v.creadoEn).toISOString().slice(0, 10), dia,
            `la venta ${v.operacionId} está fuera del rango pedido`);
    });
    // Un rango sin ventas devuelve 0, no la lista completa.
    const vacio = await chips.listarVentas('201', USUARIO, { fechaDesde: '2000-01-01', fechaHasta: '2000-01-02', pagina: 1 });
    assert.equal(vacio.total, 0, 'un rango antiguo no debe traer ventas');
    assert.deepEqual(vacio.ventas, []);
}));

test('4. "hasta" cubre el día completo, no sólo hasta las 00:00', conBase(async () => {
    const dia = ayer();
    // Se compara contra el total del mismo día leído de la tabla.
    const directo = await db.query(
        `SELECT COUNT(DISTINCT oc.id)::int n FROM fg_operacion_comercial oc
         JOIN fg_operacion_detalle od ON od.operacion_id = oc.id
         JOIN fg_operacion_detalle_chip odc ON odc.operacion_detalle_id = od.id
         WHERE oc.planta_key = $1
           AND oc.estado IN ('PAGADO','FACTURADO','ANULADO')
           AND oc.fecha_creacion >= $2::date
           AND oc.fecha_creacion < $3::date + INTERVAL '1 day'`,
        ['201', dia, dia]);
    const r = await chips.listarVentas('201', USUARIO, { fechaDesde: dia, fechaHasta: dia, pagina: 1 });
    assert.equal(r.total, directo.rows[0].n, 'el rango incluye todo el día');
}));

test('5. la paginación parte el rango y el total no depende de la página', conBase(async () => {
    const dia = ayer();
    const p1 = await chips.listarVentas('201', USUARIO, { fechaDesde: dia, fechaHasta: dia, pagina: 1 });
    const p2 = await chips.listarVentas('201', USUARIO, { fechaDesde: dia, fechaHasta: dia, pagina: 2 });
    assert.equal(p1.total, p2.total, 'el total es el del rango completo');
    assert.equal(p1.limit, 10);
    assert.ok(p1.ventas.length <= 10, 'nunca más de 10 por página');
    if (p1.totalPages > 1) {
        const ids1 = new Set(p1.ventas.map((v) => v.operacionId));
        assert.ok(p2.ventas.every((v) => !ids1.has(v.operacionId)), 'la página 2 no repite la 1');
    }
}));

test('6. un rango invertido se rechaza con mensaje claro', conBase(async () => {
    await assert.rejects(
        () => chips.listarVentas('201', USUARIO, { fechaDesde: '2026-09-30', fechaHasta: '2026-09-01' }),
        (e) => {
            // El service lanza con `codigo` en el mensaje y el texto en
            // `detalles`; el controller devuelve ambos al frontend.
            assert.equal(e.statusCode, 400);
            assert.match(e.message, /RANGO_FECHAS_INVALIDO/);
            assert.match(e.detalles, /no puede ser posterior/i);
            assert.match(e.detalles, /Desde/);
            assert.match(e.detalles, /Hasta/);
            return true;
        }
    );
}));

test('6b. una fecha ilegible cae en HOY, nunca en "todo el histórico"', conBase(async () => {
    // `normalizarRangoFechas` sustituye cualquier valor que no sea AAAA-MM-DD por
    // HOY. Es la misma regla del módulo: un filtro inválido no puede terminar
    // devolviendo el histórico completo.
    const r = await chips.listarVentas('201', USUARIO, { fechaDesde: 'ayer', fechaHasta: 'tarde', pagina: 1 });
    const rango = paginacion.normalizarRangoFechas({ fechaDesde: 'ayer', fechaHasta: 'tarde' });
    assert.equal(rango.fechaDesde, hoy());
    assert.equal(rango.fechaHasta, hoy());
    // Y el listado coincide con el de HOY -> HOY.
    const referencia = await chips.listarVentas('201', USUARIO, { pagina: 1 });
    assert.equal(r.total, referencia.total);
    r.ventas.forEach((v) => {
        assert.equal(new Date(v.creadoEn).toISOString().slice(0, 10), hoy());
    });
}));

// ===========================================================================
// 2. El backend recibe y expone los parámetros
// ===========================================================================

test('7. la API manda las fechas como query params', () => {
    const bloque = /listarVentas: async[\s\S]*?\n  \},/.exec(API);
    assert.ok(bloque, 'no se encontró listarVentas');
    assert.match(bloque[0], /params\.set\('fechaDesde', filtros\.fechaDesde\)/);
    assert.match(bloque[0], /params\.set\('fechaHasta', filtros\.fechaHasta\)/);
    // Y sólo si vienen informadas: vacío no se manda, para no convertir el
    // filtro en "todo el histórico" por accidente.
    assert.match(bloque[0], /if \(filtros\.fechaDesde\)/);
    assert.match(bloque[0], /if \(filtros\.fechaHasta\)/);
});

test('8. la vista delega en el hook y no filtra en memoria', () => {
    const bloque = /useListadoPaginado<VentaChipOperacion>\(\{[\s\S]*?\}\);/.exec(VISTA);
    assert.ok(bloque, 'no se encontró useListadoPaginado en la vista');
    assert.match(bloque[0], /transaccional: true/);
    assert.match(bloque[0], /page: Number\(params\.page \|\| 1\)/);
    assert.match(bloque[0], /pageSize: Number\(params\.pageSize \|\| 10\)/);
    // Las cuatro claves viajan al backend. Se cuentan para que quitar una sola
    // (por ejemplo el fechaHasta) detectable.
    const params = [...bloque[0].matchAll(/\b(page|pageSize|fechaDesde|fechaHasta):\s*(?:Number|String)\(params\.\1 \|\| [^)]*\)/g)];
    assert.deepEqual(params.map((m) => m[1]).sort(), ['fechaDesde', 'fechaHasta', 'page', 'pageSize'],
        'deben viajar page, pageSize y las dos fechas');
    assert.match(bloque[0], /fechaDesde: String\(params\.fechaDesde \|\| ''\)/);
    assert.match(bloque[0], /fechaHasta: String\(params\.fechaHasta \|\| ''\)/);
    const seccion = VISTA.slice(VISTA.indexOf('function TabVentas'));
    // La tabla se dibuja desde lo que devuelve el backend.
    assert.match(seccion, /ventas\.length === 0/, 'el estado vacío se decide con el total del backend');
    // Y las ventas se usan tal cual, sin refiltrar por fecha en memoria.
    assert.match(seccion, /const ventas = listado\.items;/, 'no se re-filtran los items del backend');
    assert.doesNotMatch(seccion, /\.items\.filter\([\s\S]{0,200}?fecha/i,
        'no filtra por fecha en memoria sobre los items del backend');
    assert.doesNotMatch(seccion, /\.filter\([\s\S]{0,120}?fechaDesde|\.filter\([\s\S]{0,120}?fechaHasta/i,
        'ningún filter de la vista usa las fechas');
});

// ===========================================================================
// 3. El hook: BUSCAR y LIMPIAR sí recargan (la causa real del bug)
// ===========================================================================

/** Recorta un callback del hook. */
const bloqueHook = (marca) => {
    const ini = HOOK.indexOf(marca);
    assert.notEqual(ini, -1, `no se encontró ${marca}`);
    const fin = HOOK.indexOf('\n\n', ini);
    return HOOK.slice(ini, fin === -1 ? undefined : fin);
};

test('9. el efecto recarga cuando cambian los filtros APLICADOS', () => {
    // La causa del bug: el efecto sólo dependía de [page, pageSize] y
    // aplicarFiltros/limpiarFiltros sólo hacían setPage(1). Sobre la página 1
    // eso no produce ningún cambio, así que React no re-ejecutaba el efecto y
    // no se consultaba nada.
    assert.match(HOOK, /\}, \[page, pageSize, aplicados, refrescar\]\);/);
});

test('10. escribir una fecha NO recarga: eso es lo que hace BUSCAR', () => {
    const b = bloqueHook('const setFiltro = useCallback');
    assert.match(b, /setFiltros\(\(prev\)/);
    assert.doesNotMatch(b, /setAplicados/, 'editar un campo no aplica el filtro');
    assert.doesNotMatch(b, /setPage\(1\)/);
});

test('11. "Buscar" aplica los filtros y vuelve a la página 1', () => {
    const b = bloqueHook('const aplicarFiltros = useCallback');
    assert.match(b, /setFiltros\(base\)/, 'el formulario queda en lo aplicado');
    assert.match(b, /setAplicados\(base\)/, 'y es lo aplicado lo que va al backend');
    assert.match(b, /setPage\(1\)/, 'siempre vuelve a la primera página');
});

test('12. "Limpiar" vuelve a los valores por defecto y a la página 1', () => {
    const b = bloqueHook('const limpiarFiltros = useCallback');
    assert.match(b, /const base = \{ \.\.\.iniciales \};/);
    assert.match(b, /setFiltros\(base\)/);
    assert.match(b, /setAplicados\(base\)/);
    assert.match(b, /setPage\(1\)/);
    // El valor por defecto de un transaccional es HOY -> HOY, no vacío.
    assert.match(HOOK, /const iniciales = \{\s*\.\.\.filtrosIniciales,\s*\.\.\.\(transaccional \? \{ fechaDesde: hoy, fechaHasta: hoy \} : \{\}\)/);
});

test('13. el backend se consulta con los filtros aplicados, no con el borrador', () => {
    assert.match(HOOK, /const actuales = aplicadosRef\.current;/);
    assert.match(HOOK, /aplicadosRef = useRef\(aplicados\);/);
    assert.match(HOOK, /cargarRef\.current\(\{\s*page: pagina,\s*pageSize: tamanho,\s*\.\.\.actuales\s*\}\)/);
});

test('14. los botones están conectados a las dos acciones', () => {
    const seccion = VISTA.slice(VISTA.indexOf('function TabVentas'));
    assert.match(seccion, /onClick=\{\(\) => listado\.aplicarFiltros\(\)\}/);
    assert.match(seccion, /onClick=\{listado\.limpiarFiltros\}/);
    assert.match(seccion, />BUSCAR</);
    assert.match(seccion, />LIMPIAR</);
});

test('15. la paginación del listado usa las acciones del hook', () => {
    const seccion = VISTA.slice(VISTA.indexOf('function TabVentas'));
    assert.match(seccion, /onCambioPagina=\{listado\.irAPagina\}/);
    assert.match(seccion, /onCambioPageSize=\{listado\.cambiarPageSize\}/);
});

test('16. el listado entrega el comprobante anidado que consume la pantalla', () => {
    const bloque = bloqueListarVentas();
    assert.match(bloque, /facturacion:\s*row\.facturacion_id == null \? null : \{/);
    assert.match(bloque, /enlacePdf:\s*row\.enlace_pdf/);
    assert.match(bloque, /anulacionId:\s*row\.anulacion_id == null \? null : Number\(row\.anulacion_id\)/);
    assert.match(bloque, /estadoAnulacion:\s*row\.estado_anulacion/);
    assert.match(bloque, /LEFT JOIN LATERAL[\s\S]*?fg_documento_anulacion/);
});

test('17. Ventas de chips reutiliza las acciones reales de ver y anular comprobante', () => {
    const seccion = VISTA.slice(VISTA.indexOf('function TabVentas'));
    assert.match(seccion, /const verComprobante = async/);
    assert.match(seccion, /faregasChipsApi\.generarAnulacionOperacion/);
    assert.match(seccion, /faregasChipsApi\.consultarAnulacionOperacion/);
    assert.match(seccion, /title="Ver comprobante"/);
    assert.match(seccion, /title="Anular comprobante"/);
    assert.match(seccion, /venta\.facturacion\.anulacionEnPlazo === true/);
    assert.doesNotMatch(seccion, /anulacionHastaMs\) > Date\.now\(\)/,
        'el reloj del navegador no debe contradecir el plazo calculado por PostgreSQL');
    assert.match(API, /\/chips\/ventas\/\$\{operacionId\}\/facturacion\/anulaciones/);
});
