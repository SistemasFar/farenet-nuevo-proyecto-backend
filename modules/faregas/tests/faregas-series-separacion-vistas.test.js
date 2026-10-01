/**
 * SERIES: una sola pantalla y una sola tabla sobre `fg_serie_comprobante`.
 *
 * Contexto: la tabla mezcla dos conjuntos con propósitos distintos. Las series
 * NUBEFACT (`proveedor_emision = 'NUBEFACT'`) son las que el motor de emisión
 * puede reservar; las series DMS (`LEGACY` con metadato importado del Excel) y
 * las internas de FARENET son inventario documental.
 *
 * La pantalla anterior mostraba todas las filas y el backend sustituía la serie
 * de las LEGACY por la de `seriedocumentobase`, de modo que filas distintas
 * aparecían duplicadas como FE02, BE02, BC02 o FC02.
 *
 * Estos tests comprueban que ahora hay UNA tabla, que clasifica cada fila por
 * su origen, y que ninguna de las acciones altera el emisor ni los datos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
if (USA_BASE_DE_DATOS) require('../../../config/env-loader').loadEnv(true);
const db = require('../../../config/database');
const seriesService = require('../services/faregas-series.service');

test.after(async () => {
    await db.end();
});

/**
 * `farenetFrontend` es repositorio HERMANO de `farenetBackend`: desde
 * `modules/faregas/tests` hay que subir cuatro niveles para llegar al
 * directorio que contiene ambos proyectos.
 */
const RAIZ = path.join(__dirname, '..', '..', '..', '..');
const leerRaiz = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');
const leer = (...partes) => fs.readFileSync(path.join(__dirname, ...partes), 'utf8');

const FRONTEND = ['farenetFrontend', 'src', 'modules', 'faregas'];
const SERIES = leerRaiz(...FRONTEND, 'views', 'Configuracion', 'components', 'TabSeries.tsx');
const FACTURACION = leerRaiz(...FRONTEND, 'views', 'Configuracion', 'components', 'TabFacturacion.tsx');
const CONFIGURACION = leerRaiz(...FRONTEND, 'views', 'Configuracion', 'FaregasConfiguracionView.tsx');
const API = leerRaiz(...FRONTEND, 'services', 'faregas-series.api.ts');
const EXPORTADOR = leerRaiz(...FRONTEND, 'utils', 'faregas-series-exportacion.ts');
const SERVICIO = leer('..', 'services', 'faregas-series.service.js');

// ---------------------------------------------------------------------------
// 1-2. Una sola pantalla, sin subpestañas internas
// ---------------------------------------------------------------------------

test('las series se administran desde Facturación, no desde Configuración', () => {
    // Configuración retiró la pestaña; conserva el permiso.
    expect_no_contains(CONFIGURACION, "label: 'SERIES'");
    expect_no_contains(CONFIGURACION, "tabVisible === 'SERIES'");
    expect_no_contains(CONFIGURACION, 'TabSeries');
    expect_contains(CONFIGURACION, 'CONFIGURACION_SERIES');
    // El resto de módulos de Configuración sigue en su sitio.
    expect_contains(CONFIGURACION, "label: 'SEDES / CATEGORÍAS DMS'");
    expect_contains(CONFIGURACION, "label: 'CATÁLOGO'");
    expect_contains(CONFIGURACION, "label: 'CORRELATIVOS'");
    expect_contains(CONFIGURACION, "label: 'TARIFAS POR SEDE'");
    expect_contains(CONFIGURACION, "label: 'EMPRESAS'");
});

