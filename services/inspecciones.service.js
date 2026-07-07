const pool = require('../config/database');
const mtcService = require('./mtc.service');
const inspeccionModel = require('../models/inspeccion.model');

const ESTADOS_PERMITIDOS = ['CON', 'ANULADO', 'RETIRADO', 'PROCESO'];

const consultarVehiculoRapido = async (placa) => {
  return await inspeccionModel.consultarVehiculoRapido(placa);
};

const buscarInspecciones = async (filtros) => {
  const {
    plantaKey,
    numeroInspeccion,
    placa,
    comprobante,
    cliente,
    fechaInicio,
    fechaFin,
    estado,
    page,
    pageSize
  } = filtros;

  const limit = Number(pageSize) || 10;
  const currentPage = Number(page) || 1;
  const offset = (currentPage - 1) * limit;

  const params = [];

  let where = `
    WHERE l.planta_key = $1
      AND UPPER(COALESCE(i.inspeccionestado_key, '')) IN ('CON', 'ANULADO', 'RETIRADO', 'PROCESO')
  `;

  params.push(plantaKey);

  if (estado && estado !== 'TODOS') {
    const estadoNormalizado = estado.toUpperCase();

    if (ESTADOS_PERMITIDOS.includes(estadoNormalizado)) {
      params.push(estadoNormalizado);
      where += ` AND UPPER(COALESCE(i.inspeccionestado_key, '')) = $${params.length}`;
    }
  }

  if (numeroInspeccion) {
    params.push(`%${numeroInspeccion.toUpperCase()}%`);
    where += ` AND UPPER(i.nrodocumentoinspeccion) LIKE $${params.length}`;
  }

  if (placa) {
    params.push(`%${placa.toUpperCase()}%`);
    where += ` AND UPPER(COALESCE(c.placamotor, '')) LIKE $${params.length}`;
  }

  if (comprobante) {
    params.push(`%${comprobante.toUpperCase()}%`);
    where += ` AND UPPER(COALESCE(c.nrocomprobante, '')) LIKE $${params.length}`;
  }

  if (cliente) {
    params.push(`%${cliente.toUpperCase()}%`);
    where += ` AND UPPER(COALESCE(c.cliente_nrodocumentoidentidad, '')) LIKE $${params.length}`;
  }

if (fechaInicio || fechaFin) {
  if (fechaInicio) {
    params.push(fechaInicio);
    where += ` AND DATE(i.fechcreacion) >= $${params.length}`;
  }

  if (fechaFin) {
    params.push(fechaFin);
    where += ` AND DATE(i.fechcreacion) <= $${params.length}`;
  }
} else {
  where += ` AND DATE(i.fechcreacion) = CURRENT_DATE`;
}

  const { total, data } = await inspeccionModel.buscarInspecciones(filtros, params, where, limit, offset);

  return {
    total,
    page: currentPage,
    pageSize: limit,
    totalPages: Math.ceil(total / limit),
    data
  };
};

