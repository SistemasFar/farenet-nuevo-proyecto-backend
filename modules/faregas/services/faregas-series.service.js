const db = require('../../../config/database');
const configService = require('./faregas-config.service');

const COLUMNAS_NUBEFACT = [
    'empresa_key', 'proveedor_emision', 'entorno_emision',
    'confirmada_produccion', 'numero_inicial_confirmado', 'fecha_corte'
];

const migracionNubefactAplicada = async (executor = db) => {
    const result = await executor.query(`
        SELECT COUNT(*)::int AS columnas
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fg_serie_comprobante'
          AND column_name = ANY($1::text[])
    `, [COLUMNAS_NUBEFACT]);
    return Number(result.rows[0]?.columnas || 0) === COLUMNAS_NUBEFACT.length;
};

exports.migracionNubefactAplicada = migracionNubefactAplicada;

const normalizarFila = (row) => ({
    ...row,
    serie: row.serie_operativa || row.serie,
    id: Number(row.id),
    ultimo_numero: Number(row.ultimo_numero_operativo ?? row.ultimo_numero)
});

exports.listarSedes = async () => {
    const result = await db.query(`
        SELECT p.key, p.nombre, p.direccion, p.activo,
               COUNT(s.id) FILTER (WHERE s.activo) AS series_activas,
               -- Contadores por ambiente para la vista de series NUBEFACT. Antes
               -- la pantalla mostraba series_activas (todas las filas) como si
               -- fueran las series visibles, y el número no correspondía a lo
               -- que la tabla listaba.
               COUNT(s.id) FILTER (WHERE s.activo AND s.proveedor_emision = 'NUBEFACT'
                    AND s.entorno_emision = 'DEMO') AS nubefact_demo,
               COUNT(s.id) FILTER (WHERE s.activo AND s.proveedor_emision = 'NUBEFACT'
                    AND s.entorno_emision = 'PRODUCCION') AS nubefact_produccion
        FROM fg_planta p
        LEFT JOIN fg_serie_comprobante s ON s.planta_key = p.key
        GROUP BY p.key, p.nombre, p.direccion, p.activo
        ORDER BY p.activo DESC, p.nombre
    `);
    return result.rows.map((row) => ({
        ...row,
        series_activas: Number(row.series_activas),
        nubefact_demo: Number(row.nubefact_demo),
        nubefact_produccion: Number(row.nubefact_produccion)
    }));
};

/**
 * Listado de series operativas de una sede.
 *
 * `proveedor` y `entorno` se filtran EN SQL, no en el cliente: la vista de
 * series Nubefact sólo debe recibir filas `NUBEFACT` del ambiente elegido. Es
 * además lo que elimina los duplicados visuales (BE02, FE02, ... repetidos),
 * que eran filas LEGACY distintas a las que el backend sustituía por la serie
 * de `seriedocumentobase`.
 *
 * No cambia ningún consumidor de emisión: el motor Nubefact resuelve su propia
 * consulta en `faregas-correlativos-nubefact.service.js`.
 */