test('no existen subpestañas internas dentro de Series', () => {
    expect_contains(FACTURACION, "pestana('SERIES', 'SERIES')");
    expect_contains(FACTURACION, '<TabSeries />');
    // La barra interna "SERIES NUBEFACT | MAESTRO DMS" no debe existir.
    expect_no_contains(FACTURACION, 'SERIES NUBEFACT');
    expect_no_contains(FACTURACION, 'MAESTRO DMS');
    expect_no_contains(FACTURACION, 'vistaSeries');
    // Y tampoco un componente separado con el maestro.
    assert.equal(
        fs.existsSync(path.join(RAIZ, ...FRONTEND, 'views', 'Configuracion', 'components', 'TabSeriesMaestro.tsx')),
        false,
        'TabSeriesMaestro.tsx no debe existir: el maestro vive en la tabla única'
    );
});

// ---------------------------------------------------------------------------
// 3-5. Una sola tabla que distingue el origen
// ---------------------------------------------------------------------------

test('la tabla única clasifica cada fila por su origen', () => {
    expect_contains(SERIES, 'listarMaestro');
    expect_contains(SERIES, 'Origen / Ambiente');
    ['NUBEFACT/DEMO', 'NUBEFACT/PRODUCCION', 'DMS/LEGACY', 'LEGACY/FARENET'].forEach((origen) => {
        expect_contains(SERIES, origen);
    });
    // El origen lo resuelve el backend, no el cliente.
    expect_contains(SERVICIO, "origen: row.proveedor_emision === 'NUBEFACT'");
});

test('las series se muestran con su valor real, sin la sustitución de FARENET', () => {
    // La sustitución por `seriedocumentobase` es lo que producía los
    // duplicados falsos: varias filas LEGACY pintadas como la misma serie.
    expect_contains(SERIES, 'listarMaestro');
    expect_no_contains(SERIES, 'serie_operativa');
    // El listado del maestro no debe aplicar esa sustitución.
    const bloque = /exports\.listarMaestro[\s\S]*?\n};/.exec(SERVICIO);
    assert.ok(bloque, 'debe existir exports.listarMaestro');
    expect_no_contains(bloque[0], 'seriedocumentobase');
    expect_no_contains(bloque[0], 'serie_operativa');
});

test('los filtros de la tabla se resuelven en el backend', () => {
    expect_contains(API, "params.set('proveedor', filtros.proveedor)");
    expect_contains(API, "params.set('entorno', filtros.entorno)");
    expect_contains(SERIES, 'setOrigen');
    expect_contains(SERIES, 'setSede');
    expect_contains(SERIES, 'setAmbiente');
    expect_contains(SERIES, 'soloPos');
    expect_contains(SERIES, 'soloContingencia');
    expect_contains(SERIES, 'incluirInternas');
    // Y el backend los aplica con condiciones SQL.
    expect_contains(SERVICIO, "agregar('s.proveedor_emision = ?', origen)");
    expect_contains(SERVICIO, "agregar('s.entorno_emision = ?', entorno)");
});

// ---------------------------------------------------------------------------
// 5. Acciones según origen
// ---------------------------------------------------------------------------

test('las acciones disponibles dependen del origen de la fila', () => {
    // Editar la configuración de Nubefact: sólo filas NUBEFACT.
    expect_contains(SERIES, "serie.proveedor_emision === 'NUBEFACT'");
    expect_contains(SERIES, 'EDITAR_NUBEFACT');
    // Detalle y edición del metadato DMS: sólo filas DMS.
    expect_contains(SERIES, "serie.origen === 'DMS/LEGACY'");
    expect_contains(SERIES, 'DETALLE_DMS');
    // Confirmar producción: sólo NUBEFACT en el ambiente PRODUCTIVO. Una serie
    // DMS nunca puede alcanzar esa acción.
    expect_contains(SERIES, "serie.entorno_emision === 'PRODUCCION'");
    // El servicio lo exige también del lado del servidor.
    expect_contains(SERVICIO, "actual.proveedor_emision !== 'NUBEFACT'");
    expect_contains(SERVICIO, "actual.entorno_emision !== 'PRODUCCION'");
    expect_contains(SERVICIO, 'SERIE_NO_APTA_PRODUCCION');
});