const consultarVehiculoYCajaService = async ({ placa, concepto, plantaKey, categoria, tipoInspeccion, tipoCertificado, tipoAutorizacion }) => {
  // 1. Obtener Precio Base del Concepto
  const conceptoRes = await pool.query(
    `SELECT cd.valor as precio, c.nombre 
     FROM conceptoinspecciondetalle cd
     JOIN conceptoinspeccion c ON c.key = cd.conceptoinspeccion_key
     WHERE cd.conceptoinspeccion_key = $1 AND cd.planta_key = $2 LIMIT 1`, 
    [concepto, plantaKey]
  );

  let precioBase = 0;
  if (conceptoRes.rows.length > 0) {
    precioBase = Number(conceptoRes.rows[0].precio);
  }

  let descuento = 0;
  let esReinspeccion = false;
  let vehiculo = null;
  let mensaje = '';
  let tipoDocumentoSugerido = null;

  // --- BLOQUE TEMPORAL DE PRUEBAS ---
  if (placa === 'DUP-123') {
    throw new Error("PLACA DUPLICADA EN SISTEMA");
  }
  // ----------------------------------

  // 1.5 Verificar placa duplicada en el día actual (EN CUALQUIER SEDE)
  const duplicado = await inspeccionModel.verificarPlacaDuplicada(placa, concepto);

  if (duplicado) {
    const sede = duplicado.nombre_sede || 'otra sede';
    throw new Error(`Este vehículo está en proceso de inspección en la sede ${sede}. No puede haber duplicados.`);
  }

  // 2. Buscar Vehículo en BD Local
  const vehRes = await pool.query(`
    SELECT v.*, 
           p.nrodocumentoidentidad as prop_nrodoc,
           p.tipodocumentoidentidad_key as prop_tipodoc,
           p.nombrerazonsocial as prop_razon,
           p.nombres as prop_nombres,
           p.apellidos as prop_apellidos,
           p.pais_key as prop_pais,
           p.departamento_key as prop_dep,
           p.provincia_key as prop_prov,
           p.distrito_key as prop_dist,
           p.direccion as prop_dir,
           p.email as prop_email,
           p.telefono as prop_tel,
           m.nombre as marca_nombre,
           mo.nombre as modelo_nombre,
           co.nombre as color_nombre,
           c.nombre as carroceria_nombre
    FROM vehiculo v
    LEFT JOIN tarjetapropiedad tp ON v.tarjetapropiedad_id = tp.id
    LEFT JOIN persona p ON tp.propietario_nrodocumentoidentidad = p.nrodocumentoidentidad
    LEFT JOIN marca m ON v.marca_key = m.key
    LEFT JOIN modelo mo ON v.modelo_key = mo.key
    LEFT JOIN color co ON v.color_key = co.key
    LEFT JOIN carroceria c ON v.carroceria_key = c.key
    WHERE v.nromotor = $1 OR v.nroplacaantigua = $1 OR tp.nroplaca = $1
    LIMIT 1
  `, [placa]);

  if (vehRes.rows.length > 0) {
    vehiculo = vehRes.rows[0];
    mensaje = `Vehículo ${vehiculo.marca_key || ''} encontrado en la base de datos.`;
    
    // 3. Lógica de Reinspección (Mejorada: Reglas de 30 días, Mismo Concepto, 3 Oportunidades, Ignorar Anulados)
    const reinspeccionRes = await pool.query(`
      SELECT i.inspeccionestado_key, i.resultado, i.fechcreacion, c.conceptoinspeccion_key, c.importetotal 
      FROM inspeccion i
      JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      WHERE c.placamotor = $1 
        AND i.fechcreacion >= CURRENT_DATE - INTERVAL '30 days'
        AND UPPER(COALESCE(i.inspeccionestado_key, '')) NOT IN ('ANULADO', 'RETIRADO', 'ANU')
      ORDER BY i.fechcreacion DESC 
    `, [placa]);

    if (reinspeccionRes.rows.length > 0) {
      const ultimaInsp = reinspeccionRes.rows[0];
      
      console.log('--- REINSPECCION DEBUG ---');
      console.log('Placa:', placa);
      console.log('Concepto enviado por frontend (concepto_id):', concepto);
      console.log('Concepto guardado en BD:', ultimaInsp.conceptoinspeccion_key);
      console.log('Resultado en BD:', ultimaInsp.resultado);
      console.log('Estado en BD:', ultimaInsp.inspeccionestado_key);
      console.log('Match concepto:', ultimaInsp.conceptoinspeccion_key === concepto);
      console.log('Match resultado:', ultimaInsp.resultado === 'D');
      console.log('--------------------------');

      // Regla 1: Última inspección desaprobada y MISMO concepto
      if (ultimaInsp.resultado === 'D' && ultimaInsp.conceptoinspeccion_key == concepto) {
        
        // Contar cuántas reinspecciones gratuitas ya tuvo en esta cadena de 30 días
        let conteoReinspeccionesGratis = 0;
        let fechaOriginalPagada = ultimaInsp.fechcreacion;

        for (let j = 0; j < reinspeccionRes.rows.length; j++) {
          const row = reinspeccionRes.rows[j];
          if (row.conceptoinspeccion_key != concepto) {
            break; // Rompe la cadena si hay otro concepto en medio
          }
          if (row.inspeccionestado_key === 'APROBADO') {
            break; // Si aprobó antes, la cadena de desaprobados termina ahí
          }
          if (Number(row.importetotal) === 0) {
            conteoReinspeccionesGratis++;
          } else {
            // Si el monto > 0, significa que fue la inspección original pagada que inició la cadena.
            fechaOriginalPagada = row.fechcreacion;
            break; 
          }
        }

        // Calcular días restantes (30 días desde la inspección original)
        const msPorDia = 1000 * 60 * 60 * 24;
        const diasTranscurridos = Math.floor((new Date() - new Date(fechaOriginalPagada)) / msPorDia);
        const diasRestantes = Math.max(0, 30 - diasTranscurridos);

        // Regla 3: Hasta 3 oportunidades (3 reinspecciones a costo cero)
        if (conteoReinspeccionesGratis < 3) {
          esReinspeccion = true;
          mensaje += ` | [Reinspección] Intento ${conteoReinspeccionesGratis + 1} de 3 (Te quedan ${diasRestantes} días)`;
          descuento = precioBase;
        } else {
          mensaje += ` - ¡Atención! El vehículo agotó sus 3 oportunidades de reinspección gratuita dentro de los 30 días. Se debe cobrar la tarifa normal.`;
        }
      }
    }

    // 4. Predicción Boleta/Factura
    const lastComprobanteRes = await pool.query(`
      SELECT c.tipodocumento_key 
      FROM inspeccion i
      JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      WHERE c.placamotor = $1 
      ORDER BY i.fechcreacion DESC 
      LIMIT 1
    `, [placa]);

    if (lastComprobanteRes.rows.length > 0) {
      tipoDocumentoSugerido = lastComprobanteRes.rows[0].tipodocumento_key;
    }

  } else {
    // Si no está localmente, lo buscamos en el MTC (Punto 4)
    try {
      const mtcVehiculo = await mtcService.obtenerVehiculo(
        placa, 
        plantaKey, 
        tipoAutorizacion, // Nota: el mapeo de keys del MTC se puede refinar
        tipoInspeccion, 
        tipoCertificado, 
        categoria
      );
      if (mtcVehiculo) {
        vehiculo = mtcVehiculo;
        mensaje = "Vehículo encontrado en MTC (Datos autocompletados)";
      }
    } catch (e) {
      console.error("Error silencioso MTC:", e.message);
    }
  } // Cierre de if (vehRes.rows.length > 0)

  // Auto-Búsqueda de Descuentos (Punto 6)
  // [A PETICIÓN DEL USUARIO] Se desactivó la auto-búsqueda en el botón CONSULTAR.
  // Ahora el descuento solo se aplica si se busca manualmente en la barra amarilla de la Caja.
  /*
  if (!esReinspeccion || descuento === 0) {
    try {
      const callCenterDescuentos = await buscarDescuentosService({ documento: placa, concepto: concepto });
      if (callCenterDescuentos && callCenterDescuentos.length > 0) {
        // Tomamos el primer descuento por defecto (el más reciente/alto)
        const mejorDescuento = callCenterDescuentos[0];
        descuento = parseFloat(mejorDescuento.monto);
        mensaje += ` (Descuento automático aplicado: ${mejorDescuento.campana})`;
      }
    } catch (e) {
      console.error("Error buscando descuentos auto:", e.message);
    }
  }
  */
  
  let total = precioBase - descuento;
  let baseImponible = total / 1.18;
  let igv = total - baseImponible;

  // 5. AUTO-BUSQUEDA DE DESCUENTOS PARA ESTA PLACA
  let descuentosDisponibles = [];
  try {
    descuentosDisponibles = await buscarDescuentosService({ 
      documento: placa, 
      concepto, 
      placaContexto: placa, 
      soloDniCodigo: false 
    });
  } catch (e) {
    console.error("Error al buscar descuentos automáticos:", e.message);
  }

  return {
    status: 'success',
    precios: {
      precioBase: parseFloat(precioBase.toFixed(2)),
      descuento: parseFloat(descuento.toFixed(2)),
      baseImponible: parseFloat(baseImponible.toFixed(2)),
      igv: parseFloat(igv.toFixed(2)),
      total: parseFloat(total.toFixed(2)),
      esReinspeccion
    },
    vehiculo: vehiculo ? { ...vehiculo, tipoDocumentoSugerido } : { tipoDocumentoSugerido },
    descuentosDisponibles,
    mensaje
  };
};