exports.listar = async ({ plantaKey, tipo, activo, buscar, proveedor, entorno } = {}) => {
    const valores = [plantaKey];
    const condiciones = ['s.planta_key = $1'];
    if (tipo) { valores.push(tipo); condiciones.push(`s.tipo_comprobante = $${valores.length}`); }
    if (activo === true || activo === false) { valores.push(activo); condiciones.push(`s.activo = $${valores.length}`); }
    if (buscar) { valores.push(`%${buscar}%`); condiciones.push(`s.serie ILIKE $${valores.length}`); }
    if (proveedor) { valores.push(proveedor); condiciones.push(`s.proveedor_emision = $${valores.length}`); }
    if (entorno) { valores.push(entorno); condiciones.push(`s.entorno_emision = $${valores.length}`); }
    const migracionAplicada = await migracionNubefactAplicada(db);
    const serieOperativa = migracionAplicada
        ? "CASE WHEN s.proveedor_emision = 'LEGACY' THEN "
            + "CASE s.tipo_comprobante WHEN 'FACTURA' THEN base.seriefactura WHEN 'BOLETA' THEN base.serieboleta "
            + "WHEN 'NOTA_CREDITO_FACTURA' THEN base.serienotacreditofactura WHEN 'NOTA_CREDITO_BOLETA' THEN base.serienotacreditoboleta ELSE s.serie END ELSE s.serie END"
        : "CASE s.tipo_comprobante WHEN 'FACTURA' THEN base.seriefactura WHEN 'BOLETA' THEN base.serieboleta "
            + "WHEN 'NOTA_CREDITO_FACTURA' THEN base.serienotacreditofactura WHEN 'NOTA_CREDITO_BOLETA' THEN base.serienotacreditoboleta ELSE s.serie END";
    const numeroOperativo = migracionAplicada
        ? "CASE WHEN s.proveedor_emision = 'LEGACY' THEN "
            + "CASE s.tipo_comprobante WHEN 'FACTURA' THEN base.nroactualfactura WHEN 'BOLETA' THEN base.nroactualboleta "
            + "WHEN 'NOTA_CREDITO_FACTURA' THEN base.nroactualnotacreditofactura WHEN 'NOTA_CREDITO_BOLETA' THEN base.nroactualnotacreditoboleta ELSE s.ultimo_numero END ELSE s.ultimo_numero END"
        : "CASE s.tipo_comprobante WHEN 'FACTURA' THEN base.nroactualfactura WHEN 'BOLETA' THEN base.nroactualboleta "
            + "WHEN 'NOTA_CREDITO_FACTURA' THEN base.nroactualnotacreditofactura WHEN 'NOTA_CREDITO_BOLETA' THEN base.nroactualnotacreditoboleta ELSE s.ultimo_numero END";
    const fuente = migracionAplicada
        ? "CASE WHEN s.proveedor_emision = 'NUBEFACT' THEN 'NUBEFACT_EXCLUSIVA' "
            + "WHEN s.tipo_comprobante IN ('FACTURA','BOLETA','NOTA_CREDITO_FACTURA','NOTA_CREDITO_BOLETA') THEN 'COMPARTIDO_FARENET' ELSE 'FAREGAS' END"
        : "CASE WHEN s.tipo_comprobante IN ('FACTURA','BOLETA','NOTA_CREDITO_FACTURA','NOTA_CREDITO_BOLETA') THEN 'COMPARTIDO_FARENET' ELSE 'FAREGAS' END";
    const result = await db.query(`
        SELECT s.*, p.nombre AS sede_nombre,
               ${serieOperativa} AS serie_operativa,
               ${numeroOperativo} AS ultimo_numero_operativo,
               ${fuente} AS fuente_correlativo,
               ${migracionAplicada ? 'TRUE' : 'FALSE'} AS migracion_nubefact_aplicada
        FROM fg_serie_comprobante s
        JOIN fg_planta p ON p.key = s.planta_key
        LEFT JOIN LATERAL (
            SELECT b.* FROM seriedocumentobase b
            WHERE b.planta_key = s.planta_key AND COALESCE(b.estado, TRUE) = TRUE
            ORDER BY b.id DESC LIMIT 1
        ) base ON TRUE
        WHERE ${condiciones.join(' AND ')}
        ORDER BY s.tipo_comprobante, s.es_predeterminada DESC, s.serie
    `, valores);
    return result.rows.map(normalizarFila);
};

exports.resolverSerieFaregas = async (plantaKey, tipoComprobante, executor = db) => {
    const result = await executor.query(`
        SELECT s.*, p.nombre AS sede_nombre
        FROM fg_serie_comprobante s
        JOIN fg_planta p ON p.key = s.planta_key
        WHERE s.planta_key = $1 AND s.tipo_comprobante = $2
          AND s.activo = TRUE AND s.es_predeterminada = TRUE
          AND p.activo = TRUE
        LIMIT 1
    `, [plantaKey, tipoComprobante]);
    if (result.rowCount === 0) throw new Error('SERIE_NO_CONFIGURADA');
    return normalizarFila(result.rows[0]);
};