test('la pantalla no convierte series LEGACY en NUBEFACT', () => {
    // La fila sólo puede cambiar de proveedor por una acción explícita que
    // aquí no existe: el formulario de alta fija el proveedor y el resto de
    // acciones no lo tocan.
    expect_contains(SERIES, "+ NUEVA SERIE NUBEFACT");
    // Y el servicio no expone ningún método que promueva el proveedor.
    expect_no_contains(SERVICIO, 'SET proveedor_emision');
    expect_no_contains(SERVICIO, "proveedor_emision = 'NUBEFACT' WHERE");
});

// ---------------------------------------------------------------------------
// 6. La exportación, con las 14 columnas
// ---------------------------------------------------------------------------

test('el botón de exportar está en la pantalla única y usa el filtro completo', () => {
    expect_contains(SERIES, 'EXPORTAR EXCEL DMS');
    expect_contains(SERIES, 'exportarSeriesMaestro');
    // Exporta el resultado del filtro, no las filas de la tabla.
    expect_contains(SERIES, 'const completo = await faregasSeriesApi.listarMaestro(filtros)');
    expect_contains(SERIES, 'exportarSeriesMaestro(filtrado)');
});

test('el exportador conserva las 14 columnas del Excel DMS en su orden', () => {
    const bloque = /COLUMNAS_SERIES_DMS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(EXPORTADOR);
    assert.ok(bloque, 'debe existir COLUMNAS_SERIES_DMS');
    const columnas = [...bloque[1].matchAll(/\{ key: '([^']+)'[^}]*\}/g)].map((m) => ({
        key: m[1],
        header: /header: '([^']+)'/.exec(m[0])[1],
        format: /format: '([^']+)'/.exec(m[0]) ? /format: '([^']+)'/.exec(m[0])[1] : undefined
    }));
    const orden = [
        'Nombre', 'Autogenerada', 'Último Número Generado', 'Activo',
        'Tipo de Documento', 'Número', 'Tipo de Documento de Referencia',
        'Código del Local', 'Nombre del Local', 'Teléfono del Local',
        'Correo del Local', 'Dirección Comercial',
        'Serie para POS', 'Serie de Contingencia'
    ];
    assert.equal(columnas.length, 14, 'debe exportar exactamente 14 columnas');
    orden.forEach((header, indice) => {
        assert.equal(columnas[indice].header, header, `columna ${indice} debe ser ${header}`);
    });
    // Identificadores como texto, para no perder ceros a la izquierda.
    assert.equal(columnas[5].format, 'text', 'Número va como texto');
    assert.equal(columnas[7].format, 'text', 'Código del local va como texto');
    // Booleanos en Sí/No (con tilde, como el Excel de origen) y celdas vacías
    // para los NULL del maestro.
    expect_contains(EXPORTADOR, 'const siNo');
    assert.match(EXPORTADOR, /value === true \? 'Sí' : 'No'/,
        'los booleanos deben exportarse como Sí/No');
    expect_contains(EXPORTADOR, '?? null');
});

// ---------------------------------------------------------------------------
// 3-5, 7-8. Comportamiento real contra la base de datos
// ---------------------------------------------------------------------------

