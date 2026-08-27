const db = require('../../../config/database');

const texto = (valor, maximo) => {
    if (valor === undefined || valor === null || valor === '') return null;
    return String(valor).trim().substring(0, maximo);
};

const obtenerIp = (req) => {
    const reenviada = req?.headers?.['x-forwarded-for'];
    const valor = Array.isArray(reenviada) ? reenviada[0] : reenviada;
    return texto(valor ? String(valor).split(',')[0] : (req?.ip || req?.socket?.remoteAddress), 45);
};

exports.contextoRequest = (req, datos = {}) => ({
    username: req?.user?.username || null,
    perfil: req?.user?.perfil_id || req?.user?.perfil || null,
    planta_key: req?.user?.planta_key || req?.user?.plantaKey || null,
    ip_direccion: obtenerIp(req),
    user_agent: req?.headers?.['user-agent'] || null,
    ...datos
});

exports.registrarEvento = async ({
    username,
    evento,
    exitoso = true,
    mensaje,
    planta_key,
    ip_direccion,
    user_agent,
    perfil,
    categoria = 'ACCESO',
    entidad,
    entidad_id,
    certificado_id,
    numero_certificado,
    placa,
    tipo_certificado,
    paso,
    datos
}) => {
    try {
        await db.query(`
            INSERT INTO fg_auditoria_acceso (
                username, evento, exitoso, mensaje, planta_key, ip_direccion, user_agent, perfil,
                categoria, entidad, entidad_id, certificado_id, numero_certificado,
                placa, tipo_certificado, paso, datos
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                COALESCE($8, (SELECT perfil_id FROM fg_usuario WHERE username = $1::varchar)),
                $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
            )
        `, [
            texto(username, 255),
            texto(evento, 50),
            Boolean(exitoso),
            texto(mensaje, 4000),
            texto(planta_key, 20),
            texto(ip_direccion, 45),
            texto(user_agent, 1000),
            texto(perfil, 50),
            texto(categoria, 30) || 'ACCESO',
            texto(entidad, 50),
            entidad_id || null,
            certificado_id || null,
            texto(numero_certificado, 80),
            texto(placa, 20)?.toUpperCase() || null,
            texto(tipo_certificado, 50),
            texto(paso, 50),
            datos ? JSON.stringify(datos) : null
        ]);
    } catch (error) {
        console.error('Error crítico al registrar auditoría en FAREGAS:', error);
        // La auditoría nunca debe tumbar la operación principal.
    }
};

exports.registrarEventoCertificado = async (datosEvento) => {
    try {
        const certificadoId = Number(datosEvento.certificado_id || datosEvento.certificadoId);
        if (!Number.isInteger(certificadoId) || certificadoId <= 0) {
            return exports.registrarEvento(datosEvento);
        }

        const result = await db.query(`
            SELECT
                c.id,
                c.numero_certificado,
                c.planta_key,
                c.tipo_certificado_clave,
                c.paso_actual,
                v.placa
            FROM fg_certificado c
            LEFT JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
            WHERE c.id = $1
        `, [certificadoId]);
        const certificado = result.rows[0] || {};

        return exports.registrarEvento({
            ...datosEvento,
            categoria: datosEvento.categoria || 'CERTIFICADO',
            entidad: datosEvento.entidad || 'fg_certificado',
            entidad_id: datosEvento.entidad_id || certificadoId,
            certificado_id: certificadoId,
            numero_certificado: datosEvento.numero_certificado || certificado.numero_certificado,
            planta_key: datosEvento.planta_key || certificado.planta_key,
            placa: datosEvento.placa || certificado.placa,
            tipo_certificado: datosEvento.tipo_certificado || certificado.tipo_certificado_clave,
            paso: datosEvento.paso || certificado.paso_actual
        });
    } catch (error) {
        console.error('Error al enriquecer auditoría de certificado FAREGAS:', error);
        return exports.registrarEvento(datosEvento);
    }
};

exports.listarAccesos = async (filtros) => {
    const {
        username, evento, exitoso, fechaInicio, fechaFin,
        categoria, placa, certificadoId, plantaKey, buscar, modulo
    } = filtros;
    let query = `
        SELECT a.*
        FROM fg_auditoria_acceso a
        WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (username) {
        query += ` AND a.username ILIKE $${paramIndex}`;
        params.push(`%${username}%`);
        paramIndex++;
    }
    
    if (evento) {
        query += ` AND a.evento = $${paramIndex}`;
        params.push(evento);
        paramIndex++;
    }

    if (categoria) {
        query += ` AND a.categoria = $${paramIndex}`;
        params.push(categoria);
        paramIndex++;
    }

    if (modulo) {
        const categoriasModulo = {
            INICIO: ['CERTIFICADO', 'PAGO', 'FACTURACION'],
            USUARIOS: ['USUARIOS'],
            DESCUENTOS: ['DESCUENTO'],
            CONFIGURACION: ['CONFIGURACION'],
            ACCESOS: ['ACCESO']
        }[String(modulo).toUpperCase()];
        if (categoriasModulo) {
            query += ` AND a.categoria = ANY($${paramIndex}::varchar[])`;
            params.push(categoriasModulo);
            paramIndex++;
        }
    }

    if (placa) {
        query += ` AND a.placa ILIKE $${paramIndex}`;
        params.push(`%${placa}%`);
        paramIndex++;
    }

    if (certificadoId) {
        query += ` AND a.certificado_id = $${paramIndex}`;
        params.push(Number(certificadoId));
        paramIndex++;
    }

    if (plantaKey) {
        query += ` AND a.planta_key = $${paramIndex}`;
        params.push(plantaKey);
        paramIndex++;
    }

    if (buscar) {
        query += ` AND (
            COALESCE(a.numero_certificado, '') ILIKE $${paramIndex}
            OR COALESCE(a.placa, '') ILIKE $${paramIndex}
            OR COALESCE(a.mensaje, '') ILIKE $${paramIndex}
            OR COALESCE(a.certificado_id::text, '') ILIKE $${paramIndex}
        )`;
        params.push(`%${buscar}%`);
        paramIndex++;
    }

    if (exitoso !== undefined && exitoso !== '') {
        query += ` AND a.exitoso = $${paramIndex}`;
        params.push(exitoso === 'true' || exitoso === true);
        paramIndex++;
    }

    if (fechaInicio) {
        query += ` AND a.fecha_evento >= $${paramIndex}`;
        params.push(`${fechaInicio} 00:00:00`);
        paramIndex++;
    }

    if (fechaFin) {
        query += ` AND a.fecha_evento <= $${paramIndex}`;
        params.push(`${fechaFin} 23:59:59`);
        paramIndex++;
    }

    query += ' ORDER BY a.fecha_evento DESC LIMIT 500';

    const result = await db.query(query, params);
    return result.rows;
};
