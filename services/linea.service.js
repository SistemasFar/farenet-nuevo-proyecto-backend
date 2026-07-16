const db = require('../config/database');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const ValidarEtapaService = require('./validar_etapa.service');

class LineaService {
  async obtenerRecibo(nroInspeccion) {
    const compRes = await db.query(`
      SELECT 
        c.id, c.nrocomprobante, c.fechcreacion, c.cliente_nrodocumentoidentidad, 
        c.nombrerazonsocial, c.placamotor, c.importetotal, c.comprobanteestado_key as estado,
        p.nombres, p.apellidos,
        ci.nombre as concepto_nombre,
        l.key as linea_key, l.planta_key
      FROM comprobante c
      LEFT JOIN persona p ON c.cliente_nrodocumentoidentidad = p.nrodocumentoidentidad
      LEFT JOIN conceptoinspeccion ci ON c.conceptoinspeccion_key = ci.key
      LEFT JOIN linea l ON c.linea_key = l.key
      WHERE c.inspeccion_nrodocumentoinspeccion = $1
      ORDER BY c.fechcreacion DESC NULLS LAST
      LIMIT 1
    `, [nroInspeccion]);

    if (compRes.rows.length === 0) {
      const error = new Error('Recibo no encontrado para esta inspección');
      error.statusCode = 404;
      throw error;
    }

    const c = compRes.rows[0];
    const pagosRes = await db.query(`
      SELECT 
        id, baseimponible, igv, importe, moneda_key, estado, fechcreacion
      FROM pago 
      WHERE comprobante_id = $1
      ORDER BY fechcreacion ASC NULLS LAST, id ASC
    `, [c.id]);

    return {
      nroInspeccion: nroInspeccion,
      nroComprobante: c.nrocomprobante || 'Pendiente',
      fecha: c.fechcreacion,
      cliente: {
        nrodocumento: c.cliente_nrodocumentoidentidad,
        nombre: c.nombrerazonsocial || `${c.nombres || ''} ${c.apellidos || ''}`.trim()
      },
      vehiculo: {
        placa: c.placamotor
      },
      concepto: c.concepto_nombre,
      importeTotal: c.importetotal,
      linea: c.linea_key,
      planta: c.planta_key,
      estado: c.estado,
      pagos: pagosRes.rows
    };
  }

  async getInspeccionLinea(nroInspeccion) {
    const query = `
      SELECT nrodocumentoinspeccion as nroinspeccion, inspeccionestado_key,
             vehiculo_nromotor, posicion, resultado, fechconsolidado, fechiniciovigencia
      FROM inspeccion
      WHERE nrodocumentoinspeccion = $1
    `;
    const res = await db.query(query, [nroInspeccion]);
    return res.rows[0];
  }

  async updatePaso(nroInspeccion, paso, data) {
    const inspeccion = await this.getInspeccionLinea(nroInspeccion);
    if (!inspeccion) throw new Error('Inspección no encontrada');
    return inspeccion;
  }