exports.reservarSiguienteNumeroSerie = async (plantaKey, tipoComprobante, executor = db) => {
    const result = await executor.query(`
        UPDATE fg_serie_comprobante s
        SET ultimo_numero = s.ultimo_numero + 1,
            fecha_modificacion = CURRENT_TIMESTAMP
        FROM fg_planta p
        WHERE s.planta_key = $1 AND s.tipo_comprobante = $2
          AND s.activo = TRUE AND s.es_predeterminada = TRUE
          AND s.autogenerada = TRUE
          AND p.key = s.planta_key AND p.activo = TRUE
        RETURNING s.id, s.planta_key, s.tipo_comprobante, s.serie,
                  s.ultimo_numero, s.es_predeterminada, s.autogenerada,
                  s.contingencia, s.activo
    `, [plantaKey, tipoComprobante]);
    if (result.rowCount === 0) {
        const serie = await executor.query(`
            SELECT autogenerada FROM fg_serie_comprobante
            WHERE planta_key = $1 AND tipo_comprobante = $2
              AND activo = TRUE AND es_predeterminada = TRUE
        `, [plantaKey, tipoComprobante]);
        throw new Error(serie.rowCount > 0 && !serie.rows[0].autogenerada
            ? 'SERIE_NO_AUTOGENERADA'
            : 'SERIE_NO_CONFIGURADA');
    }
    return normalizarFila(result.rows[0]);
};

/**
 * Metadato del maestro DMS de series. Son columnas de origen, nullable: una
 * serie histórica que no venga del Excel simplemente las tiene en NULL.
 * `serie` conserva el código del Excel (p. ej. "NCF"), que no es lo mismo que
 * `serie.serie` (la serie de comprobante, p. ej. "FC12").
 */
const COLUMNAS_METADATO_DMS = [
    'nombre_dms', 'codigo_local_dms', 'nombre_local_dms',
    'telefono_local_dms', 'correo_local_dms', 'direccion_comercial_dms'
];

/** Normaliza un valor de metadato DMS: texto sintrimear o NULL (nunca ''). */
const metadatoDms = (value) => {
    if (value === undefined || value === null) return null;
    const texto = String(value).trim();
    return texto === '' ? null : texto;
};

/** Extrae del objeto de entrada sólo las claves DMS definidas, como NULL o texto. */
const metadatoDmsDe = (origen = {}) => COLUMNAS_METADATO_DMS.reduce((acc, columna) => {
    if (Object.prototype.hasOwnProperty.call(origen, columna)) {
        acc[columna] = metadatoDms(origen[columna]);
    }
    return acc;
}, {});

const numeroDmsDesdeSerie = (row) => {
    const serie = String(row.serie || '').trim().toUpperCase();
    const reglas = {
        FACTURA: [/^F0([0-9]{2})$/, 'E'],
        BOLETA: [/^B0([0-9]{2})$/, 'E'],
        NOTA_CREDITO_FACTURA: [/^FC([0-9]{2})$/, 'C'],
        NOTA_CREDITO_BOLETA: [/^BC([0-9]{2})$/, 'C'],
        NOTA_DEBITO_FACTURA: [/^FD([0-9]{2})$/, 'D'],
        NOTA_DEBITO_BOLETA: [/^BD([0-9]{2})$/, 'D']
    };
    const regla = reglas[row.tipo_comprobante];
    if (!regla) return serie;
    const coincidencia = serie.match(regla[0]);
    return coincidencia ? `${regla[1]}${coincidencia[1]}` : serie;
};

/**
 * Alta de serie en el maestro `fg_serie_comprobante`.
 *
 * `proveedor_emision` y `entorno_emision` son opcionales y su valor por
 * defecto conserva el comportamiento anterior ('NUBEFACT'): las series que
 * trae el maestro DMS se registran como 'LEGACY'/'PRODUCCION' porque NO son
 * series de Nubefact, y así no alteran qué series puede elegir el motor de
 * emisión ni la serie predeterminada que resuelve la facturación.
 */