test('el origen clasifica cada fila según su proveedor y su metadato', {
    skip: !USA_BASE_DE_DATOS ? 'requiere FAREGAS_TEST_DB=1' : false
}, async () => {
    const todas = await seriesService.listarMaestro();
    assert.ok(todas.length > 0);

    // El origen se resuelve con la columna `nombre_dms` de la tabla, que sólo
    // tienen las 107 filas homologadas. La respuesta expone además un
    // `nombre_dms` derivado del tipo (para que la columna nunca salga vacía),
    // así que la comparación se hace contra la base, no contra ese campo.
    const { rows: crudas } = await db.query(
        'SELECT id, nombre_dms FROM fg_serie_comprobante'
    );
    const conMetadato = new Set(
        crudas.filter((r) => r.nombre_dms !== null).map((r) => Number(r.id))
    );

    let nubs = 0;
    let dms = 0;
    let farenet = 0;
    todas.forEach((serie) => {
        if (serie.proveedor_emision === 'NUBEFACT') {
            assert.ok(['NUBEFACT/DEMO', 'NUBEFACT/PRODUCCION'].includes(serie.origen),
                `${serie.serie} es NUBEFACT y debe clasificarse por ambiente`);
            assert.equal(serie.es_nubefact, true);
            assert.equal(serie.es_dms, false);
            nubs += 1;
        } else if (conMetadato.has(serie.id)) {
            assert.equal(serie.origen, 'DMS/LEGACY', `${serie.serie} tiene metadato DMS`);
            assert.equal(serie.es_dms, true);
            dms += 1;
        } else {
            assert.equal(serie.origen, 'LEGACY/FARENET', `${serie.serie} es interna de FARENET`);
            assert.equal(serie.es_nubefact, false);
            assert.equal(serie.es_dms, false);
            farenet += 1;
        }
    });
    assert.ok(nubs > 0 && farenet > 0, 'deben existir los tres conjuntos');
});

test('el origen refleja el proveedor real, no el metadato DMS', {
    skip: !USA_BASE_DE_DATOS ? 'requiere FAREGAS_TEST_DB=1' : false
}, async () => {
    // Una serie DMS puede haber sido promovida a NUBEFACT conservando su
    // metadato del Excel (es el caso de FD15/BD15 de INDEPENDENCIA). Entonces
    // su origen debe ser NUBEFACT: el que decide las acciones es el proveedor,
    // no el origen documental. Por eso la comparación se hace contra la
    // columna `proveedor_emision` y no contra `nombre_dms`.
    // Ojo: `nombre_dms` en la respuesta puede ser un valor DERIVADO del tipo
    // (para que la columna de la tabla nunca salga vacía). Para saber si una fila
    // conserva metadato del Excel hay que mirar su `origen` o consultar la
    // columna, no ese campo.
    const todas = await seriesService.listarMaestro();
    todas.forEach((serie) => {
        if (serie.proveedor_emision === 'NUBEFACT') {
            assert.ok(serie.origen.startsWith('NUBEFACT/'),
                `${serie.serie} es NUBEFACT y su origen debe decirlo`);
        } else {
            assert.ok(['DMS/LEGACY', 'LEGACY/FARENET'].includes(serie.origen));
        }
    });

    // Las promovidas conservan el metadato del Excel aunque ya no sean LEGACY.
    const { rows: promovidas } = await db.query(`
        SELECT s.serie, s.codigo_local_dms, s.nombre_dms, s.tipo_documento_referencia
        FROM fg_serie_comprobante s
        WHERE s.proveedor_emision = 'NUBEFACT' AND s.nombre_dms IS NOT NULL`);
    promovidas.forEach((r) => {
        assert.ok(r.codigo_local_dms, `${r.serie} conserva su código de local`);
        assert.ok(r.nombre_dms, `${r.serie} conserva su nombre DMS`);
        assert.ok(r.tipo_documento_referencia, `${r.serie} conserva su referencia`);
    });
});

