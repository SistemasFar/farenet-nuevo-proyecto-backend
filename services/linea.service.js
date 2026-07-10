const db = require('../config/database');
const ValidarEtapaService = require('./validar_etapa.service');

class LineaService {
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

  async obtenerDatosConsolidacion(nroInspeccion) {
    const inspeccionRes = await db.query(
      `SELECT i.nrodocumentoinspeccion, i.posicion, i.inspeccionestado_key, 
              i.resultado, i.fechconsolidado, i.vehiculo_nromotor, i.nrodocumentoinforme,
              i.usuarioconsolidado_username, i.usuarioingcertificador_username, i.observacion,
              cert.nrodocumentocertificado
       FROM inspeccion i
       LEFT JOIN certificado cert ON cert.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
       WHERE i.nrodocumentoinspeccion = $1`,
      [nroInspeccion]
    );

    if (inspeccionRes.rows.length === 0) {
      throw new Error("Inspección no encontrada");
    }
    const inspeccion = inspeccionRes.rows[0];

    const vehiculoRes = await db.query(
      `SELECT c.nombre as categoria, comb.nombre as combustible, m.nombre as marca, mod.nombre as modelo
       FROM vehiculo v 
       JOIN categoria c ON v.categoria_key = c.key
       JOIN combustible comb ON v.combustible_key = comb.key
       LEFT JOIN marca m ON v.marca_key = m.key
       LEFT JOIN modelo mod ON v.modelo_key = mod.key
       WHERE v.nromotor = $1`,
      [inspeccion.vehiculo_nromotor]
    );

    const comprobanteRes = await db.query(
      `SELECT c.nrocomprobante, c.cliente_nrodocumentoidentidad as nrodoc, c.linea_key, c.placamotor, 
              c.importetotal, ci.nombre as concepto_nombre
       FROM comprobante c
       LEFT JOIN conceptoinspeccion ci ON c.conceptoinspeccion_key = ci.key
       WHERE c.inspeccion_nrodocumentoinspeccion = $1
       ORDER BY c.fechcreacion DESC LIMIT 1`,
      [nroInspeccion]
    );

    let clienteData = {};
    if (comprobanteRes.rows.length > 0) {
       const clienteRes = await db.query(
         `SELECT p.nombres, p.apellidos, p.nrodocumentoidentidad
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
      cliente: {
        nombre: ((clienteData.nombres || '') + ' ' + (clienteData.apellidos || '')).trim() || 'Desconocido',
        nroDocumento: clienteData.nrodocumentoidentidad
      },
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

  // Stub — Este método es llamado por el controller de /appresultado (legacy de máquinas).
  // La lógica real está en el endpoint de recepción de máquinas existente.
  async guardarResultadoMaquina(payload) {
    throw new Error('guardarResultadoMaquina: método no implementado en este service. Usar el endpoint de recepción de máquinas.');
  }
}

module.exports = new LineaService();