async function buscarDescuentosService({ documento, concepto, placaContexto, soloDniCodigo }) {
  if (!documento || !concepto) {
    throw new Error("El documento y el concepto son obligatorios");
  }

  const pContexto = placaContexto || null;
  const isSoloDni = soloDniCodigo === 'true' || soloDniCodigo === true;

  // Lógica dinámica de WHERE para descuentocliente y descuentomasivocliente
  // Si isSoloDni es TRUE: no buscamos por placa = $1, solo por uuid = $1. Y obligamos a que dc.placa = pContexto
  // Si isSoloDni es FALSE: buscamos por placa = $1 o uuid = $1. No aplicamos restricción extra.
  
  const vehicularWhere = isSoloDni 
    ? `(dc.uuid = $1) AND ($3::text IS NULL OR dc.placa IS NULL OR dc.placa = $3)`
    : `(dc.placa = $1 OR dc.uuid = $1)`;
    
  const masivoVehicularWhere = isSoloDni 
    ? `(dmc.uuid = $1) AND ($3::text IS NULL OR dmc.placa IS NULL OR dmc.placa = $3)`
    : `(dmc.placa = $1 OR dmc.uuid = $1)`;

  const queryStr = `
      -- 1. Busqueda por DNI/RUC directo en la campaña (descuento)
      SELECT 'descuento' AS source_table, d.id AS source_id, d.nombre as campana, dd.monto, dd.conceptoinspeccion_key, NULL AS uuid, d.tipodescuento_key, dd.tipopagodescuento_key
      FROM descuentodetalle dd
      JOIN descuento d ON d.id = dd.descuento_id
      WHERE d.empresa_nrodocumentoidentidad = $1 AND (dd.conceptoinspeccion_key = $2 OR dd.conceptoinspeccion_key IS NULL)
      AND d.estado = true
      AND (d.fechinicio IS NULL OR CURRENT_TIMESTAMP >= d.fechinicio)
      AND (d.fechfin IS NULL OR CURRENT_TIMESTAMP <= d.fechfin)
  
      UNION
  
      -- 2. Busqueda por Placa o Código en descuentocliente
      SELECT 'descuentocliente' AS source_table, dc.id AS source_id, d.nombre as campana, dd.monto, dd.conceptoinspeccion_key, dc.uuid, d.tipodescuento_key, dd.tipopagodescuento_key
      FROM descuentocliente dc
      JOIN descuentodetalle dd ON dd.id = dc.descuentodetalle_id
      JOIN descuento d ON d.id = dd.descuento_id
      WHERE ${vehicularWhere} AND (dd.conceptoinspeccion_key = $2 OR dd.conceptoinspeccion_key IS NULL)
      AND d.estado = true AND dc.estado = true
      AND (d.fechinicio IS NULL OR CURRENT_TIMESTAMP >= d.fechinicio)
      AND (d.fechfin IS NULL OR CURRENT_TIMESTAMP <= d.fechfin)
  
      UNION
  
      -- 3. Busqueda por DNI/RUC en descuentomasivo
      SELECT 'descuentomasivo' AS source_table, dm.id AS source_id, dm.nombre as campana, dmd.monto, dmd.conceptoinspeccion_key, NULL AS uuid, dm.tipodescuento_key, dmd.tipopagodescuento_key
      FROM descuentomasivodetalle dmd
      JOIN descuentomasivo dm ON dm.id = dmd.descuentomasivo_id
      WHERE dm.empresa_nrodocumentoidentidad = $1 AND (dmd.conceptoinspeccion_key = $2 OR dmd.conceptoinspeccion_key IS NULL)
      AND dm.estado = true
      AND (dm.fechinicio IS NULL OR CURRENT_TIMESTAMP >= dm.fechinicio)
      AND (dm.fechfin IS NULL OR CURRENT_TIMESTAMP <= dm.fechfin)
  
      UNION
  
      -- 4. Busqueda por Placa o Código en descuentomasivocliente
      SELECT 'descuentomasivocliente' AS source_table, dmc.id AS source_id, dm.nombre as campana, dmd.monto, dmd.conceptoinspeccion_key, dmc.uuid, dm.tipodescuento_key, dmd.tipopagodescuento_key
      FROM descuentomasivocliente dmc
      JOIN descuentomasivodetalle dmd ON dmd.descuentomasivo_id = dmc.descuentomasivo_id
      JOIN descuentomasivo dm ON dm.id = dmd.descuentomasivo_id
      WHERE ${masivoVehicularWhere} AND (dmd.conceptoinspeccion_key = $2 OR dmd.conceptoinspeccion_key IS NULL)
      AND dm.estado = true AND dmc.estado = true
      AND (dm.fechinicio IS NULL OR CURRENT_TIMESTAMP >= dm.fechinicio)
      AND (dm.fechfin IS NULL OR CURRENT_TIMESTAMP <= dm.fechfin)
    `;

  const queryParams = isSoloDni ? [documento, concepto, pContexto] : [documento, concepto];
  const descRes = await pool.query(queryStr, queryParams);

  return descRes.rows.map(row => ({
    source_table: row.source_table,
    source_id: row.source_id,
    campana: row.campana,
    monto: row.monto,
    concepto_key: row.conceptoinspeccion_key,
    uuid: row.uuid,
    tipodescuento_key: row.tipodescuento_key,
    tipopagodescuento_key: row.tipopagodescuento_key
  }));
};