exports.crear = async (serie, username, ipDireccion) => {
    const proveedorEmision = serie.proveedor_emision || 'NUBEFACT';
    const entornoEmision = serie.entorno_emision || 'PRODUCCION';
    const metadato = metadatoDmsDe(serie);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        if (!await migracionNubefactAplicada(client)) throw new Error('MIGRACION_NUBEFACT_PENDIENTE');
        const planta = await client.query('SELECT key, nombre FROM fg_planta WHERE key = $1', [serie.planta_key]);
        if (planta.rowCount === 0) throw new Error('SEDE_NO_ENCONTRADA');
        const result = await client.query(`
            INSERT INTO fg_serie_comprobante (
                planta_key, empresa_key, tipo_comprobante, serie, ultimo_numero,
                es_predeterminada, autogenerada, contingencia, activo,
                proveedor_emision, entorno_emision,
                tipo_documento_referencia, serie_pos,
                nombre_dms, codigo_local_dms, nombre_local_dms,
                telefono_local_dms, correo_local_dms, direccion_comercial_dms
            ) VALUES ($1,(SELECT empresa_key FROM fg_planta WHERE key = $1),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            RETURNING id
        `, [
            serie.planta_key, serie.tipo_comprobante, serie.serie, serie.ultimo_numero,
            serie.es_predeterminada, serie.autogenerada, serie.contingencia, serie.activo,
            proveedorEmision, entornoEmision,
            serie.tipo_documento_referencia, serie.serie_pos,
            metadato.nombre_dms, metadato.codigo_local_dms, metadato.nombre_local_dms,
            metadato.telefono_local_dms, metadato.correo_local_dms, metadato.direccion_comercial_dms
        ]);
        const despues = {
            ...serie, proveedor_emision: proveedorEmision, entorno_emision: entornoEmision,
            sede_nombre: planta.rows[0].nombre, ...metadato
        };
        await configService.registrarAuditoria(client, {
            username, entidad: 'SERIE_COMPROBANTE', accion: 'CREAR_SERIE',
            identificador: `${serie.planta_key}:${serie.tipo_comprobante}:${serie.serie}`,
            detalles: { despues }, planta_key: serie.planta_key, ip_direccion: ipDireccion
        });
        if (serie.es_predeterminada) {
            await configService.registrarAuditoria(client, {
                username, entidad: 'SERIE_COMPROBANTE', accion: 'CAMBIAR_SERIE_PREDETERMINADA',
                identificador: `${serie.planta_key}:${serie.tipo_comprobante}`,
                detalles: { antes: null, despues: { serie: serie.serie } },
                planta_key: serie.planta_key, ip_direccion: ipDireccion
            });
        }
        await client.query('COMMIT');
        return Number(result.rows[0].id);
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505' && error.constraint === 'uk_fg_serie_comprobante_predeterminada_activa') {
            throw new Error('SERIE_PREDETERMINADA_DUPLICADA');
        }
        if (error.code === '23505' && error.constraint === 'uq_fg_serie_nubefact_empresa_documento') {
            throw new Error('SERIE_NUBEFACT_EMPRESA_DUPLICADA');
        }
        if (error.code === '23505') throw new Error('SERIE_DUPLICADA');
        throw error;
    } finally { client.release(); }
};

/**
 * Actualiza una serie existente.
 *
 * Además de los campos que ya manejaba, acepta el metadato DMS y
 * `ultimo_numero` con la regla de NO retroceder numeración:
 *
 *     nuevo_ultimo_numero = MAX(actual, recibido)
 *
 * Un valor recibido menor se conserva el actual. Una propiedad ausente no
 * cambia el valor almacenado; una propiedad presente con `null` sí permite
 * representar una celda vacía del maestro DMS.
 */
