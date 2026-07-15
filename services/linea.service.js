const db = require('../config/database');
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
    
    return {
      ...estado,
      ...data,
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
}

module.exports = new LineaService();
