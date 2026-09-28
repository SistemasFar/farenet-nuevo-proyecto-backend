/**
 * Paginación y filtros de fecha estándar para los listados de FAREGAS.
 *
 * Reglas que este módulo centraliza para que ningún listado se comporta distinto:
 *
 *   - Máximo 10 registros por página por defecto (configurable, tope 100).
 *   - El TOTAL siempre viene de un COUNT con los MISMOS filtros que el listado,
 *     nunca de `items.length`.
 *   - Los listados transaccionales abren en HOY -> HOY. Un rango vacío significa
 *     "hoy", no "todo el histórico".
 *   - La fecha es la LOCAL de la aplicación. No se introduce UTC.
 *   - `hasta` cubre el día completo: `>= desde::date AND < (hasta::date + 1 day)`.
 *
 * Se exportan también las piezas puras para poder probarlas sin base de datos.
 */

const PAGE_SIZE_POR_DEFECTO = 10;
const PAGE_SIZE_MAXIMO = 100;

/** Entero acotado, tolerante a strings, NaN y null. */
const enteroAcotado = (valor, porDefecto, min, max) => {
    const n = Number(valor);
    if (!Number.isFinite(n)) return porDefecto;
    return Math.min(Math.max(Math.trunc(n), min), max);
};

/**
 * Normaliza `page` / `pageSize` a un objeto listo para el SQL.
 * `pageSize` se expone como `limit` porque es el nombre que ya usan los
 * servicios existentes (facturación admin, chips).
 */
exports.normalizarPaginacion = (query = {}, opciones = {}) => {
    const porDefecto = enteroAcotado(
        opciones.pageSizePorDefecto, PAGE_SIZE_POR_DEFECTO, 1, PAGE_SIZE_MAXIMO);
    const page = enteroAcotado(query.page ?? query.pagina, 1, 1, 1000000);
    const limit = enteroAcotado(
        query.pageSize ?? query.limite, porDefecto, 1, PAGE_SIZE_MAXIMO);
    return { page, limit, offset: (page - 1) * limit };
};

/** Envuelve un listado ya filtrado y ordenado en el sobre de paginación. */
exports.respuestaPaginada = (items, total, page, limit) => {
    const totalNumero = Number(total || 0);
    return {
        items,
        total: totalNumero,
        page: Number(page || 1),
        limit: Number(limit || PAGE_SIZE_POR_DEFECTO),
        totalPages: totalNumero === 0 ? 0 : Math.ceil(totalNumero / Number(limit || PAGE_SIZE_POR_DEFECTO))
    };
};

/** Fecha local en formato YYYY-MM-DD, sin pasar por UTC. */
exports.hoyLocal = (fecha = new Date()) => {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const esFechaValida = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(valor);

/**
 * Normaliza el rango de fechas de un listado transaccional.
 *
 * - Sin rango (o rangos incompletos) => HOY -> HOY. Nunca "todo el histórico".
 * - `desde > hasta` => error explícito. No se intercambian en silencio.
 * - Devuelve `{ fechaDesde, fechaHasta }` en YYYY-MM-DD.
 */
exports.normalizarRangoFechas = (query = {}, opciones = {}) => {
    const porDefecto = opciones.hoy || exports.hoyLocal();
    const crudoDesde = String(query.fechaDesde ?? query.desde ?? '').trim();
    const crudoHasta = String(query.fechaHasta ?? query.hasta ?? '').trim();

    // Rango incompleto: se completa con hoy en vez de devolver "todo".
    const fechaDesde = esFechaValida(crudoDesde) ? crudoDesde : porDefecto;
    const fechaHasta = esFechaValida(crudoHasta) ? crudoHasta : porDefecto;

    if (fechaDesde > fechaHasta) {
        const error = new Error('La fecha Desde no puede ser posterior a la fecha Hasta.');
        error.statusCode = 400;
        error.codigo = 'RANGO_FECHAS_INVALIDO';
        throw error;
    }
    return { fechaDesde, fechaHasta };
};

/**
 * Construye las condiciones SQL del rango sobre una columna timestamp.
 * `desde` es inclusivo; `hasta` cubre hasta las 23:59:59.999 del día.
 *
 * Devuelve el texto con marcadores numerados desde `indiceBase`, y muta
 * `params` con los valores ya en el orden correcto.
 */
exports.condicionesRangoFechas = (columna, fechaDesde, fechaHasta, params, indiceBase) => {
    let indice = indiceBase;
    const condiciones = [];
    if (fechaDesde) {
        params.push(fechaDesde);
        condiciones.push(`${columna} >= $${indice}::date`);
        indice += 1;
    }
    if (fechaHasta) {
        params.push(fechaHasta);
        // Forma robusta: incluye el día completo sin depender de la hora.
        condiciones.push(`${columna} < $${indice}::date + INTERVAL '1 day'`);
        indice += 1;
    }
    return { condiciones, siguienteIndice: indice };
};

exports._private = { enteroAcotado, esFechaValida, PAGE_SIZE_POR_DEFECTO, PAGE_SIZE_MAXIMO };