exports.editar = async (id, cambios, username, ipDireccion) => {
    const metadato = metadatoDmsDe(cambios);
    const ultimoNumero = cambios.ultimo_numero === undefined || cambios.ultimo_numero === null
        ? null
        : Number(cambios.ultimo_numero);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actualResult = await client.query('SELECT * FROM fg_serie_comprobante WHERE id = $1 FOR UPDATE', [id]);
        if (actualResult.rowCount === 0) throw new Error('SERIE_NO_ENCONTRADA');
        const actual = actualResult.rows[0];
        const valor = (nombre) => cambios[nombre] === undefined ? actual[nombre] : cambios[nombre];
        const tipoDocumentoReferencia = cambios.tipo_documento_referencia !== undefined
            ? metadatoDms(cambios.tipo_documento_referencia)
            : (actual.tipo_comprobante.endsWith('_FACTURA')
                ? '01'
                : actual.tipo_comprobante.endsWith('_BOLETA') ? '03' : null);
        // Se resuelve en JS para validar y auditar el valor final explícito.
        const nuevoNumero = ultimoNumero === null
            ? Number(actual.ultimo_numero)
            : Math.max(Number(actual.ultimo_numero), ultimoNumero);
        await client.query(`
            UPDATE fg_serie_comprobante
            SET es_predeterminada = $1, autogenerada = $2,
                contingencia = $3, tipo_documento_referencia = $4,
                serie_pos = $5, ultimo_numero = $6,
                fecha_modificacion = CURRENT_TIMESTAMP,
                nombre_dms = $7, codigo_local_dms = $8,
                nombre_local_dms = $9, telefono_local_dms = $10,
                correo_local_dms = $11, direccion_comercial_dms = $12
            WHERE id = $13
        `, [
            valor('es_predeterminada'), valor('autogenerada'), valor('contingencia'),
            tipoDocumentoReferencia, valor('serie_pos'), nuevoNumero,
            ...COLUMNAS_METADATO_DMS.map((nombre) => (
                Object.prototype.hasOwnProperty.call(metadato, nombre) ? metadato[nombre] : actual[nombre]
            )),
            id
        ]);
        const despues = {
            ...actual,
            es_predeterminada: valor('es_predeterminada'),
            autogenerada: valor('autogenerada'),
            contingencia: valor('contingencia'),
            tipo_documento_referencia: tipoDocumentoReferencia,
            serie_pos: valor('serie_pos'),
            ultimo_numero: nuevoNumero,
            ...COLUMNAS_METADATO_DMS.reduce((acc, nombre) => {
                acc[nombre] = Object.prototype.hasOwnProperty.call(metadato, nombre)
                    ? metadato[nombre]
                    : actual[nombre];
                return acc;
            }, {})
        };
        await configService.registrarAuditoria(client, {
            username, entidad: 'SERIE_COMPROBANTE', accion: 'EDITAR_SERIE',
            identificador: `${actual.planta_key}:${actual.tipo_comprobante}:${actual.serie}`,
            detalles: { antes: actual, despues }, planta_key: actual.planta_key, ip_direccion: ipDireccion
        });
        if (actual.es_predeterminada !== despues.es_predeterminada) {
            await configService.registrarAuditoria(client, {
                username, entidad: 'SERIE_COMPROBANTE', accion: 'CAMBIAR_SERIE_PREDETERMINADA',
                identificador: `${actual.planta_key}:${actual.tipo_comprobante}`,
                detalles: {
                    antes: actual.es_predeterminada ? { serie: actual.serie } : null,
                    despues: despues.es_predeterminada ? { serie: actual.serie } : null
                },
                planta_key: actual.planta_key, ip_direccion: ipDireccion
            });
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505' && error.constraint === 'uk_fg_serie_comprobante_predeterminada_activa') {
            throw new Error('SERIE_PREDETERMINADA_DUPLICADA');
        }
        throw error;
    } finally { client.release(); }
};

/**
 * Listado del MAESTRO de series para la pantalla de Configuración.
 *
 * A diferencia de `exports.listar`, que sirve a la pantalla de Facturación:
 *   - NO sustituye `serie`/`ultimo_numero` por los valores de
 *     `seriedocumentobase`. Aquí se ve el valor REAL de la fila, que es el que
 *     refleja el maestro DMS. La sustitución de las filas LEGACY es una
 *     decisión de la pantalla de emisión y no debe gobernar al inventario
 *     del maestro.
 *   - La sede es un filtro OPCIONAL: el maestro se consulta completo y se
 *     filtra por planta cuando se pide.
 *   - `tipo_documento` (01/03/07/08) es el código SUNAT que trae el Excel;
 *     `tipo_comprobante` es el enumerado interno. Se exponen ambos.
 */
