
// ============================================
// FASE 4: DATOS ESPECÍFICOS DE CERTIFICADOS
// ============================================

const obtenerYValidarBorrador = async (client, id, tipoRequerido, userContext) => {
    const qCheck = `SELECT estado, planta_key, tipo_certificado_clave FROM fg_certificado WHERE id = $1 FOR UPDATE`;
    const rCheck = await client.query(qCheck, [id]);
    if (rCheck.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    const cert = rCheck.rows[0];

    await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
    
    if (cert.estado !== 'BORRADOR') throw new Error('CERTIFICADO_NO_EDITABLE');
    if (tipoRequerido && cert.tipo_certificado_clave !== tipoRequerido) {
        throw new Error('TIPO_CERTIFICADO_INCORRECTO');
    }
    
    return cert;
};

// ================= GNV =================

exports.guardarGNV = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GNV_ANUAL', userContext);

        let snapshotTaller = null;
        if (data.tallerAutorizadoId) {
            const resTaller = await client.query('SELECT razon_social, sede, direccion, codigo_autorizacion FROM fg_taller_autorizado WHERE id = $1 AND estado = true', [data.tallerAutorizadoId]);
            if (resTaller.rowCount === 0) throw new Error('TALLER_NOT_FOUND');
            snapshotTaller = resTaller.rows[0];
        }

        const qUpd = `
            INSERT INTO fg_certificado_gnv (
                certificado_id, taller_autorizado_id, vigencia_hasta, taller_razon_social, taller_sede, taller_direccion, taller_codigo_autorizacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (certificado_id) DO UPDATE SET
                taller_autorizado_id = EXCLUDED.taller_autorizado_id,
                vigencia_hasta = EXCLUDED.vigencia_hasta,
                taller_razon_social = EXCLUDED.taller_razon_social,
                taller_sede = EXCLUDED.taller_sede,
                taller_direccion = EXCLUDED.taller_direccion,
                taller_codigo_autorizacion = EXCLUDED.taller_codigo_autorizacion
        `;
        
        await client.query(qUpd, [
            id,
            data.tallerAutorizadoId || null,
            data.vigenciaHasta || null,
            snapshotTaller ? snapshotTaller.razon_social : null,
            snapshotTaller ? snapshotTaller.sede : null,
            snapshotTaller ? snapshotTaller.direccion : null,
            snapshotTaller ? snapshotTaller.codigo_autorizacion : null
        ]);

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.guardarGNVVerificaciones = async (id, verificaciones, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GNV_ANUAL', userContext);

        await client.query('DELETE FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1', [id]);

        if (verificaciones && verificaciones.length > 0) {
            const qIns = `
                INSERT INTO fg_certificado_gnv_verificacion (certificado_id, codigo, orden, descripcion, cumple, observacion)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            for (const v of verificaciones) {
                await client.query(qIns, [id, v.codigo, v.orden, v.descripcion, v.cumple, v.observacion || null]);
            }
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerGNV = async (id, userContext) => {
    const qCert = `SELECT planta_key FROM fg_certificado WHERE id = $1`;
    const rCert = await db.query(qCert, [id]);
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    await validarAccesoCertificado(userContext.username, userContext.perfil_id, rCert.rows[0].planta_key);

    const rGnv = await db.query(`SELECT * FROM fg_certificado_gnv WHERE certificado_id = $1`, [id]);
    const rVerif = await db.query(`SELECT * FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1 ORDER BY orden ASC`, [id]);

    return {
        gnv: rGnv.rowCount > 0 ? rGnv.rows[0] : null,
        verificaciones: rVerif.rows
    };
};

// ================= GLP =================

exports.guardarGLP = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GLP_ANUAL', userContext);

        let snapshotTaller = null;
        if (data.tallerAutorizadoId) {
            const resTaller = await client.query('SELECT razon_social, sede, direccion, codigo_autorizacion FROM fg_taller_autorizado WHERE id = $1 AND estado = true', [data.tallerAutorizadoId]);
            if (resTaller.rowCount === 0) throw new Error('TALLER_NOT_FOUND');
            snapshotTaller = resTaller.rows[0];
        }

        const qUpd = `
            INSERT INTO fg_certificado_glp (
                certificado_id, taller_autorizado_id, expediente_tecnico, vigencia_hasta, taller_razon_social, taller_sede, taller_direccion, taller_codigo_autorizacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (certificado_id) DO UPDATE SET
                taller_autorizado_id = EXCLUDED.taller_autorizado_id,
                expediente_tecnico = EXCLUDED.expediente_tecnico,
                vigencia_hasta = EXCLUDED.vigencia_hasta,
                taller_razon_social = EXCLUDED.taller_razon_social,
                taller_sede = EXCLUDED.taller_sede,
                taller_direccion = EXCLUDED.taller_direccion,
                taller_codigo_autorizacion = EXCLUDED.taller_codigo_autorizacion
        `;
        
        await client.query(qUpd, [
            id,
            data.tallerAutorizadoId || null,
            data.expedienteTecnico || null,
            data.vigenciaHasta || null,
            snapshotTaller ? snapshotTaller.razon_social : null,
            snapshotTaller ? snapshotTaller.sede : null,
            snapshotTaller ? snapshotTaller.direccion : null,
            snapshotTaller ? snapshotTaller.codigo_autorizacion : null
        ]);

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.guardarGLPComponentes = async (id, componentes, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GLP_ANUAL', userContext);

        await client.query('DELETE FROM fg_certificado_glp_componente WHERE certificado_id = $1', [id]);

        if (componentes && componentes.length > 0) {
            const qIns = `
                INSERT INTO fg_certificado_glp_componente (certificado_id, orden, componente, marca, modelo, capacidad_litros, mes_fabricacion, anio_fabricacion, numero_serie)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `;
            for (const c of componentes) {
                await client.query(qIns, [id, c.orden, c.componente, c.marca || null, c.modelo || null, c.capacidadLitros || null, c.mesFabricacion || null, c.anioFabricacion || null, c.numeroSerie || null]);
            }
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505' && e.constraint === 'fg_certificado_glp_componente_certificado_id_orden_key') {
            throw new Error('COMPONENTE_INVALIDO');
        }
        throw e;
    } finally {
        client.release();
    }
};

exports.guardarGLPVerificaciones = async (id, verificaciones, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'GLP_ANUAL', userContext);

        await client.query('DELETE FROM fg_certificado_glp_verificacion WHERE certificado_id = $1', [id]);

        if (verificaciones && verificaciones.length > 0) {
            const qIns = `
                INSERT INTO fg_certificado_glp_verificacion (certificado_id, codigo, orden, descripcion, cumple, observacion)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            for (const v of verificaciones) {
                await client.query(qIns, [id, v.codigo, v.orden, v.descripcion, v.cumple, v.observacion || null]);
            }
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerGLP = async (id, userContext) => {
    const qCert = `SELECT planta_key FROM fg_certificado WHERE id = $1`;
    const rCert = await db.query(qCert, [id]);
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    await validarAccesoCertificado(userContext.username, userContext.perfil_id, rCert.rows[0].planta_key);

    const rGlp = await db.query(`SELECT * FROM fg_certificado_glp WHERE certificado_id = $1`, [id]);
    const rComp = await db.query(`SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = $1 ORDER BY orden ASC`, [id]);
    const rVerif = await db.query(`SELECT * FROM fg_certificado_glp_verificacion WHERE certificado_id = $1 ORDER BY orden ASC`, [id]);

    return {
        glp: rGlp.rowCount > 0 ? rGlp.rows[0] : null,
        componentes: rComp.rows,
        verificaciones: rVerif.rows
    };
};

// ================= CONFORMIDAD =================

exports.guardarConformidad = async (id, data, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await obtenerYValidarBorrador(client, id, 'CONFORMIDAD', userContext);
        
        if (data.tipoConformidad && !['MODIFICACION', 'MONTAJE', 'FABRICACION'].includes(data.tipoConformidad)) {
            throw new Error('TIPO_CONFORMIDAD_INVALIDO');
        }

        const qUpd = `
            INSERT INTO fg_certificado_conformidad (
                certificado_id, tipo_conformidad, tipo_tramite, caracteristica_registrable, motivo, descripcion, uso_original_vehiculo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (certificado_id) DO UPDATE SET
                tipo_conformidad = EXCLUDED.tipo_conformidad,
                tipo_tramite = EXCLUDED.tipo_tramite,
                caracteristica_registrable = EXCLUDED.caracteristica_registrable,
                motivo = EXCLUDED.motivo,
                descripcion = EXCLUDED.descripcion,
                uso_original_vehiculo = EXCLUDED.uso_original_vehiculo
        `;
        
        await client.query(qUpd, [
            id,
            data.tipoConformidad,
            data.tipoTramite || null,
            data.caracteristicaRegistrable || null,
            data.motivo || null,
            data.descripcion || null,
            data.usoOriginalVehiculo || null
        ]);

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.obtenerConformidad = async (id, userContext) => {
    const qCert = `SELECT planta_key FROM fg_certificado WHERE id = $1`;
    const rCert = await db.query(qCert, [id]);
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    await validarAccesoCertificado(userContext.username, userContext.perfil_id, rCert.rows[0].planta_key);

    const rConf = await db.query(`SELECT * FROM fg_certificado_conformidad WHERE certificado_id = $1`, [id]);
    
    return {
        conformidad: rConf.rowCount > 0 ? rConf.rows[0] : null
    };
};

// ================= TALLERES =================

exports.obtenerTalleresActivos = async () => {
    const res = await db.query(`
        SELECT id, ruc, razon_social AS "razonSocial", nombre_comercial AS "nombreComercial", 
               sede, direccion, codigo_autorizacion AS "codigoAutorizacion"
        FROM fg_taller_autorizado
        WHERE estado = true
        ORDER BY razon_social ASC
    `);
    return res.rows;
};