const consumirDescuentoService = async ({ source_table, source_id }) => {
  if (!source_table || !source_id) {
    throw new Error("Se requiere la tabla de origen y el ID del descuento para consumirlo.");
  }
  
  const tablasValidas = ['descuento', 'descuentocliente', 'descuentomasivo', 'descuentomasivocliente', 'verificaciondescuento', 'campania'];
  if (!tablasValidas.includes(source_table)) {
    throw new Error("Tabla de descuento no válida.");
  }

  // Si la tabla es 'campania', es un descuento corporativo (multiuso)
  if (source_table === 'campania') {
    return { consumido: false, id: source_id, message: 'Descuento multiuso (corporativo)' };
  }

  // Marcar como consumido (estado = false)
  // Nota: Si el descuento proviene de 'descuento' o 'descuentomasivo' directamente (por DNI/RUC general),
  // actualizar su estado apagaría la campaña para todos. Si la regla es "un solo uso general", esto es correcto.
  const query = `UPDATE ${source_table} SET estado = false WHERE id = $1 RETURNING id`;
  const result = await pool.query(query, [source_id]);

  if (result.rowCount === 0) {
    throw new Error("No se pudo consumir el descuento. Es posible que no exista o ya haya sido consumido.");
  }

  return { consumido: true, id: result.rows[0].id };
};