exports.listarMaestro = async ({
    plantaKey, tipo, activo, buscar, soloDms = false, origen, entorno
} = {}) => {
    const valores = [];
    const condiciones = [];
    const agregar = (sql, valor) => {
        valores.push(valor);
        condiciones.push(sql.replace('?', `$${valores.length}`));
    };
    if (plantaKey) agregar('s.planta_key = ?', plantaKey);
    if (tipo) agregar('s.tipo_comprobante = ?', tipo);
    if (activo === true || activo === false) agregar('s.activo = ?', activo);
    if (origen) agregar('s.proveedor_emision = ?', origen);
    // El ambiente sólo tiene sentido para las series NUBEFACT: las DMS y las
    // LEGACY internas no se emiten por ambiente. Se aplica siempre que se pida.
    if (entorno) agregar('s.entorno_emision = ?', entorno);
    // La exportación DMS debe contener únicamente las filas realmente
    // homologadas contra el Excel maestro. Las series internas/históricas no
    // tienen esos metadatos y no se deben completar con datos inventados.
    if (soloDms) condiciones.push('s.nombre_dms IS NOT NULL');
    if (buscar) {
        // La búsqueda del maestro abarca serie, nombre DMS y datos del local,
        // así que el mismo patrón se registra una sola vez y se reutiliza.
        valores.push(`%${buscar}%`);
        const patron = `$${valores.length}`;
        condiciones.push(`(s.serie ILIKE ${patron} OR COALESCE(s.nombre_dms, '') ILIKE ${patron}`
            + ` OR COALESCE(s.nombre_local_dms, '') ILIKE ${patron}`
            + ` OR COALESCE(s.codigo_local_dms, '') ILIKE ${patron})`);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const result = await db.query(`
        SELECT s.*, p.nombre AS sede_nombre, e.nombre AS empresa_nombre,
               CASE s.tipo_comprobante
                   WHEN 'FACTURA' THEN '01' WHEN 'BOLETA' THEN '03'
                   WHEN 'NOTA_CREDITO_FACTURA' THEN '07' WHEN 'NOTA_CREDITO_BOLETA' THEN '07'
                   WHEN 'NOTA_DEBITO_FACTURA' THEN '08' WHEN 'NOTA_DEBITO_BOLETA' THEN '08'
                   ELSE NULL END AS tipo_documento,
               CASE s.tipo_comprobante
                   WHEN 'FACTURA' THEN 'FE' WHEN 'BOLETA' THEN 'BE'
                   WHEN 'NOTA_CREDITO_FACTURA' THEN 'NCF' WHEN 'NOTA_CREDITO_BOLETA' THEN 'NCB'
                   WHEN 'NOTA_DEBITO_FACTURA' THEN 'NDF' WHEN 'NOTA_DEBITO_BOLETA' THEN 'NDB'
                   ELSE NULL END AS nombre_dms_calculado
        FROM fg_serie_comprobante s
        JOIN fg_planta p ON p.key = s.planta_key
        LEFT JOIN fg_empresa e ON e.key = s.empresa_key
        ${where}
        ORDER BY p.nombre, s.tipo_comprobante, s.serie
    `, valores);
    return result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        ultimo_numero: Number(row.ultimo_numero),
        // El nombre DMS del Excel es la fuente; si la fila no lo tiene, se
        // deduce del tipo para que la columna nunca salga vacía sin motivo. El
        // origen se calcula antes, con el valor real de la columna.
        nombre_dms: row.nombre_dms || row.nombre_dms_calculado,
        numero_dms: numeroDmsDesdeSerie(row),
        /**
         * Origen de la fila, que es lo que habilita cada acción. Se resuelve
         * aquí y no en el cliente para que la vista y la exportación compartan
         * exactamente la misma clasificación.
         *
         *   NUBEFACT/DEMO        serie de Nubefact del ambiente DEMO
         *   NUBEFACT/PRODUCCION  serie de Nubefact del ambiente PRODUCTIVO
         *   DMS/LEGACY           homologada contra el Excel maestro DMS
         *   LEGACY/FARENET       interna histórica, sin metadato DMS
         */
        origen: row.proveedor_emision === 'NUBEFACT'
            ? `NUBEFACT/${row.entorno_emision}`
            // El metadato importado del Excel es lo que distingue una serie DMS
            // de una interna de FARENET. Se mira la columna tal como viene de la
            // tabla: `row.nombre_dms` aún no fue sustituido por el valor derivado.
            : (row.nombre_dms ? 'DMS/LEGACY' : 'LEGACY/FARENET'),
        es_nubefact: row.proveedor_emision === 'NUBEFACT',
        es_dms: row.proveedor_emision !== 'NUBEFACT' && Boolean(row.nombre_dms)
    }));
};