  async consolidarInspeccion(nroInspeccion, payload) {
    const { ingenieroSeleccionado, tipoInspeccion, tipoCertificado, tipoAutorizacion, observacion, gas } = payload;
    
    const queryCheck = `SELECT nrodocumentoinspeccion FROM inspeccion WHERE nrodocumentoinspeccion = $1`;
    const check = await db.query(queryCheck, [nroInspeccion]);
    if (check.rows.length === 0) throw new Error('Inspección no encontrada');

    const queryUpdate = `
      UPDATE inspeccion 
      SET 
        usuarioconsolidado_username = $1,
        inspeccionestado_key = 'CON',
        posicion = 14,
        fechconsolidado = NOW()
      WHERE nrodocumentoinspeccion = $2
      RETURNING *
    `;
    const res = await db.query(queryUpdate, [ingenieroSeleccionado, nroInspeccion]);
    return res.rows[0];
  }
  async anularInspeccion(nroInspeccion, motivo, usuario) {
    const inspeccion = await this.getInspeccionLinea(nroInspeccion);
    if (!inspeccion) {
      const error = new Error('Inspección no encontrada');
      error.statusCode = 404;
      throw error;
    }

    const invalidStates = ['CON', 'ANU', 'RET', 'RETIRADO'];
    if (invalidStates.includes(inspeccion.inspeccionestado_key) || inspeccion.fechconsolidado) {
      const error = new Error('No se puede anular esta inspección por su estado actual.');
      error.statusCode = 409;
      throw error;
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      
      const checkQuery = `SELECT nrodocumentoinspeccion FROM inspeccion WHERE nrodocumentoinspeccion = $1 FOR UPDATE`;
      await client.query(checkQuery, [nroInspeccion]);

      const updateQuery = `
        UPDATE inspeccion
        SET 
          inspeccionestado_key = 'ANU',
          fechmodi = NOW(),
          fechanulacion = NOW(),
          usuarioanulacion_username = $1,
          usuariomodi_id = $2,
          observacionanulado = $3
        WHERE nrodocumentoinspeccion = $4
        RETURNING *
      `;
      const res = await client.query(updateQuery, [usuario, usuario, motivo, nroInspeccion]);
      
      await client.query('COMMIT');
      return res.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async obtenerDatosConsolidacion(nroInspeccion) {
    const inspeccionRes = await db.query(
      `SELECT i.nrodocumentoinspeccion, i.posicion, i.inspeccionestado_key, 
              i.resultado, i.fechconsolidado, i.vehiculo_nromotor, i.nrodocumentoinforme,
              i.usuarioconsolidado_username, i.usuarioingcertificador_username, i.observacion,
              cert.nrodocumentocertificado,
              ti.nombre as tipo_inspeccion, tc.nombre as tipo_certificado, ta.ambito as tipo_autorizacion
       FROM inspeccion i
       LEFT JOIN certificado cert ON cert.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
       LEFT JOIN tipoinspeccion ti ON i.tipoinspeccion_key = ti.key
       LEFT JOIN tipocertificado tc ON i.tipocertificado_key = tc.key
       LEFT JOIN tipoautorizacion ta ON i.tipoautorizacion_key = ta.key
       WHERE i.nrodocumentoinspeccion = $1`,
      [nroInspeccion]
    );

    if (inspeccionRes.rows.length === 0) {
      throw new Error("Inspección no encontrada");
    }
    const inspeccion = inspeccionRes.rows[0];

    const vehiculoRes = await db.query(
      `SELECT c.nombre as categoria, comb.nombre as combustible, m.nombre as marca, mod.nombre as modelo,
              p.nombres as prop_nombres, p.apellidos as prop_apellidos, p.nombrerazonsocial as prop_razonsocial, tp.propietario_nrodocumentoidentidad as prop_nrodoc
       FROM vehiculo v 
       JOIN categoria c ON v.categoria_key = c.key
       JOIN combustible comb ON v.combustible_key = comb.key
       LEFT JOIN marca m ON v.marca_key = m.key
       LEFT JOIN modelo mod ON v.modelo_key = mod.key
       LEFT JOIN tarjetapropiedad tp ON v.tarjetapropiedad_id = tp.id
       LEFT JOIN persona p ON tp.propietario_nrodocumentoidentidad = p.nrodocumentoidentidad
       WHERE v.nromotor = $1`,
      [inspeccion.vehiculo_nromotor]
    );

    const comprobanteRes = await db.query(
      `SELECT c.nrocomprobante, c.cliente_nrodocumentoidentidad as nrodoc, c.linea_key, c.placamotor, 
              c.importetotal, ci.nombre as concepto_nombre,
              l.nombre as linea_nombre, l.tipo as linea_tipo, l.planta_key,
              pl.nombre as planta_nombre
       FROM comprobante c
       LEFT JOIN conceptoinspeccion ci ON c.conceptoinspeccion_key = ci.key
       LEFT JOIN linea l ON c.linea_key = l.key
       LEFT JOIN planta pl ON l.planta_key = pl.key
       WHERE c.inspeccion_nrodocumentoinspeccion = $1
       ORDER BY c.fechcreacion DESC LIMIT 1`,
      [nroInspeccion]
    );

    let clienteData = {};
    if (comprobanteRes.rows.length > 0) {
       const clienteRes = await db.query(
         `SELECT p.nombres, p.apellidos, p.nombrerazonsocial, p.nrodocumentoidentidad
          FROM persona p
          WHERE p.nrodocumentoidentidad = $1`,
         [comprobanteRes.rows[0].nrodoc]
       );
       clienteData = clienteRes.rows[0] || {};
    }

    const resultadosMaquinaRes = await db.query(
      `SELECT rm.maquina_id as tipomaquina_key, rm.resultado, rm.fechainicio, rm.fechafin, rm.id,
              tm.descripcion as nombre_prueba
       FROM resultado_maquina rm
       LEFT JOIN maquina m ON m.id = rm.maquina_id
       LEFT JOIN tipomaquina tm ON tm.key = m.tipomaquina_key
       WHERE rm.inspeccion_nrodocumentoinspeccion = $1`,
      [nroInspeccion]
    );

    const defectosRes = await db.query(
      `SELECT d.codigovalor, d.nombrevalor as descripcion, d.nivelpeligro, m.tipomaquina_key as prueba_origen 
       FROM resultado_maquina rm
       JOIN maquina m ON m.id = rm.maquina_id
       JOIN resultado_maquina_defectos rmd ON rm.id = rmd.resultado_maquina_id
       JOIN defecto d ON rmd.defectos_id = d.id
       WHERE rm.inspeccion_nrodocumentoinspeccion = $1`,
      [nroInspeccion]
    );

    let resultadoPorMaquinas = 'A';
    if (resultadosMaquinaRes.rows.some(r => r.resultado === 'D')) {
        resultadoPorMaquinas = 'D';
    }

    let resultadoPorDefectos = 'A';
    const totalDefectosLeves = defectosRes.rows.filter(d => d.nivelpeligro === 'Leve').length;
    const totalDefectosGraves = defectosRes.rows.filter(d => d.nivelpeligro === 'Grave').length;
    const totalDefectosMuyGraves = defectosRes.rows.filter(d => d.nivelpeligro === 'Muy Grave').length;

    if (totalDefectosMuyGraves > 0 || totalDefectosGraves > 0) {
        resultadoPorDefectos = 'D';
    }

    let resultadoSugerido = (resultadoPorMaquinas === 'A' && resultadoPorDefectos === 'A') ? 'A' : 'D';

    return {
      inspeccion,
      vehiculo: {
        ...(vehiculoRes.rows[0] || {}),
        placa: comprobanteRes.rows[0]?.placamotor || null
      },
      clienteRecibo: {
        nombrerazonsocial: clienteData.nombrerazonsocial || null,
        nombres: clienteData.nombres || null,
        apellidos: clienteData.apellidos || null,
        nombre: ((clienteData.nombres || '') + ' ' + (clienteData.apellidos || '')).trim() || 'Desconocido',
        nrodocumento: clienteData.nrodocumentoidentidad || null
      },
      propietarioCertificado: vehiculoRes.rows[0] && vehiculoRes.rows[0].prop_nrodoc ? {
        nombrerazonsocial: vehiculoRes.rows[0].prop_razonsocial || null,
        nombres: vehiculoRes.rows[0].prop_nombres || null,
        apellidos: vehiculoRes.rows[0].prop_apellidos || null,
        nombre: ((vehiculoRes.rows[0].prop_nombres || '') + ' ' + (vehiculoRes.rows[0].prop_apellidos || '')).trim() || 'Desconocido',
        nrodocumento: vehiculoRes.rows[0].prop_nrodoc
      } : null,
      certificacion: {
        tipoInspeccion: inspeccion.tipo_inspeccion || null,
        tipoCertificado: inspeccion.tipo_certificado || null,
        tipoAutorizacion: inspeccion.tipo_autorizacion || null,
        ingenieroCertificadorUsername: inspeccion.usuarioingcertificador_username || null,
        usuarioCertifica: inspeccion.usuarioconsolidado_username || null,
        observacion: inspeccion.observacion || null
      },
      lineaInfo: comprobanteRes.rows[0] && comprobanteRes.rows[0].linea_key ? {
        key: comprobanteRes.rows[0].linea_key,
        nombre: comprobanteRes.rows[0].linea_nombre || null,
        tipo: comprobanteRes.rows[0].linea_tipo || null,
        plantaKey: comprobanteRes.rows[0].planta_key || null
      } : null,
      planta: comprobanteRes.rows[0] && comprobanteRes.rows[0].planta_key ? {
        key: comprobanteRes.rows[0].planta_key,
        nombre: comprobanteRes.rows[0].planta_nombre || null
      } : null,
      comprobante: comprobanteRes.rows[0] || {},
      resultadosMaquina: resultadosMaquinaRes.rows,
      defectos: defectosRes.rows,
      resumen: {
        totalPruebas: resultadosMaquinaRes.rows.length,
        resultadoPorMaquinas,
        totalDefectosLeves,
        totalDefectosGraves,
        totalDefectosMuyGraves,
        resultadoPorDefectos,
        resultadoSugerido
      }
    };
  }

  async getWizardModel(nroInspeccion) {
    const data = await this.obtenerDatosConsolidacion(nroInspeccion);
    
    // Obtener información de la etapa y pruebas faltantes
    const ValidarEtapaService = require('./validar_etapa.service');
    const validacionEtapa = await ValidarEtapaService.validarEtapa(nroInspeccion);
    
    let modo = 'LINEA_EN_PROCESO';
    if (data.inspeccion.inspeccionestado_key === 'CON') modo = 'HISTORICO_CONSOLIDADO';
    else if (data.inspeccion.inspeccionestado_key === 'ANU') modo = 'HISTORICO_ANULADO';
    else if (data.inspeccion.inspeccionestado_key === 'RETIRADO') modo = 'HISTORICO_RETIRADO';
    else if (data.inspeccion.posicion === 14) modo = 'LISTA_PARA_CONSOLIDAR';

    const isHistorico = modo.startsWith('HISTORICO_');
    const recibidasReales = isHistorico ? validacionEtapa.recibidas : validacionEtapa.recibidas;
    const faltantesReales = isHistorico ? [] : validacionEtapa.faltantes;

    const estado = {
      nrodocumentoinspeccion: nroInspeccion,
      posicionActual: data.inspeccion.posicion,
      inspeccionestado_key: data.inspeccion.inspeccionestado_key,
      resultado: data.inspeccion.resultado || validacionEtapa.resultadoPreliminar,
      fechconsolidado: data.inspeccion.fechconsolidado,
      fechiniciovigencia: data.inspeccion.fechiniciovigencia,
      obligatorias: isHistorico ? recibidasReales : validacionEtapa.obligatorias,
      recibidas: recibidasReales,
      faltantes: faltantesReales,
      noAplicables: validacionEtapa.noAplicables,
      etapaCompleta: validacionEtapa.etapaCompleta,
      puedeConsolidar: isHistorico ? false : validacionEtapa.etapaCompleta,
      resultadoPreliminar: validacionEtapa.resultadoPreliminar
    };

    // Agregar resultadosMaquinaRaw explícitos
    const queryRaw = `
      SELECT
        rm.id,
        rm.inspeccion_nrodocumentoinspeccion AS "inspeccionNrodocumentoinspeccion",
        m.tipomaquina_key AS "tipoMaquinaKey",
        rm.resultado,
        rm.maquina_id AS "maquinaId",
        rm.data,
        rm.fechcreacion AS "fechaCreacion",
        rm.fechmodi AS "fechaModificacion"
      FROM resultado_maquina rm
      JOIN maquina m ON m.id = rm.maquina_id
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE $1 || '%'
      ORDER BY m.tipomaquina_key, rm.id;
    `;
    let resultadosMaquinaRaw = [];
    try {
      const { rows } = await db.query(queryRaw, [nroInspeccion]);
      resultadosMaquinaRaw = rows;
    } catch (e) {
      console.error("Error obteniendo resultadosMaquinaRaw:", e);
    }
    
    return {
      ...estado,
      ...data,
      resultadosMaquinaRaw,
      modo,
      vehiculo: {
        ...estado.vehiculo,
        ...data.vehiculo,
      }
    };
  }

  // =========================================================================
  // FASE 9.5 — GUARDADO TRANSACCIONAL DE CONSOLIDACIÓN
  // NOTA: "usuarioConsolidadorUsername" en el payload es PROVISIONAL.
  //       Cuando se implemente JWT, deberá salir del token (req.user.username)
  //       y eliminarse del payload del frontend.
  // =========================================================================
  async guardarConsolidacion(nroInspeccion, payload) {
    const { ingenieroCertificadorUsername, usuarioConsolidadorUsername, observacion } = payload;

    // Validación mínima de payload
    if (!ingenieroCertificadorUsername || !usuarioConsolidadorUsername) {
      throw { statusCode: 400, message: 'Se requieren ingenieroCertificadorUsername y usuarioConsolidadorUsername.' };
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // ── PASO 1: Bloquear y validar inspección ──────────────────────────
      const inspRes = await client.query(
        `SELECT nrodocumentoinspeccion, posicion, inspeccionestado_key, fechconsolidado, vehiculo_nromotor
         FROM inspeccion
         WHERE nrodocumentoinspeccion = $1
         FOR UPDATE`,
        [nroInspeccion]
      );

      if (inspRes.rows.length === 0) {
        throw { statusCode: 404, message: 'Inspección no encontrada.' };
      }

      const inspeccion = inspRes.rows[0];

      if (inspeccion.inspeccionestado_key === 'CON') {
        throw {
          statusCode: 409,
          message: 'La inspección ya se encuentra consolidada.',
          nrodocumentoinspeccion: nroInspeccion,
          estado: 'CON',
          posicion: inspeccion.posicion
        };
      }

      if (inspeccion.posicion !== 14) {
        throw { statusCode: 422, message: `La inspección debe estar en posición 14 para consolidar. Posición actual: ${inspeccion.posicion}` };
      }

      if (inspeccion.fechconsolidado !== null) {
        throw { statusCode: 409, message: 'La inspección ya tiene fecha de consolidado registrada.' };
      }

      // ── PASO 2: Validar usuario consolidador (provisional hasta JWT) ────
      const usrConRes = await client.query(
        `SELECT username FROM usuario WHERE username = $1 AND estado = true`,
        [usuarioConsolidadorUsername]
      );
      if (usrConRes.rows.length === 0) {
        throw { statusCode: 403, message: `El usuario consolidador '${usuarioConsolidadorUsername}' no existe o no está activo.` };
      }

      // ── PASO 3: Obtener comprobante, línea y planta ─────────────────────
      const compRes = await client.query(
        `SELECT c.linea_key, l.planta_key
         FROM comprobante c
         JOIN linea l ON c.linea_key = l.key
         WHERE c.inspeccion_nrodocumentoinspeccion = $1
         ORDER BY c.fechcreacion DESC LIMIT 1`,
        [nroInspeccion]
      );

      if (compRes.rows.length === 0) {
        throw { statusCode: 422, message: 'No existe comprobante asociado a la inspección. No se puede consolidar.' };
      }

      const { linea_key, planta_key } = compRes.rows[0];

      // ── PASO 4: Validar ingeniero certificador con firma y planta ───────
      const ingRes = await client.query(
        `SELECT u.username, u.firmacertificador
         FROM usuario u
         JOIN usuario_planta up ON u.username = up.usuario_username
         WHERE u.username = $1
           AND u.estado = true
           AND u.perfil_id = 'ing_certificador'
           AND up.plantas_key = $2
           AND u.firmacertificador IS NOT NULL
           AND TRIM(u.firmacertificador) <> ''`,
        [ingenieroCertificadorUsername, planta_key]
      );

      if (ingRes.rows.length === 0) {
        throw {
          statusCode: 403,
          message: `El ingeniero '${ingenieroCertificadorUsername}' no existe, no es certificador activo, no pertenece a la planta '${planta_key}', o no tiene firma configurada.`
        };
      }

      // ── PASO 5: Re-validar etapa completa ──────────────────────────────
      const validacion = await ValidarEtapaService.validarEtapa(nroInspeccion, client);
      if (!validacion.etapaCompleta) {
        const nombresF = validacion.faltantes.map(f => f.nombre).join(', ');
        throw { statusCode: 422, message: `Faltan pruebas obligatorias: ${nombresF}` };
      }

      // ── PASO 6: Calcular resultado final en backend ─────────────────────
      const rmRes = await client.query(
        `SELECT rm.resultado, d.nivelpeligro
         FROM resultado_maquina rm
         LEFT JOIN resultado_maquina_defectos rmd ON rm.id = rmd.resultado_maquina_id
         LEFT JOIN defecto d ON rmd.defectos_id = d.id
         WHERE rm.inspeccion_nrodocumentoinspeccion = $1`,
        [nroInspeccion]
      );

      let resultadoFinal = 'A';
      const tieneMaquinaD = rmRes.rows.some(r => r.resultado === 'D');
      const tieneDefectoGrave = rmRes.rows.some(r => r.nivelpeligro === 'Grave' || r.nivelpeligro === 'Muy Grave');
      if (tieneMaquinaD || tieneDefectoGrave) {
        resultadoFinal = 'D';
      }

      // ── PASO 7A: Si Aprobado → Generar Certificado ─────────────────────
      let nrodocumentocertificado = null;
      let nrodocumentoinforme = null;

      if (resultadoFinal === 'A') {
        // Validar que no exista certificado previo
        const certExistenteRes = await client.query(
          `SELECT COUNT(*) AS total FROM certificado WHERE inspeccion_nrodocumentoinspeccion = $1`,
          [nroInspeccion]
        );
        if (parseInt(certExistenteRes.rows[0].total) > 0) {
          throw { statusCode: 409, message: 'Ya existe un certificado para esta inspección. No se puede consolidar nuevamente.' };
        }

        // Bloquear serie de certificado
        const serieRes = await client.query(
          `SELECT sd.id as sd_id, sd.nroactual,
                  sdb.codigoproveedor,
                  p.keymtc
           FROM seriedocumento sd
           JOIN seriedocumentobase sdb ON sdb.planta_key = sd.planta_key
           JOIN planta p ON p.key = sd.planta_key
           WHERE sd.planta_key = $1
             AND sd.linea_key = $2
           FOR UPDATE`,
          [planta_key, linea_key]
        );

        if (serieRes.rows.length === 0) {
          throw { statusCode: 500, message: `No se encontró la serie de certificado para planta '${planta_key}' y línea '${linea_key}'.` };
        }

        const serie = serieRes.rows[0];
        const nuevoNro = parseInt(serie.nroactual) + 1;

        // Incrementar correlativo
        await client.query(
          `UPDATE seriedocumento SET nroactual = $1 WHERE id = $2`,
          [nuevoNro, serie.sd_id]
        );

        // Armar nrodocumentocertificado con formato PROV-MTC-000000001
        nrodocumentocertificado = `${serie.codigoproveedor}-${serie.keymtc}-${String(nuevoNro).padStart(9, '0')}`;

        // Insertar certificado
        await client.query(
          `INSERT INTO certificado (
             nrodocumentocertificado,
             inspeccion_nrodocumentoinspeccion,
             nrohojavalorada,
             estado,
             anulado,
             fechcreacion,
             usuariocreacion_username
           ) VALUES ($1, $2, $3, true, false, NOW(), $4)`,
          [nrodocumentocertificado, nroInspeccion, nrodocumentocertificado, usuarioConsolidadorUsername]
        );

      // ── PASO 7B: Si Desaprobado → Generar Nro Informe ──────────────────
      } else {
        // Bloquear serie de informe
        const serieInfRes = await client.query(
          `SELECT id, nroactualinforme
           FROM seriedocumentobase
           WHERE planta_key = $1
           FOR UPDATE`,
          [planta_key]
        );

        if (serieInfRes.rows.length === 0) {
          throw { statusCode: 500, message: `No se encontró la serie de informes para planta '${planta_key}'.` };
        }

        const serieInf = serieInfRes.rows[0];
        const nuevoInforme = parseInt(serieInf.nroactualinforme) + 1;

        // Incrementar correlativo
        await client.query(
          `UPDATE seriedocumentobase SET nroactualinforme = $1 WHERE id = $2`,
          [nuevoInforme, serieInf.id]
        );

        nrodocumentoinforme = String(nuevoInforme);
      }

      // ── PASO 8: UPDATE final de inspección ─────────────────────────────
      await client.query(
        `UPDATE inspeccion SET
           inspeccionestado_key = 'CON',
           posicion = 14,
           fechconsolidado = NOW(),
           fechiniciovigencia = NOW(),
           resultado = $1,
           usuarioconsolidado_username = $2,
           usuarioingcertificador_username = $3,
           nrodocumentoinforme = $4,
           observacion = $5,
           fechmodi = NOW()
         WHERE nrodocumentoinspeccion = $6`,
        [
          resultadoFinal,
          usuarioConsolidadorUsername,
          ingenieroCertificadorUsername,
          nrodocumentoinforme,  // NULL si A
          observacion || null,
          nroInspeccion
        ]
      );

      await client.query('COMMIT');

      // ── RESPUESTA EXITOSA ───────────────────────────────────────────────
      const mensaje = resultadoFinal === 'A'
        ? 'Inspección consolidada correctamente con certificado.'
        : 'Inspección consolidada correctamente con informe desaprobado.';

      return {
        ok: true,
        nrodocumentoinspeccion: nroInspeccion,
        estado: 'CON',
        posicion: 14,
        resultadoFinal,
        nrodocumentocertificado,
        nrodocumentoinforme,
        mensaje
      };

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async guardarResultadoMaquina(payload) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 5. Normalización y validación básica
      const nroInspeccion = payload.nroInspeccion;
      const resMaq = payload.resultadoMaquina;
      if (!nroInspeccion || !resMaq || !resMaq.maquina || !resMaq.maquina.id) {
        throw Object.assign(new Error('Payload incompleto: nroInspeccion o maquina.id faltante.'), { statusCode: 400 });
      }
      
      const maquinaId = resMaq.maquina.id;
      const resultado = resMaq.resultado;
      
      // 6. Validar resultado
      if (resultado !== 'A' && resultado !== 'D') {
        throw Object.assign(new Error('Resultado inválido. Solo se permite A o D.'), { statusCode: 400 });
      }

      // 2. Buscar inspección con bloqueo
      const inspRes = await client.query(`
        SELECT nrodocumentoinspeccion, posicion, inspeccionestado_key, fechconsolidado 
        FROM inspeccion 
        WHERE nrodocumentoinspeccion = $1 
        FOR UPDATE
      `, [nroInspeccion]);

      if (inspRes.rows.length === 0) {
        throw Object.assign(new Error('Inspección no encontrada.'), { statusCode: 404 });
      }
      const insp = inspRes.rows[0];

      // 3. Validaciones de inspección
      if (insp.inspeccionestado_key === 'CON' || insp.inspeccionestado_key === 'ANU' || insp.inspeccionestado_key === 'RETIRADO') {
        throw Object.assign(new Error(`Inspección no válida para recibir máquinas (Estado actual: ${insp.inspeccionestado_key}).`), { statusCode: 409 });
      }
      if (insp.fechconsolidado !== null) {
        throw Object.assign(new Error('Inspección ya consolidada (fechconsolidado no es null).'), { statusCode: 409 });
      }
      if (insp.posicion < 5) {
        throw Object.assign(new Error(`Posición inválida para recibir máquinas. Posición actual: ${insp.posicion}`), { statusCode: 409 });
      }
      if (insp.posicion >= 14) {
        throw Object.assign(new Error('La inspección ya está en posición 14 o superior (lista para consolidar).'), { statusCode: 409 });
      }

      // 7. Validar máquina
      const maqRes = await client.query('SELECT tipomaquina_key FROM maquina WHERE id = $1', [maquinaId]);
      if (maqRes.rows.length === 0) {
        throw Object.assign(new Error('Máquina no encontrada.'), { statusCode: 404 });
      }

      // 8. Upsert sin UNIQUE
      const existRes = await client.query(`
        SELECT id 
        FROM resultado_maquina 
        WHERE inspeccion_nrodocumentoinspeccion = $1 
          AND maquina_id = $2 
        FOR UPDATE
      `, [nroInspeccion, maquinaId]);

      if (existRes.rows.length > 0) {
        const oldId = existRes.rows[0].id;
        await client.query('DELETE FROM resultado_maquina_defecto WHERE resultado_maquina_id = $1', [oldId]);
        await client.query('DELETE FROM resultado_maquina WHERE id = $1', [oldId]);
      }

      // 9. Insert resultado_maquina
      const nextIdRes = await client.query("SELECT nextval('hibernate_sequence') AS id");
      const nextId = nextIdRes.rows[0].id;

      const fechainicio = resMaq.fechainicio || new Date();
      const fechafin = resMaq.fechafin || new Date();
      const data = resMaq.data || null;
      const postdata = resMaq.postdata || null;
      const foto = resMaq.foto || null;
      const defectos = resMaq.defectos || [];

      await client.query(`
        INSERT INTO resultado_maquina (
          id, estado, fechcreacion, fechmodi, data, postdata, f,
          fechafin, fechainicio, foto, insp_visual, manual, resultado,
          usuariocreacion_username, usuariomodi_id, maquina_id, inspeccion_nrodocumentoinspeccion
        ) VALUES (
          $1, true, NOW(), NOW(), $2, $3, false,
          $4, $5, $6, 0, false, $7,
          'sistema', null, $8, $9
        )
      `, [
        nextId, data, postdata, fechafin, fechainicio, foto, resultado, maquinaId, nroInspeccion
      ]);

      // 10. Defectos
      if (Array.isArray(defectos) && defectos.length > 0) {
        for (const def of defectos) {
          const defId = typeof def === 'object' ? def.id : def;
          if (!defId) continue;
          
          const defRes = await client.query('SELECT id FROM defecto WHERE id = $1', [defId]);
          if (defRes.rows.length > 0) {
            await client.query(`
              INSERT INTO resultado_maquina_defecto (resultado_maquina_id, defectos_id)
              VALUES ($1, $2)
            `, [nextId, defId]);
          }
        }
      }

      // 11. Revalidar etapa
      const validacion = await ValidarEtapaService.validarEtapa(nroInspeccion, client);

      // 12. Si aún faltan pruebas
      if (validacion.faltantes.length > 0) {
        await client.query('COMMIT');
        return {
          ok: true,
          nrodocumentoinspeccion: nroInspeccion,
          resultadoMaquinaId: nextId,
          posicionActual: insp.posicion,
          modo: 'LINEA_EN_PROCESO',
          recibidas: validacion.recibidas,
          faltantes: validacion.faltantes,
          noAplicables: validacion.noAplicables,
          puedeConsolidar: false
        };
      }

      // 13. Si ya no faltan pruebas
      const hasD = validacion.recibidas.some(r => r.resultado === 'D');
      const resultadoPreliminar = hasD ? 'D' : 'A';

      await client.query(`
        UPDATE inspeccion 
        SET posicion = 14, 
            resultado = $1, 
            fechmodi = NOW() 
        WHERE nrodocumentoinspeccion = $2
      `, [resultadoPreliminar, nroInspeccion]);

      await client.query('COMMIT');

      // 14. Respuesta esperada (posición 14)
      return {
        ok: true,
        nrodocumentoinspeccion: nroInspeccion,
        resultadoMaquinaId: nextId,
        posicionActual: 14,
        modo: 'LISTA_PARA_CONSOLIDAR',
        faltantes: [],
        puedeConsolidar: true
      };

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async cambiarObservacion(nroInspeccion, observacion) {
    const inspeccionRes = await db.query(
      `SELECT nrodocumentoinspeccion, posicion, inspeccionestado_key
       FROM inspeccion
       WHERE nrodocumentoinspeccion = $1`,
      [nroInspeccion]
    );

    if (inspeccionRes.rows.length === 0) {
      const error = new Error('Inspección no encontrada');
      error.statusCode = 404;
      throw error;
    }

    const inspeccion = inspeccionRes.rows[0];

    // Validar estado y posición
    if (inspeccion.posicion < 14) {
      const error = new Error('No se puede cambiar observación de una inspección en proceso');
      error.statusCode = 409;
      throw error;
    }

    if (inspeccion.inspeccionestado_key !== 'CON') {
      const error = new Error('Solo se puede cambiar la observación de inspecciones consolidadas (CON)');
      error.statusCode = 409;
      throw error;
    }

    // Actualizar observación
    await db.query(
      `UPDATE inspeccion
       SET observacion = $1, fechmodi = NOW()
       WHERE nrodocumentoinspeccion = $2`,
      [observacion || '', nroInspeccion]
    );

    return {
      nrodocumentoinspeccion: nroInspeccion,
      observacion: observacion || ''
    };
  }

  async guardarDatosConsolidacion(nroInspeccion, ingenieroCertificadorUsername, observacion) {
    await db.query(
      `UPDATE inspeccion
       SET usuarioingcertificador_username = $1,
           observacion = COALESCE($2, observacion),
           fechmodi = NOW()
       WHERE nrodocumentoinspeccion = $3`,
      [ingenieroCertificadorUsername || null, observacion, nroInspeccion]
    );
    return { success: true };
  }

  async modificarPropietario(nroInspeccion, payload, usuario) {
    const {
      sinDni, nroDocumento, nombres, apellidos, razonSocial,
      pais, departamento, provincia, distrito, direccion, email, telefono
    } = payload;

    const docFinal = sinDni ? '00000000' : (nroDocumento || '00000000');

    // UPSERT persona
    const queryPersona = `
      INSERT INTO persona (
        nrodocumentoidentidad, nombrerazonsocial, nombres, apellidos,
        pais_key, departamento_key, provincia_key, distrito_key,
        direccion, email, telefono, fechcreacion, estado
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), true)
      ON CONFLICT (nrodocumentoidentidad) 
      DO UPDATE SET 
        nombrerazonsocial = COALESCE(EXCLUDED.nombrerazonsocial, persona.nombrerazonsocial),
        nombres = COALESCE(EXCLUDED.nombres, persona.nombres),
        apellidos = COALESCE(EXCLUDED.apellidos, persona.apellidos),
        pais_key = EXCLUDED.pais_key,
        departamento_key = EXCLUDED.departamento_key,
        provincia_key = EXCLUDED.provincia_key,
        distrito_key = EXCLUDED.distrito_key,
        direccion = EXCLUDED.direccion,
        email = EXCLUDED.email,
        telefono = EXCLUDED.telefono,
        fechmodi = NOW()
    `;

    await db.query(queryPersona, [
      docFinal,
      (sinDni ? 'CLIENTES VARIOS' : (razonSocial || null)),
      (sinDni ? 'CLIENTES VARIOS' : (nombres || null)),
      apellidos || null,
      pais || null, departamento || null, provincia || null, distrito || null,
      direccion || null, email || null, telefono || null
    ]);

    // Obtener tarjetapropiedad_id para actualizar
    const checkQuery = `
      SELECT v.tarjetapropiedad_id
      FROM inspeccion i
      LEFT JOIN vehiculo v ON i.vehiculo_nromotor = v.nromotor
      WHERE i.nrodocumentoinspeccion = $1
    `;
    const check = await db.query(checkQuery, [nroInspeccion]);
    if (check.rows.length === 0) throw new Error('Inspección no encontrada');
    
    const tpId = check.rows[0].tarjetapropiedad_id;
    if (tpId) {
      await db.query(`
        UPDATE tarjetapropiedad 
        SET propietario_nrodocumentoidentidad = $1
        WHERE id = $2
      `, [docFinal, tpId]);
    }

    return { success: true, docFinal };
  }

  async registrarPoliza(nroInspeccion, data) {
    // 1. Obtener nromotor
    const checkQuery = `SELECT vehiculo_nromotor FROM inspeccion WHERE nrodocumentoinspeccion = $1`;
    const check = await db.query(checkQuery, [nroInspeccion]);
    if (check.rows.length === 0) throw new Error('Inspección no encontrada');
    const nroMotor = check.rows[0].vehiculo_nromotor;

    // 2. Actualizar vehículo (soat, aseguradora, tipopoliza)
    // data must have { aseguradora, tipoPoliza, nroPoliza, fechaInicio, fechaFin }
    await db.query(
      `UPDATE vehiculo
       SET nrosoat = $1,
           aseguradora_key = $2,
           tipopoliza_key = $3,
           fechfinsoat = $4,
           fechainiciosoat = $5
       WHERE nromotor = $6`,
      [data.nroPoliza || null, data.aseguradora || null, data.tipoPoliza || null, data.fechaFin || null, data.fechaInicio || null, nroMotor]
    );

    // 3. También actualizar en inspeccion (si es necesario)
    // inspeccion has tipopoliza_key, tipoautorizacion_key, etc.
    await db.query(
      `UPDATE inspeccion SET tipopoliza_key = $1 WHERE nrodocumentoinspeccion = $2`,
      [data.tipoPoliza || null, nroInspeccion]
    );

    return { success: true };
  }

  async cambiarLinea(nroInspeccion, lineaKey) {
    if (!lineaKey) throw new Error('Debe proporcionar la nueva línea');
    await db.query(
      `UPDATE comprobante
       SET linea_key = $1
       WHERE inspeccion_nrodocumentoinspeccion = $2`,
      [lineaKey, nroInspeccion]
    );
    return { success: true, lineaKey };
  }

  async cambiarMotor(nroInspeccion, nroMotor) {
    if (!nroMotor) throw new Error('Debe proporcionar el nuevo motor');
    const checkQuery = `SELECT vehiculo_nromotor FROM inspeccion WHERE nrodocumentoinspeccion = $1`;
    const check = await db.query(checkQuery, [nroInspeccion]);
    if (check.rows.length === 0) throw new Error('Inspección no encontrada');
    
    const oldMotor = check.rows[0].vehiculo_nromotor;

    // If changing engine, we might need to update vehiculo table or just change the reference
    // Let's assume the user means "corregir el número de motor" of the current vehicle.
    await db.query(`UPDATE vehiculo SET nromotor = $1 WHERE nromotor = $2`, [nroMotor, oldMotor]);
    await db.query(`UPDATE inspeccion SET vehiculo_nromotor = $1 WHERE nrodocumentoinspeccion = $2`, [nroMotor, nroInspeccion]);
    
    return { success: true, nroMotor };
  }

  async cambiarFirma(nroInspeccion, ingenieroCertificadorUsername) {
    if (!ingenieroCertificadorUsername) throw new Error('Debe proporcionar el ingeniero certificador');
    await db.query(
      `UPDATE inspeccion
       SET usuarioingcertificador_username = $1,
           fechmodi = NOW()
       WHERE nrodocumentoinspeccion = $2`,
      [ingenieroCertificadorUsername, nroInspeccion]
    );
    return { success: true, ingenieroCertificadorUsername };
  }

  async cambiarFoto(nroInspeccion, tipoFoto, file, username) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const tipoMaquinaMap = { 'GASES': '11', 'LUCES': '12', 'FRENOS': '13' }; // Podría ser 15 también, pero 13 es estándar
      const tipoMaquinaKey = tipoMaquinaMap[tipoFoto] || '11';
      
      const hexFoto = file.buffer.toString('hex');

      // Buscar si existe el resultado exacto (ignorar sufijo M para la inserción, usar el real)
      const resQuery = await client.query(`
        SELECT rm.id, rm.data, rm.inspeccion_nrodocumentoinspeccion 
        FROM resultado_maquina rm
        JOIN maquina m ON m.id = rm.maquina_id
        WHERE rm.inspeccion_nrodocumentoinspeccion LIKE $1 || '%' AND m.tipomaquina_key IN ('11','12','13','15')
      `, [nroInspeccion]);
      
      let rmToUpdate = resQuery.rows.find(r => 
        (tipoFoto === 'GASES' && r.data && r.data.tipoMaquina === '11') ||
        (tipoFoto === 'LUCES' && r.data && r.data.tipoMaquina === '12') ||
        (tipoFoto === 'FRENOS' && r.data && (r.data.tipoMaquina === '13' || r.data.tipoMaquina === '15'))
      );
      
      // Si el JSON no tiene tipoMaquina, filtramos por la BD
      if (!rmToUpdate && resQuery.rows.length > 0) {
          const rmCheck = await client.query(`
            SELECT rm.id, rm.data, rm.inspeccion_nrodocumentoinspeccion 
            FROM resultado_maquina rm
            JOIN maquina m ON m.id = rm.maquina_id
            WHERE rm.inspeccion_nrodocumentoinspeccion LIKE $1 || '%' AND m.tipomaquina_key = $2
          `, [nroInspeccion, tipoMaquinaKey]);
          if(rmCheck.rows.length > 0) rmToUpdate = rmCheck.rows[0];
      }

      if (rmToUpdate) {
        // UPDATE
        let dataJson = rmToUpdate.data || {};
        dataJson.foto = hexFoto;
        
        await client.query(`
          UPDATE resultado_maquina
          SET data = $1, fechainicio = NOW(), fechafin = NOW(), resultado = 'A',
              estado = true, manual = true, fechmodi = NOW()
          WHERE id = $2
        `, [dataJson, rmToUpdate.id]);
      } else {
        // INSERT
        // Obtener la línea de la inspección
        const compRes = await client.query(`SELECT linea_key FROM comprobante WHERE inspeccion_nrodocumentoinspeccion = $1 ORDER BY id DESC LIMIT 1`, [nroInspeccion]);
        const lineaKey = compRes.rows.length > 0 ? compRes.rows[0].linea_key : null;
        
        // Obtener un maquina_id válido
        const maqRes = await client.query(`
          SELECT m.id FROM maquina m
          JOIN linea_etapa_maquina lem ON lem.maquinas_id = m.id
          JOIN linea_etapa le ON le.id = lem.lineaetapa_id
          WHERE m.tipomaquina_key = $1 AND le.linea_key = $2 LIMIT 1
        `, [tipoMaquinaKey, lineaKey]);
        
        if (maqRes.rows.length === 0) throw new Error('No se encontró máquina configurada para este tipo y línea.');
        const maquinaId = maqRes.rows[0].id;
        
        const nextIdRes = await client.query(`SELECT nextval('hibernate_sequence') as id`);
        const newId = nextIdRes.rows[0].id;
        
        const dataJson = { foto: hexFoto, tipoMaquina: tipoMaquinaKey };
        
        await client.query(`
          INSERT INTO resultado_maquina (
            id, inspeccion_nrodocumentoinspeccion, maquina_id, fechainicio, fechafin,
            data, resultado, estado, manual, fechcreacion
          ) VALUES ($1, $2, $3, NOW(), NOW(), $4, 'A', true, true, NOW())
        `, [newId, nroInspeccion, maquinaId, dataJson]);
      }
      
      // Actualizar inspección a FOTO (16) y PROCESO
      await client.query(`
        UPDATE inspeccion 
        SET posicion = 16, resultado = null, inspeccionestado_key = 'PROCESO', fechmodi = NOW()
        WHERE nrodocumentoinspeccion = $1
      `, [nroInspeccion]);
      
      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async reiniciarFoto(nroInspeccion, tipoFoto) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const tipoMaquinaMap = { 'GASES': '11', 'LUCES': '12', 'FRENOS': '13' };
      const tipoMaquinaKey = tipoMaquinaMap[tipoFoto] || '11';
      
      // Encontrar el ID
      const resQuery = await client.query(`
        SELECT rm.id FROM resultado_maquina rm
        JOIN maquina m ON m.id = rm.maquina_id
        WHERE rm.inspeccion_nrodocumentoinspeccion LIKE $1 || '%' AND m.tipomaquina_key IN ($2, '15')
      `, [nroInspeccion, tipoMaquinaKey]);
      
      for (let row of resQuery.rows) {
        // FK constraint safe delete
        await client.query(`DELETE FROM resultado_maquina_defecto WHERE resultado_maquina_id = $1`, [row.id]);
        await client.query(`DELETE FROM resultado_maquina WHERE id = $1`, [row.id]);
      }
      
      // Mapear posición (GASES -> 5, LUCES -> 7, FRENOS -> 11)
      const posMap = { 'GASES': 5, 'LUCES': 7, 'FRENOS': 11 };
      const posicion = posMap[tipoFoto] || 16;
      
      await client.query(`
        UPDATE inspeccion 
        SET posicion = $1, resultado = null, inspeccionestado_key = 'PROCESO', fechmodi = NOW()
        WHERE nrodocumentoinspeccion = $2
      `, [posicion, nroInspeccion]);
      
      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async reiniciarPrueba(nroInspeccion, resultadoMaquinaId, tipoMaquinaKey) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query(`DELETE FROM resultado_maquina_defecto WHERE resultado_maquina_id = $1`, [resultadoMaquinaId]);
      await client.query(`DELETE FROM resultado_maquina WHERE id = $1`, [resultadoMaquinaId]);
      
      // Mapeo legacy
      let posicion = 11; // FRENOMETRO por defecto
      if (['4', '5'].includes(tipoMaquinaKey)) posicion = 5; // GASES
      else if (['6'].includes(tipoMaquinaKey)) posicion = 9; // SONOMETRO
      else if (['7'].includes(tipoMaquinaKey)) posicion = 7; // LUCES
      else if (['9'].includes(tipoMaquinaKey)) posicion = 8; // INSPECCION_VISUAL
      else if (['10'].includes(tipoMaquinaKey)) posicion = 10; // PROFUNDIMETRO
      
      await client.query(`
        UPDATE inspeccion 
        SET posicion = $1, resultado = null, inspeccionestado_key = 'PROCESO', fechmodi = NOW()
        WHERE nrodocumentoinspeccion = $2
      `, [posicion, nroInspeccion]);
      
      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async generarPreVisualizacionHtml(nroInspeccion) {
    const data = await this.getWizardModel(nroInspeccion);
    if (!data || !data.vehiculo) {
      throw new Error("No se encontró data de la inspección.");
    }

    const { inspeccion, vehiculo, propietario, resultadosMaquinaRaw } = data;

    // 1. Obtener imagen de vehículo (Foto) de los resultados (PASO A)
    let base64Photo = '';
    try {
      if (resultadosMaquinaRaw && resultadosMaquinaRaw.length > 0) {
        for (const rm of resultadosMaquinaRaw) {
          if (rm.tipoMaquinaKey === '13' || rm.tipoMaquinaKey === '15') {
            if (rm.data && rm.data.foto) {
               const hex = rm.data.foto;
               const b64 = Buffer.from(hex, 'hex').toString('base64');
               base64Photo = `data:image/jpeg;base64,${b64}`;
               break;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[PREVIEW_FOTO_VEHICULO_WARN]', e.message);
      base64Photo = '';
    }

    // 2. Obtener firma y datos extra con query aislado (PASO B)
    let firmaBase64 = '';
    let extra = {};
    try {
      const extraRes = await db.query(`
         SELECT i.vigencia, i.fechvencimiento, i.nrodocumentoinforme, 
                tc.nombre as tipocertificadonombre, tc.cuerpocertificado, ta.ambito,
                cert.nrohojavalorada, u.firmacertificador,
                pl.direccion as plantadireccion, emp.nombre as empresanombre, emp.telefono as empresatelefono,
                c.importetotal,
                v.color, carr.nombre as carrocerianombre, mcarr.nombre as marcacarrocerianombre
         FROM inspeccion i
         LEFT JOIN tipocertificado tc ON i.tipocertificado_key = tc.key
         LEFT JOIN tipoautorizacion ta ON i.tipoautorizacion_key = ta.key
         LEFT JOIN certificado cert ON cert.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
         LEFT JOIN usuario u ON u.username = i.usuarioingcertificador_username
         LEFT JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
         LEFT JOIN linea l ON l.key = c.linea_key
         LEFT JOIN planta pl ON pl.key = l.planta_key
         LEFT JOIN empresacertificadora emp ON emp.key = pl.empresacertificadora_key
         LEFT JOIN vehiculo v ON v.nromotor = i.vehiculo_nromotor
         LEFT JOIN carroceria carr ON v.carroceria_key = carr.key
         LEFT JOIN marcacarroceria mcarr ON v.marcacarroceria_key = mcarr.key
         WHERE i.nrodocumentoinspeccion = $1
         ORDER BY c.id DESC NULLS LAST LIMIT 1
      `, [nroInspeccion]);
      if (extraRes.rows.length > 0) {
         extra = extraRes.rows[0];
         if (extra.firmacertificador) {
            firmaBase64 = extra.firmacertificador;
            if (!firmaBase64.startsWith('data:')) {
               firmaBase64 = `data:image/png;base64,${firmaBase64}`;
            }
         }
      }
    } catch (e) {
      console.warn('[PREVIEW_EXTRA_WARN]', e.message);
    }

    // 3. Cargar el template HTML robustamente
    const templatePath = path.resolve(process.cwd(), 'templates', 'certificado_inspeccion.html');
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template no encontrado en la ruta: ${templatePath}`);
    }
    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

    // 4. Inyectar imágenes dinámicas en el HTML crudo antes de limpiar Freemarker
    if (base64Photo) {
       htmlTemplate = htmlTemplate.replace(/\$\{image\}/g, base64Photo);
    } else {
       // Si no hay foto, reemplazamos el tag de img con vacio para que no quede roto
       htmlTemplate = htmlTemplate.replace(/<img[^>]*src="\$\{image\}"[^>]*>/g, '');
    }

    if (firmaBase64) {
       htmlTemplate = htmlTemplate.replace(/\$\{widthCertificado\}/g, 'style="width: 100% !important; max-width: none !important; margin-top: 20px;"');
       htmlTemplate = htmlTemplate.replace(/\$\{firmaCertificador\}/g, firmaBase64);
    } else {
       htmlTemplate = htmlTemplate.replace(/<img[^>]*src="\$\{firmaCertificador\}"[^>]*>/g, '');
    }

    // Convertir imágenes de assets a inline base64 con validación (PASO C)
    const getAssetBase64 = (filename) => {
      try {
        const filepath = path.resolve(process.cwd(), 'templates', 'img', filename);
        const exists = fs.existsSync(filepath);
        if (!exists) {
           console.warn('[PREVIEW_ASSET_MISSING]', filepath);
           return '';
        }
        const ext = path.extname(filename).replace('.', '');
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        const b64 = fs.readFileSync(filepath, 'base64');
        return `data:image/${mime};base64,${b64}`;
      } catch (e) {
        console.warn('[PREVIEW_ASSET_WARN]', filename, e.message);
        return '';
      }
    };

    htmlTemplate = htmlTemplate.replace(/\.\.\/img\/sello_resolucion\.png/g, getAssetBase64('sello_resolucion.png'));
    htmlTemplate = htmlTemplate.replace(/\.\.\/img\/sello_farenet\.png/g, getAssetBase64('sello_farenet.png'));
    htmlTemplate = htmlTemplate.replace(/\.\.\/img\/sello_retica\.png/g, getAssetBase64('sello_retica.png'));
    htmlTemplate = htmlTemplate.replace(/\.\.\/img\/fondo_cert2\.png/g, getAssetBase64('fondo_cert2.png'));
    htmlTemplate = htmlTemplate.replace(/\.\.\/img\/fondocert_U\.png/g, getAssetBase64('fondocert_U.png'));

    // Remover directivas Freemarker sobrantes
    htmlTemplate = htmlTemplate
      .replace(/<#assign[\s\S]*?>/g, '')
      .replace(/<#if[\s\S]*?>/g, '')
      .replace(/<#else>/g, '')
      .replace(/<\/#if>/g, '')
      .replace(/<#list[\s\S]*?>/g, '')
      .replace(/<\/#list>/g, '')
      .replace(/\$\{[^}]+\}/g, '');

    const $ = cheerio.load(htmlTemplate);

    // Inyectar CSS override al HTML antes de devolverlo
    const styleOverride = `
      <style>
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
          width: 100% !important;
          min-width: 1800px !important;
          overflow: auto !important;
        }

        table {
          border-collapse: collapse;
        }

        .certificado-inspeccion {
          width: 1800px !important;
          height: auto !important;
          margin: 0 !important;
          padding: 20px !important;
          max-width: none !important;
        }

        .certificate-preview-root {
          width: 1800px !important;
          min-width: 1800px !important;
        }
      </style>
    `;
    if ($('head').length > 0) {
      $('head').append(styleOverride);
    } else {
      $('body').prepend(styleOverride);
    }

    // Helpers
    const safe = (value) => {
      if (value === null || value === undefined) return '';
      return String(value);
    };

    const setLocation = ($, location, value) => {
      const el = $(`[location="${location}"]`);
      if (el.length > 0) {
        el.html(safe(value));
      }
    };

    const isAprobado = inspeccion?.resultado === 'A';
    
    // Formateadores
    const formatD = (d) => d ? new Date(d).toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric'}) : '';
    const formatT = (d) => d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }) : '';

    // CAPA 3 y 5: Llenar campos básicos (Sin queries gigantes)
    setLocation($, 'nroDocu', isAprobado ? "Certificado N°: " : "Informe N°: ");
    setLocation($, 'fecha', formatD(inspeccion?.fechiniciovigencia || inspeccion?.fechcreacion));
    setLocation($, 'hora', formatT(inspeccion?.fechiniciovigencia || inspeccion?.fechcreacion));
    setLocation($, 'resultadoCertificado', isAprobado ? "APROBADO" : "DESAPROBADO");
    
    // Fallbacks si falta data para que no rompa
    setLocation($, 'nroHojaValorada', extra.nrohojavalorada ? `Hoja Valorada: ${extra.nrohojavalorada}` : '');
    setLocation($, 'vigenciaCertificado', extra.vigencia || inspeccion?.vigencia || '');
    setLocation($, 'fechaProximaInspeccion', formatD(extra.fechvencimiento));
    setLocation($, 'tipocertificado', extra.tipocertificadonombre || '');
    setLocation($, 'tipoautorizacion', extra.ambito || '');
    const cuerpo = `${safe(extra.ambito)} ${safe(extra.cuerpocertificado)} ${safe(extra.nrodocumentoinforme)}`.trim();
    setLocation($, 'tipocertificadocuerpo', cuerpo);
    setLocation($, 'informeInspeccionNro', extra.nrodocumentoinforme || safe(inspeccion?.nrodocumentoinforme));
    setLocation($, 'direccionPlLugar', extra.plantadireccion ? `Domicilio Local: ${extra.plantadireccion}` : '');
    setLocation($, 'empresa', extra.empresanombre || '');
    setLocation($, 'telefonoEmpresa', extra.empresatelefono ? `Teléfono: ${extra.empresatelefono}` : '');
    setLocation($, 'claseautorizacionText', "CLASE DE AUTORIZACIÓN");
    setLocation($, 'strFechInspeccion', "Fecha Inspección:");
    setLocation($, 'fechaInicioVigencia', formatD(inspeccion?.fechiniciovigencia || inspeccion?.fechcreacion));
    setLocation($, 'certificadoStr', isAprobado ? "CERTIFICADO DE INSPECCIÓN TÉCNICA VEHICULAR" : "");
    setLocation($, 'informeStr', !isAprobado ? "INFORME DE INSPECCIÓN TÉCNICA VEHICULAR" : "");
    setLocation($, 'tituloExtraordinario', ''); 
    setLocation($, 'observacionExtraordinario', ''); 
    setLocation($, 'resolucion', ''); // El sello está de background
    if (extra.importetotal) setLocation($, 'costo', `S/ ${Number(extra.importetotal).toFixed(2)}`);

    if (propietario) {
      setLocation($, 'propietario', propietario.nombrecompleto);
    }
    
    if (vehiculo) {
      setLocation($, 'placa', vehiculo.placa);
      setLocation($, 'combustible', vehiculo.combustible);
      setLocation($, 'asientos-pasajeros', `${safe(vehiculo.nroasientos)}/${safe(vehiculo.nropasajeros)}`);
      setLocation($, 'categoria', vehiculo.categoria);
      setLocation($, 'marca', vehiculo.marca);
      setLocation($, 'modelo', vehiculo.modelo);
      setLocation($, 'motor', vehiculo.nromotor);
      setLocation($, 'nroserie', vehiculo.nroserie);
      setLocation($, 'pesoneto', vehiculo.pesoseco);
      setLocation($, 'pesobruto', vehiculo.pesobruto);
      setLocation($, 'cargautil', vehiculo.cargautil);
      setLocation($, 'aniofabricacion', vehiculo.aniofabricacion);
      setLocation($, 'kilometraje', vehiculo.kilometraje);
      setLocation($, 'dimensiones', `${safe(vehiculo.longitud)} / ${safe(vehiculo.ancho)} / ${safe(vehiculo.alto)}`);
      setLocation($, 'nroejes-nroruedas', `${safe(vehiculo.nroejes)} / ${safe(vehiculo.nroruedas)}`);
      setLocation($, 'colores', extra.color || '');
      setLocation($, 'carroceria', extra.carrocerianombre || '');
      setLocation($, 'marcacarroceria', extra.marcacarrocerianombre || '');
    }

    // CAPA 4: Resultados técnicos (Equipos y Resultados de máquina)
    if (data.resultadosMaquinaRaw && data.resultadosMaquinaRaw.length > 0) {
      for (const rm of data.resultadosMaquinaRaw) {
        const t = String(rm.tipoMaquinaKey);
        let prefix = null;
        const equipoNombre = rm.maquina?.nombreequipo || '';
        const equipoSerie = rm.maquina?.serie || '';
        const equipoDisplay = (equipoNombre || equipoSerie) ? `${equipoNombre}/${equipoSerie}` : '';

        // Asignación de Prefijos y Datos de Equipo
        if (t === '3') {
          prefix = 'frenos-';
          setLocation($, 'frenometro', equipoDisplay);
        }
        if (t === '1') {
          prefix = 'alineamiento-';
          setLocation($, 'alineador', equipoDisplay);
        }
        if (t === '4') { 
          prefix = 'analizador-'; 
          setLocation($, 'analizador', equipoDisplay);
          setLocation($, 'analizador-resultado-final', rm.resultado);
        }
        if (t === '5') { 
          prefix = 'opacimetro-'; 
          setLocation($, 'opacimetro', equipoDisplay);
          setLocation($, 'opacimetro-resultado-final', rm.resultado);
        }
        if (t === '7') {
          prefix = 'luxometro-';
          setLocation($, 'luxometro', equipoDisplay);
        }
        if (t === '2') { 
          prefix = 'suspension-'; 
          setLocation($, 'suspension', equipoDisplay);
          setLocation($, 'suspencion-resultado-final', rm.resultado); // Nota: suspencion- en legacy template
        }
        if (t === '6') { 
          prefix = 'sonometro-'; 
          setLocation($, 'sonometro-resultado-final', rm.resultado);
        }
        if (t === '10') {
          prefix = 'profundimetro-';
        }

        // Parseo e Inyección de la Data Técnica
        if (prefix && rm.data) {
          let jsonData = rm.data;
          if (typeof jsonData === 'string') {
            try {
              jsonData = JSON.parse(jsonData);
            } catch (e) {
              continue; // Saltar si falla el parseo, no romper todo
            }
          }

          if (typeof jsonData === 'object') {
            for (const [key, val] of Object.entries(jsonData)) {
              let strVal = String(val);
              // Para redondear decimales o dejarlos enteros
              if (typeof val === 'number') {
                strVal = Number.isInteger(val) ? strVal : Number(val).toFixed(2);
              }
              setLocation($, `${prefix}${key}`, strVal);
            }
          }
        }
      }
    }

    return $.html();
  }
  async generarPreVisualizacionHtml(nroInspeccion) {
    const templatePath = path.resolve(process.cwd(), 'templates', 'certificado_inspeccion.html');
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Plantilla no encontrada: ${templatePath}`);
    }

    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

    // PASO 5: Condicionales mínimos con parser seguro
    const renderFreemarkerCondition = (html, conditionName, value) => {
      const openTagStart = '<#if ';
      const elseTag = '<#else>';
      const closeTag = '</#if>';
      
      let out = "";
      let i = 0;
      while(i < html.length) {
        let nextOpen = html.indexOf(openTagStart, i);
        if (nextOpen === -1) {
           out += html.slice(i);
           break;
        }
        
        let tagEnd = html.indexOf(">", nextOpen);
        if (tagEnd === -1) {
           out += html.slice(i);
           break;
        }
        
        let tagContent = html.slice(nextOpen + 5, tagEnd).trim();
        let isOurCondition = tagContent.startsWith(conditionName);
        
        if (!isOurCondition) {
           out += html.slice(i, tagEnd + 1);
           i = tagEnd + 1;
           continue;
        }
        
        let isCheckingFalse = tagContent.includes("false");
        let matches = isCheckingFalse ? !value : !!value;
        
        let nest = 1;
        let j = tagEnd + 1;
        let endIfPos = -1;
        let elsePos = -1;
        
        while (j < html.length) {
           let nOpen = html.indexOf(openTagStart, j);
           let nElse = html.indexOf(elseTag, j);
           let nClose = html.indexOf(closeTag, j);
           
           if (nClose === -1) break;
           
           let nextEvents = [];
           if (nOpen !== -1) nextEvents.push({type: 'open', pos: nOpen});
           if (nElse !== -1) nextEvents.push({type: 'else', pos: nElse});
           if (nClose !== -1) nextEvents.push({type: 'close', pos: nClose});
           
           nextEvents.sort((a,b) => a.pos - b.pos);
           let ev = nextEvents[0];
           
           if (ev.type === 'open') {
             nest++;
             j = ev.pos + 5;
           } else if (ev.type === 'close') {
             nest--;
             if (nest === 0) {
               endIfPos = ev.pos;
               break;
             }
             j = ev.pos + 6;
           } else if (ev.type === 'else') {
             if (nest === 1) {
               elsePos = ev.pos;
             }
             j = ev.pos + 7;
           }
        }
        
        if (endIfPos !== -1) {
           out += html.slice(i, nextOpen);
           let trueBlock = html.slice(tagEnd + 1, elsePos !== -1 ? elsePos : endIfPos);
           let falseBlock = elsePos !== -1 ? html.slice(elsePos + 7, endIfPos) : "";
           
           let chosenBlock = matches ? trueBlock : falseBlock;
           out += renderFreemarkerCondition(chosenBlock, conditionName, value);
           i = endIfPos + 6;
        } else {
           out += html.slice(i, tagEnd + 1);
           i = tagEnd + 1;
        }
      }
      return out;
    };

    // Queries base
    const inspQ = await db.query('SELECT resultado, fechiniciovigencia FROM inspeccion WHERE nrodocumentoinspeccion = $1', [nroInspeccion]);
    const inspeccion = inspQ.rows[0] || {};
    
    // Obtener data extra basica de vehículo y empresa
    const dataExtraQ = await db.query(`
      SELECT 
        c.nrohojavalorada,
        c.nrodocumentocertificado,
        i.nrodocumentoinforme,
        p.nombre as empresanombre,
        p.telefono as empresatelefono,
        pl.direccion as plantadireccion,
        comp.placamotor as placa, 
        cat.nombre as categoria, 
        v.categoriaextra,
        m.nombre as marca, 
        mod.nombre as modelo, 
        v.aniofabricacion, 
        v.kilometraje, 
        comb.nombre as combustible, 
        v.nroserie, 
        v.nromotor,
        v.nroejes, 
        v.nroruedas, 
        v.nroasientos, 
        v.nropasajeros, 
        v.longitud, 
        v.ancho, 
        v.alto, 
        v.pesoseco, 
        v.pesobruto, 
        v.cargautil,
        col.nombre as color, 
        carr.nombre as carrocerianombre, 
        v.marcacarroceria as marcacarrocerianombre,
        ti.nombre as tipoinspeccionnombre,
        COALESCE(prop.nombrerazonsocial, trim(COALESCE(prop.nombres,'') || ' ' || COALESCE(prop.apellidos,''))) as propietarionombre
      FROM inspeccion i
      LEFT JOIN certificado c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      LEFT JOIN comprobante comp ON comp.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      LEFT JOIN linea l ON l.key = comp.linea_key
      LEFT JOIN planta pl ON pl.key = l.planta_key
      LEFT JOIN empresa p ON p.key = pl.empresacertificadora_key
      LEFT JOIN vehiculo v ON v.nromotor = i.vehiculo_nromotor
      LEFT JOIN categoria cat ON v.categoria_key = cat.key
      LEFT JOIN marca m ON v.marca_key = m.key
      LEFT JOIN modelo mod ON v.modelo_key = mod.key
      LEFT JOIN combustible comb ON v.combustible_key = comb.key
      LEFT JOIN color col ON v.color_key = col.key
      LEFT JOIN carroceria carr ON v.carroceria_key = carr.key
      LEFT JOIN tipoinspeccion ti ON i.tipoinspeccion_key = ti.key
      LEFT JOIN tarjetapropiedad tp ON v.tarjetapropiedad_id = tp.id
      LEFT JOIN persona prop ON tp.propietario_nrodocumentoidentidad = prop.nrodocumentoidentidad
      WHERE i.nrodocumentoinspeccion = $1
      ORDER BY comp.id DESC NULLS LAST LIMIT 1
    `, [nroInspeccion]);
    const extra = dataExtraQ.rows[0] || {};

    const isAprobado = inspeccion.resultado === 'A';
    const hasInspeccion = (isAprobado || extra.nrodocumentocertificado) ? true : false;
    
    // Procesar ramas de Freemarker (para no limpiar a lo bruto y evitar mezcla)
    htmlTemplate = renderFreemarkerCondition(htmlTemplate, 'hasInspeccion', hasInspeccion);
    htmlTemplate = renderFreemarkerCondition(htmlTemplate, 'mostrar2daCara', false);
    
    // Limpiar restos de freemarker sin borrar contenido (solo limpiar variables)
    htmlTemplate = htmlTemplate.replace(/<#if[\s\S]*?>/gi, '');
    htmlTemplate = htmlTemplate.replace(/<\/#if>/gi, '');
    htmlTemplate = htmlTemplate.replace(/<#else>/gi, '');
    htmlTemplate = htmlTemplate.replace(/<#assign[\s\S]*?>/gi, '');
    htmlTemplate = htmlTemplate.replace(/<#list[\s\S]*?>/gi, '');
    htmlTemplate = htmlTemplate.replace(/<\/#list>/gi, '');
    // Inyectar el ancho horizontal del certificado
    htmlTemplate = htmlTemplate.replace(/\$\{widthCertificado\}/g, 'style="width: 100% !important; max-width: none !important; margin-top: 20px;"');

    // Quitar la doble barra de desplazamiento (el height fijo y overflow auto original)
    htmlTemplate = htmlTemplate.replace('</head>', '<style>.certificado-inspeccion { overflow: hidden !important; height: auto !important; }</style></head>');

    // Limpiar el resto de variables Freemarker
    htmlTemplate = htmlTemplate.replace(/\$\{[^}]+\}/g, '');

    const $ = cheerio.load(htmlTemplate);

    const safe = (value) => {
      if (value === null || value === undefined) return '';
      return String(value);
    };

    const setLocation = ($, location, value) => {
      const el = $(`[location="${location}"]`);
      if (el.length > 0) el.html(safe(value));
    };

    const formatD = (d) => d ? new Date(d).toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric'}) : '';

    // Cabecera principal
    setLocation($, 'empresa', extra.empresanombre);
    setLocation($, 'direccionPlLugar', extra.plantadireccion ? 'Domicilio Local: ' + extra.plantadireccion : '');
    setLocation($, 'telefonoEmpresa', extra.empresatelefono ? 'Teléfono: ' + extra.empresatelefono : '');
    setLocation($, 'certificadoStr', hasInspeccion ? "CERTIFICADO DE INSPECCIÓN TÉCNICA VEHICULAR" : "");
    setLocation($, 'informeStr', !hasInspeccion ? "INFORME DE INSPECCIÓN TÉCNICA VEHICULAR" : "");
    setLocation($, 'nroDocu', hasInspeccion ? `Certificado N°: ${extra.nrodocumentocertificado || ''}` : `Informe N°: ${extra.nrodocumentoinforme || ''}`);
    setLocation($, 'nroHojaValorada', extra.nrohojavalorada ? 'Hoja Valorada: ' + extra.nrohojavalorada : '');
    setLocation($, 'fechaInicioVigencia', formatD(inspeccion.fechiniciovigencia));
    setLocation($, 'tipoInspeccion', extra.tipoinspeccionnombre);
    setLocation($, 'informeInspeccionNro', extra.nrodocumentoinforme);

    // Datos de vehículo
    setLocation($, 'propietario', extra.propietarionombre);
    setLocation($, 'placa', extra.placa);
    setLocation($, 'categoria', `${extra.categoria}${extra.categoriaextra ? extra.categoriaextra : ''}`);
    setLocation($, 'marca', extra.marca);
    setLocation($, 'modelo', extra.modelo);
    setLocation($, 'aniofabricacion', extra.aniofabricacion);
    setLocation($, 'kilometraje', extra.kilometraje);
    setLocation($, 'combustible', extra.combustible);
    setLocation($, 'nroserie', extra.nroserie);
    setLocation($, 'motor', extra.nromotor);
    setLocation($, 'carroceria', extra.carrocerianombre); 
    setLocation($, 'marcacarroceria', extra.marcacarrocerianombre); 
    setLocation($, 'nroejes-nroruedas', `${safe(extra.nroejes)} / ${safe(extra.nroruedas)}`);
    setLocation($, 'asientos-pasajeros', `${safe(extra.nroasientos)}/${safe(extra.nropasajeros)}`);
    setLocation($, 'dimensiones', `${safe(extra.longitud)} / ${safe(extra.ancho)} / ${safe(extra.alto)}`);
    setLocation($, 'colores', extra.color); 
    setLocation($, 'pesoneto', extra.pesoseco);
    setLocation($, 'pesobruto', extra.pesobruto);
    setLocation($, 'cargautil', extra.cargautil);

    return $.html();
  }
}

module.exports = new LineaService();