const consultarReinspeccionService = async (placa, concepto_key, planta_key) => {
  // 1. Buscar el historial de inspecciones recientes de esa placa para ESE concepto
  const sqlHistorial = `
    SELECT i.nrodocumentoinspeccion, i.fechconsolidado, i.tipodesaprobado, i.resultado, i.inspeccionestado_key,
           c.conceptoinspeccion_key, c.formapago_key, c.importetotal, i.tipoautorizacion_key, i.tipocertificado_key, i.tipoinspeccion_key,
           i.ui_metadata, v.categoria_key
    FROM inspeccion i
    JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
    LEFT JOIN vehiculo v ON v.nromotor = i.vehiculo_nromotor
    WHERE c.placamotor = $1
      AND c.conceptoinspeccion_key = $2
      AND i.fechconsolidado IS NOT NULL
      AND (i.inspeccionestado_key = 'CON' OR i.inspeccionestado_key IS NULL)
    ORDER BY i.fechconsolidado DESC
    LIMIT 10
  `;
  const resultHistorial = await pool.query(sqlHistorial, [placa, concepto_key]);

  if (resultHistorial.rows.length === 0) {
    return null; // No hay inspecciones previas para ese concepto
  }

  const ultima = resultHistorial.rows[0];
  
  // Si la ÚLTIMA inspección de este concepto no fue 'Desaprobado', entonces no aplica reinspección
  if (ultima.resultado !== 'D') {
    return null;
  }

  // Contar cuántas reinspecciones gratuitas ya tuvo en esta cadena
  let conteoReinspeccionesGratis = 0;
  let fechaOriginalPagada = ultima.fechconsolidado;

  for (let j = 0; j < resultHistorial.rows.length; j++) {
    const row = resultHistorial.rows[j];
    if (row.conceptoinspeccion_key?.toString() !== concepto_key?.toString()) {
      break; // Rompe la cadena si hay otro concepto en medio
    }
    if (row.resultado === 'A' || row.resultado === 'APROBADO') {
      break; // Si aprobó antes, la cadena de desaprobados termina ahí
    }
    if (Number(row.importetotal) === 0) {
      conteoReinspeccionesGratis++;
    } else {
      // Si el monto > 0, fue la inspección original que inició la cadena.
      fechaOriginalPagada = row.fechconsolidado;
      break; 
    }
  }

  if (conteoReinspeccionesGratis >= 3) {
    return {
      aplica: false,
      mensaje: `¡Atención! El vehículo agotó sus 3 oportunidades de reinspección gratuita. Se debe cobrar la tarifa normal.`,
      dias_transcurridos: 0
    };
  }

  const fechconsolidado = new Date(fechaOriginalPagada);
  const ahora = new Date();
  
  // Diferencia en días (Truncar como lo hacía Java con TimeUnit.DAYS)
  const diffTime = Math.abs(ahora.getTime() - fechconsolidado.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  // 2. Buscar en periodoreinspeccion
  // El tipo de desaprobado suele ser 'M' (Moderado) o 'D' (Grave) pero en la BD vemos que 
  // 'tipodesaprobado' en periodoreinspeccion es 'M' o 'D'.
  // Si i.tipodesaprobado es null, asumimos 'D' (peor caso) por defecto si la lógica lo requiere,
  // pero usaremos lo que esté en i.tipodesaprobado.
  
  const sqlPeriodo = `
    SELECT porcentajedescuento, tieneporcentajedescuento
    FROM periodoreinspeccion
    WHERE planta_key = $1
      AND dias >= $2
      AND (tipodesaprobado = $3 OR tipodesaprobado IS NULL)
    ORDER BY dias ASC
    LIMIT 1
  `;
  const resultPeriodo = await pool.query(sqlPeriodo, [
    planta_key,
    diffDays,
    ultima.tipodesaprobado || 'D'
  ]);

  if (resultPeriodo.rows.length === 0) {
    return {
      aplica: false,
      mensaje: `La inspección anterior desaprobada tiene ${diffDays} días de antigüedad (Nro: ${ultima.nrodocumentoinspeccion}). El plazo de reinspección ha vencido.`,
      dias_transcurridos: diffDays
    }; // Pasó el tiempo límite o no hay regla
  }

  const regla = resultPeriodo.rows[0];
  
  const diasRestantes = Math.max(0, 30 - diffDays);

  if (regla.tieneporcentajedescuento) {
    let oldUiMetadata = null;
    if (ultima.ui_metadata) {
      try { oldUiMetadata = typeof ultima.ui_metadata === 'string' ? JSON.parse(ultima.ui_metadata) : ultima.ui_metadata; } catch(e){}
    }
    
    // Buscar vehiculo actual en BD para permitir correcciones manuales
    let vehiculoActual = null;
    try {
      const vehRes = await pool.query(`
        SELECT v.*, 
               p.nrodocumentoidentidad as prop_nrodoc,
               p.tipodocumentoidentidad_key as prop_tipodoc,
               p.nombrerazonsocial as prop_razon,
               p.nombres as prop_nombres,
               p.apellidos as prop_apellidos,
               p.pais_key as prop_pais,
               p.departamento_key as prop_dep,
               p.provincia_key as prop_prov,
               p.distrito_key as prop_dist,
               p.direccion as prop_dir,
               p.email as prop_email,
               p.telefono as prop_tel,
               m.nombre as marca_nombre,
               mo.nombre as modelo_nombre,
               co.nombre as color_nombre,
               ca.nombre as carroceria_nombre,
               vc.nombre as clase_nombre
        FROM vehiculo v
        LEFT JOIN tarjetapropiedad tp ON v.tarjetapropiedad_id = tp.id
        LEFT JOIN persona p ON tp.propietario_nrodocumentoidentidad = p.nrodocumentoidentidad
        LEFT JOIN marca m ON v.marca_key = m.key
        LEFT JOIN modelo mo ON v.modelo_key = mo.key
        LEFT JOIN color co ON v.color_key = co.key
        LEFT JOIN carroceria ca ON v.carroceria_key = ca.key
        LEFT JOIN vehiculoclase vc ON v.vehiculoclase_key = vc.key
        WHERE (v.nromotor = $1 OR v.nroplacaantigua = $1 OR tp.nroplaca = $1)
        ORDER BY v.fechcreacion DESC NULLS LAST
        LIMIT 1
      `, [placa]);
      if (vehRes.rows.length > 0) {
        vehiculoActual = vehRes.rows[0];
      }
    } catch(e) {
      console.error('Error fetching vehiculo for reinspeccion:', e);
    }

    return {
      aplica: true,
      nrodocumentoreinspeccion: ultima.nrodocumentoinspeccion,
      porcentajedescuento: regla.porcentajedescuento,
      conceptoinspeccion_key: ultima.conceptoinspeccion_key,
      tipoautorizacion_key: ultima.tipoautorizacion_key,
      tipocertificado_key: ultima.tipocertificado_key,
      tipoinspeccion_key: ultima.tipoinspeccion_key,
      categoria_key: ultima.categoria_key,
      ui_metadata: oldUiMetadata,
      vehiculo_actual: vehiculoActual,
      dias_transcurridos: diffDays,
      mensaje: `¡Aplica a Reinspección! Documento anterior: ${ultima.nrodocumentoinspeccion} de hace ${diffDays} días. Intento ${conteoReinspeccionesGratis + 1} de 3 (Te quedan ${diasRestantes} días) - ${regla.porcentajedescuento}% dscto`
    };
  }
  
  return {
    aplica: false,
    mensaje: `No hay descuento configurado para reinspección de ${diffDays} días.`,
    dias_transcurridos: diffDays
  };
};

const consultarReinspeccionesActivasService = async (placa) => {
  const sqlHistorial = `
    SELECT i.nrodocumentoinspeccion, i.fechconsolidado, i.tipodesaprobado, i.resultado, i.inspeccionestado_key,
           c.conceptoinspeccion_key, c.formapago_key, c.importetotal, con.nombre as concepto_nombre
    FROM inspeccion i
    JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
    LEFT JOIN conceptoinspeccion con ON con.key = c.conceptoinspeccion_key
    WHERE c.placamotor = $1
      AND i.fechconsolidado IS NOT NULL
      AND (i.inspeccionestado_key = 'CON' OR i.inspeccionestado_key IS NULL)
    ORDER BY i.fechconsolidado DESC
    LIMIT 50
  `;
  const resultHistorial = await pool.query(sqlHistorial, [placa]);

  if (resultHistorial.rows.length === 0) return [];

  const historyByConcept = {};
  for (const row of resultHistorial.rows) {
    const concepto = row.conceptoinspeccion_key?.toString();
    if (!concepto) continue;
    if (!historyByConcept[concepto]) {
      historyByConcept[concepto] = [];
    }
    historyByConcept[concepto].push(row);
  }

  const activas = [];

  for (const concepto in historyByConcept) {
    const inspecciones = historyByConcept[concepto];
    const ultima = inspecciones[0];

    if (ultima.resultado !== 'D') continue;

    let conteoReinspeccionesGratis = 0;
    let fechaOriginalPagada = ultima.fechconsolidado;

    for (let j = 0; j < inspecciones.length; j++) {
      const row = inspecciones[j];
      if (row.resultado === 'A' || row.resultado === 'APROBADO') break;
      if (Number(row.importetotal) === 0) {
        conteoReinspeccionesGratis++;
      } else {
        fechaOriginalPagada = row.fechconsolidado;
        break;
      }
    }

    if (conteoReinspeccionesGratis >= 3) continue;

    const fechconsolidado = new Date(fechaOriginalPagada);
    const ahora = new Date();
    const diffTime = Math.abs(ahora.getTime() - fechconsolidado.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    const sqlPeriodo = `
      SELECT dias 
      FROM periodoreinspeccion 
      WHERE tipodesaprobado = $1 
      ORDER BY dias DESC LIMIT 1
    `;
    const resPeriodo = await pool.query(sqlPeriodo, [ultima.tipodesaprobado || 'D']);
    let maxDias = 30;
    if (resPeriodo.rows.length > 0) {
        maxDias = Number(resPeriodo.rows[0].dias);
    }

    if (diffDays <= maxDias) {
      activas.push({
        concepto_key: concepto,
        concepto_nombre: ultima.concepto_nombre || concepto,
        dias_transcurridos: diffDays,
        dias_restantes: maxDias - diffDays,
        intentos_restantes: 3 - conteoReinspeccionesGratis,
        nrodocumento: ultima.nrodocumentoinspeccion
      });
    }
  }

  return activas;
};

module.exports = {
  buscarInspecciones,
  consultarVehiculoYCajaService,
  buscarDescuentosService,
  consumirDescuentoService,
  consultarReinspeccionService,
  consultarVehiculoRapido,
  consultarReinspeccionesActivasService
};