exports.cambiarEstado = async (id, activo, username, ipDireccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actual = await client.query('SELECT * FROM fg_serie_comprobante WHERE id = $1 FOR UPDATE', [id]);
        if (actual.rowCount === 0) throw new Error('SERIE_NO_ENCONTRADA');
        await client.query(`
            UPDATE fg_serie_comprobante
            SET activo = $1, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [activo, id]);
        await configService.registrarAuditoria(client, {
            username, entidad: 'SERIE_COMPROBANTE', accion: activo ? 'ACTIVAR_SERIE' : 'DESACTIVAR_SERIE',
            identificador: `${actual.rows[0].planta_key}:${actual.rows[0].tipo_comprobante}:${actual.rows[0].serie}`,
            detalles: { antes: { activo: actual.rows[0].activo }, despues: { activo } },
            planta_key: actual.rows[0].planta_key, ip_direccion: ipDireccion
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505' && error.constraint === 'uk_fg_serie_comprobante_predeterminada_activa') {
            throw new Error('SERIE_PREDETERMINADA_DUPLICADA');
        }
        throw error;
    } finally { client.release(); }
};

exports.confirmarProduccion = async (id, datos, username, ipDireccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actualResult = await client.query('SELECT * FROM fg_serie_comprobante WHERE id = $1 FOR UPDATE', [id]);
        if (actualResult.rowCount === 0) throw new Error('SERIE_NO_ENCONTRADA');
        const actual = actualResult.rows[0];
        if (actual.proveedor_emision !== 'NUBEFACT' || actual.entorno_emision !== 'PRODUCCION') {
            throw new Error('SERIE_NO_APTA_PRODUCCION');
        }
        if (!actual.activo || !actual.es_predeterminada || !actual.autogenerada) {
            throw new Error('SERIE_NO_APTA_PRODUCCION');
        }
        if (datos.confirmada && datos.numero_inicial_confirmado < Number(actual.ultimo_numero)) {
            throw new Error('SERIE_NUMERO_CONFIRMADO_MENOR');
        }
        const numero = datos.confirmada ? datos.numero_inicial_confirmado : Number(actual.ultimo_numero);
        await client.query(`
            UPDATE fg_serie_comprobante
            SET confirmada_produccion = $1,
                numero_inicial_confirmado = CASE WHEN $1 THEN $2 ELSE numero_inicial_confirmado END,
                ultimo_numero = CASE WHEN $1 THEN $2 ELSE ultimo_numero END,
                sistema_origen = CASE WHEN $1 THEN $3 ELSE sistema_origen END,
                fecha_corte = CASE WHEN $1 THEN $4 ELSE fecha_corte END,
                usuario_confirmacion = $5,
                fecha_confirmacion = CURRENT_TIMESTAMP,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $6
        `, [datos.confirmada, numero, datos.sistema_origen, datos.fecha_corte, username, id]);
        await configService.registrarAuditoria(client, {
            username,
            entidad: 'SERIE_COMPROBANTE',
            accion: datos.confirmada ? 'CONFIRMAR_SERIE_PRODUCCION' : 'REVOCAR_SERIE_PRODUCCION',
            identificador: `${actual.planta_key}:${actual.tipo_comprobante}:${actual.serie}`,
            detalles: {
                antes: {
                    confirmadaProduccion: actual.confirmada_produccion,
                    ultimoNumero: Number(actual.ultimo_numero)
                },
                despues: {
                    confirmadaProduccion: datos.confirmada,
                    ultimoNumero: numero,
                    sistemaOrigen: datos.sistema_origen,
                    fechaCorte: datos.fecha_corte
                }
            },
            planta_key: actual.planta_key,
            ip_direccion: ipDireccion
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
};

exports._private = { migracionNubefactAplicada, COLUMNAS_NUBEFACT, COLUMNAS_METADATO_DMS };