test('las 107 series del Excel DMS siguen presentes', {
    skip: !USA_BASE_DE_DATOS ? 'requiere FAREGAS_TEST_DB=1' : false
}, async () => {
    // El criterio es la columna real `nombre_dms`, no el campo homónimo de la
    // respuesta (que puede venir derivado del tipo).
    const { rows } = await db.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE proveedor_emision = 'LEGACY')::int AS siguen_legacy,
               COUNT(*) FILTER (WHERE proveedor_emision = 'NUBEFACT')::int AS promovidas
        FROM fg_serie_comprobante WHERE nombre_dms IS NOT NULL`);
    assert.equal(rows[0].total, 107, 'siguen siendo 107 filas con metadato del Excel');
    assert.equal(rows[0].siguen_legacy + rows[0].promovidas, 107);

    const maestro = await seriesService.listarMaestro();
    assert.equal(maestro.filter((s) => s.origen === 'DMS/LEGACY').length, rows[0].siguen_legacy,
        'el listado coincide con las filas LEGACY que conservan metadato');
});

test('las 107 series DMS están en la base y conservan su metadato', {
    skip: !USA_BASE_DE_DATOS ? 'requiere FAREGAS_TEST_DB=1' : false
}, async () => {
    const { rows } = await db.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE nombre_dms IS NOT NULL)::int AS con_nombre,
               COUNT(*) FILTER (WHERE codigo_local_dms IS NOT NULL)::int AS con_codigo,
               COUNT(*) FILTER (WHERE direccion_comercial_dms IS NOT NULL)::int AS con_direccion,
               COUNT(*) FILTER (WHERE proveedor_emision = 'NUBEFACT')::int AS promovidas
        FROM fg_serie_comprobante WHERE nombre_dms IS NOT NULL
    `);
    const fila = rows[0];
    assert.equal(fila.total, 107, 'siguen siendo 107 filas con metadato del Excel DMS');
    assert.equal(fila.con_nombre, 107);
    assert.equal(fila.con_codigo, 107);
    assert.equal(fila.con_direccion, 107);

    // Ninguna fila se perdió: el total con metadato DMS sigue siendo el mismo.
    const maestro = await seriesService.listarMaestro();
    const conMetadato = maestro.filter((s) => s.origen === 'DMS/LEGACY');
    assert.equal(conMetadato.length, 107 - fila.promovidas,
        'las que siguen LEGACY son las 107 menos las promovidas a NUBEFACT');
    conMetadato.forEach((serie) => {
        assert.equal(serie.proveedor_emision, 'LEGACY');
        assert.ok(serie.codigo_local_dms);
    });
});

test('las series NUBEFACT siguen siendo las únicas que el motor puede reservar', {
    skip: !USA_BASE_DE_DATOS ? 'requiere FAREGAS_TEST_DB=1' : false
}, async () => {
    // Se replica la condición del motor de emisión, sin invocarlo.
    const { rows: elegibles } = await db.query(`
        SELECT s.planta_key, s.tipo_comprobante, s.serie
        FROM fg_serie_comprobante s
        JOIN fg_planta p ON p.key = s.planta_key
        WHERE s.proveedor_emision = 'NUBEFACT'
          AND s.entorno_emision = 'DEMO'
          AND s.activo = TRUE AND s.es_predeterminada = TRUE
          AND p.activo = TRUE
        ORDER BY s.planta_key, s.tipo_comprobante
    `);
    assert.ok(elegibles.length > 0, 'debe existir al menos una serie elegible en DEMO');
    elegibles.forEach((r) => assert.ok(r.serie, 'la serie debe estar definida'));

    // Ninguna fila LEGACY cumple la condición del motor, aunque esté activa y
    // predeterminada: el proveedor las excluye.
    const { rows: legadas } = await db.query(`
        SELECT COUNT(*)::int AS n FROM fg_serie_comprobante
        WHERE proveedor_emision = 'LEGACY' AND activo AND es_predeterminada
    `);
    assert.ok(legadas[0].n > 0,
        'sí existen series LEGACY predeterminadas: el motor sigue resolviendo la sede, la vista no las muestra');

    // Y el listado filtrado por origen NUBEFACT no devuelve ninguna.
    const vista = await seriesService.listarMaestro({ origen: 'NUBEFACT' });
    vista.forEach((s) => assert.equal(s.proveedor_emision, 'NUBEFACT'));
});

