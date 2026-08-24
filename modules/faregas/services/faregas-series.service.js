const db = require('../../../config/database');
const configService = require('./faregas-config.service');

const normalizarFila = (row) => ({
    ...row,
    id: Number(row.id),
    ultimo_numero: Number(row.ultimo_numero)
});

exports.listarSedes = async () => {
    const result = await db.query(`
        SELECT p.key, p.nombre, p.direccion, p.activo,
               COUNT(s.id) FILTER (WHERE s.activo) AS series_activas
        FROM fg_planta p
        LEFT JOIN fg_serie_comprobante s ON s.planta_key = p.key
        GROUP BY p.key, p.nombre, p.direccion, p.activo
        ORDER BY p.activo DESC, p.nombre
    `);
    return result.rows.map((row) => ({ ...row, series_activas: Number(row.series_activas) }));
};

exports.listar = async ({ plantaKey, tipo, activo, buscar } = {}) => {
    const valores = [plantaKey];
    const condiciones = ['s.planta_key = $1'];
    if (tipo) { valores.push(tipo); condiciones.push(`s.tipo_comprobante = $${valores.length}`); }
    if (activo === true || activo === false) { valores.push(activo); condiciones.push(`s.activo = $${valores.length}`); }
    if (buscar) { valores.push(`%${buscar}%`); condiciones.push(`s.serie ILIKE $${valores.length}`); }
    const result = await db.query(`
        SELECT s.*, p.nombre AS sede_nombre
        FROM fg_serie_comprobante s
        JOIN fg_planta p ON p.key = s.planta_key
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

exports.crear = async (serie, username, ipDireccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const planta = await client.query('SELECT key, nombre FROM fg_planta WHERE key = $1', [serie.planta_key]);
        if (planta.rowCount === 0) throw new Error('SEDE_NO_ENCONTRADA');
        const result = await client.query(`
            INSERT INTO fg_serie_comprobante (
                planta_key, tipo_comprobante, serie, ultimo_numero,
                es_predeterminada, autogenerada, contingencia, activo
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING id
        `, [
            serie.planta_key, serie.tipo_comprobante, serie.serie, serie.ultimo_numero,
            serie.es_predeterminada, serie.autogenerada, serie.contingencia, serie.activo
        ]);
        const despues = { ...serie, sede_nombre: planta.rows[0].nombre };
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
        if (error.code === '23505') throw new Error('SERIE_DUPLICADA');
        throw error;
    } finally { client.release(); }
};

exports.editar = async (id, cambios, username, ipDireccion) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const actualResult = await client.query('SELECT * FROM fg_serie_comprobante WHERE id = $1 FOR UPDATE', [id]);
        if (actualResult.rowCount === 0) throw new Error('SERIE_NO_ENCONTRADA');
        const actual = actualResult.rows[0];
        await client.query(`
            UPDATE fg_serie_comprobante
            SET es_predeterminada = $1, autogenerada = $2,
                contingencia = $3, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $4
        `, [cambios.es_predeterminada, cambios.autogenerada, cambios.contingencia, id]);
        const despues = {
            ...actual,
            es_predeterminada: cambios.es_predeterminada,
            autogenerada: cambios.autogenerada,
            contingencia: cambios.contingencia
        };
        await configService.registrarAuditoria(client, {
            username, entidad: 'SERIE_COMPROBANTE', accion: 'EDITAR_SERIE',
            identificador: `${actual.planta_key}:${actual.tipo_comprobante}:${actual.serie}`,
            detalles: { antes: actual, despues }, planta_key: actual.planta_key, ip_direccion: ipDireccion
        });
        if (actual.es_predeterminada !== cambios.es_predeterminada) {
            await configService.registrarAuditoria(client, {
                username, entidad: 'SERIE_COMPROBANTE', accion: 'CAMBIAR_SERIE_PREDETERMINADA',
                identificador: `${actual.planta_key}:${actual.tipo_comprobante}`,
                detalles: {
                    antes: actual.es_predeterminada ? { serie: actual.serie } : null,
                    despues: cambios.es_predeterminada ? { serie: actual.serie } : null
                }, planta_key: actual.planta_key, ip_direccion: ipDireccion
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