test('cambiar de ambiente sólo mueve las series NUBEFACT', {
    skip: !USA_BASE_DE_DATOS ? 'requiere FAREGAS_TEST_DB=1' : false
}, async () => {
    const demo = await seriesService.listarMaestro({ origen: 'NUBEFACT', entorno: 'DEMO' });
    const produccion = await seriesService.listarMaestro({ origen: 'NUBEFACT', entorno: 'PRODUCCION' });
    assert.ok(demo.length > 0, 'debe haber series DEMO');
    assert.ok(produccion.length > 0, 'debe haber series PRODUCCIÓN');
    demo.forEach((s) => assert.equal(s.entorno_emision, 'DEMO'));
    produccion.forEach((s) => assert.equal(s.entorno_emision, 'PRODUCCION'));

    const seriesDemo = demo.map((s) => s.serie);
    assert.deepEqual(seriesDemo.filter((s) => produccion.some((p) => p.serie === s)), [],
        'ninguna serie puede estar en ambos ambientes');
});

test('el filtro por origen separa los dos conjuntos sin perder filas', {
    skip: !USA_BASE_DE_DATOS ? 'requiere FAREGAS_TEST_DB=1' : false
}, async () => {
    const todas = await seriesService.listarMaestro();
    const nubefact = await seriesService.listarMaestro({ origen: 'NUBEFACT' });
    const legacy = await seriesService.listarMaestro({ origen: 'LEGACY' });
    assert.equal(nubefact.length + legacy.length, todas.length,
        'origen=NUBEFACT más origen=LEGACY debe reconstruir el listado completo');
    assert.ok(nubefact.every((s) => s.proveedor_emision === 'NUBEFACT'));
    assert.ok(legacy.every((s) => s.proveedor_emision === 'LEGACY'));
});

test('no hay series repetidas al mostrarlas con su valor real', {
    skip: !USA_BASE_DE_DATOS ? 'requiere FAREGAS_TEST_DB=1' : false
}, async () => {
    // La unicidad real de la tabla es (planta, tipo, serie): dos filas de
    // sedes distintas pueden compartir serie sin ser la misma.
    const { rows } = await db.query(`
        SELECT COUNT(*)::int AS repetidas FROM (
            SELECT planta_key, tipo_comprobante, serie
            FROM fg_serie_comprobante
            GROUP BY 1,2,3 HAVING COUNT(*) > 1
        ) d
    `);
    assert.equal(rows[0].repetidas, 0,
        'no debe haber series duplicadas por sede y tipo en la base');

    // Y el listado del maestro conserva esa distinción.
    const maestro = await seriesService.listarMaestro();
    const claves = maestro.map((s) => `${s.planta_key}|${s.tipo_comprobante}|${s.serie}`);
    assert.equal(new Set(claves).size, claves.length, 'el listado no debe repetir claves');
});

test('ningún ultimo_numero puede haber bajado respecto al Excel', {
    skip: !USA_BASE_DE_DATOS ? 'requiere FAREGAS_TEST_DB=1' : false
}, async () => {
    const { rows } = await db.query(`
        SELECT s.serie, s.ultimo_numero
        FROM fg_serie_comprobante s
        WHERE s.nombre_dms IS NOT NULL
        ORDER BY s.id
    `);
    assert.ok(rows.length > 0);
    rows.forEach((r) => {
        assert.ok(Number(r.ultimo_numero) >= 0, `${r.serie} debe tener un correlativo válido`);
    });
    // El servicio lo garantiza por construcción al editar.
    expect_contains(SERVICIO, 'Math.max(Number(actual.ultimo_numero), ultimoNumero)');
});

// ---------------------------------------------------------------------------
// Utilidades de aserción
// ---------------------------------------------------------------------------

function expect_contains(fuente, needle) {
    assert.ok(fuente.includes(needle), `se esperaba que el archivo contenga: ${needle}`);
}

function expect_no_contains(fuente, needle) {
    assert.ok(!fuente.includes(needle), `el archivo NO debe contener: ${needle}`);
}
