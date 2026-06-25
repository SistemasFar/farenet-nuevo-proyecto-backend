const pool = require('../config/database');

const ESTADOS_PERMITIDOS = ['CON', 'ANULADO', 'RETIRADO', 'PROCESO'];

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

  const baseFrom = `
    FROM inspeccion i
    LEFT JOIN LATERAL (
      SELECT c1.*
      FROM comprobante c1
      WHERE c1.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
         OR c1.id = i.comprobante_id
      ORDER BY c1.id DESC
      LIMIT 1
    ) c ON true
    LEFT JOIN linea l ON c.linea_key = l.key
    LEFT JOIN conceptoinspeccion ci ON c.conceptoinspeccion_key = ci.key
    LEFT JOIN certificado cert ON cert.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    ${baseFrom}
    ${where}
  `;

  const dataSql = `
    SELECT
      i.nrodocumentoinspeccion AS "numeroInspeccion",
      TO_CHAR(i.fechcreacion, 'YYYY-MM-DD HH24:MI:SS') AS "fechaHora",
      COALESCE(c.placamotor, '-') AS "placa",
      COALESCE(c.nrocomprobante, '-') AS "comprobante",
      COALESCE(c.cliente_nrodocumentoidentidad, '-') AS "cliente",
      COALESCE(ci.nombre, '-') AS "conceptoVehicular",
      COALESCE(l.nombre, '-') AS "linea",
      COALESCE(i.inspeccionestado_key, '-') AS "estado",
      COALESCE(cert.nrodocumentocertificado, '-') AS "numeroCertificado",
      COALESCE(i.resultado, '-') AS "resultado",
      CASE
        WHEN cert.nrodocumentocertificado IS NULL THEN '-'
        WHEN cert.anulado = true THEN 'ANULADO'
        WHEN cert.estado = true THEN 'ACTIVO'
        WHEN cert.estado = false THEN 'INACTIVO'
        ELSE '-'
      END AS "estadoCertificado"
    ${baseFrom}
    ${where}
    ORDER BY i.fechcreacion DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  const countResult = await pool.query(countSql, params);
  const total = countResult.rows[0]?.total || 0;

  const dataResult = await pool.query(dataSql, [
    ...params,
    limit,
    offset
  ]);

  return {
    total,
    page: currentPage,
    pageSize: limit,
    totalPages: Math.ceil(total / limit),
    data: dataResult.rows
  };
};

const consultarVehiculoYCajaService = async ({ placa, concepto, plantaKey }) => {
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

  // 2. Buscar Vehículo en BD Local
  const vehRes = await pool.query(`
    SELECT * FROM vehiculo WHERE nromotor = $1 OR nroplacaantigua = $1 LIMIT 1
  `, [placa]);

  if (vehRes.rows.length > 0) {
    vehiculo = vehRes.rows[0];
    mensaje = `Vehículo ${vehiculo.marca_key || ''} encontrado en la base de datos.`;
    
    // 3. Lógica de Reinspección
    const reinspeccionRes = await pool.query(`
      SELECT i.inspeccionestado_key, i.fechcreacion 
      FROM inspeccion i
      JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      WHERE c.placamotor = $1 
      ORDER BY i.fechcreacion DESC 
      LIMIT 1
    `, [placa]);

    if (reinspeccionRes.rows.length > 0) {
      const ultimaInsp = reinspeccionRes.rows[0];
      if (ultimaInsp.inspeccionestado_key === 'DESAPROBADO') {
        esReinspeccion = true;
        mensaje += ' - ¡Atención! El vehículo tiene una inspección previa DESAPROBADA. Aplica como Reinspección.';
        descuento = precioBase;
      }
    }



  } // Cierre de if (vehRes.rows.length > 0)

  // En lugar de descontar automaticamente, el frontend manejara los descuentos adicionales.
  // Solo aplicamos descuento si es reinspeccion desaprobada
  
  let total = precioBase - descuento;
  let baseImponible = total / 1.18;
  let igv = total - baseImponible;

  return {
    precios: {
      precioBase: parseFloat(precioBase.toFixed(2)),
      descuento: parseFloat(descuento.toFixed(2)),
      baseImponible: parseFloat(baseImponible.toFixed(2)),
      igv: parseFloat(igv.toFixed(2)),
      total: parseFloat(total.toFixed(2)),
      esReinspeccion
    },
    vehiculo,
    mensaje
  };
};

const buscarDescuentosService = async ({ documento, concepto }) => {
  if (!documento || !concepto) {
    throw new Error("El documento y el concepto son obligatorios");
  }

  const descRes = await pool.query(`
    -- 1. Busqueda por DNI/RUC directo en la campaña (descuento)
    SELECT 'descuento' AS source_table, d.id AS source_id, d.nombre as campana, dd.monto, dd.conceptoinspeccion_key
    FROM descuentodetalle dd
    JOIN descuento d ON d.id = dd.descuento_id
    WHERE d.empresa_nrodocumentoidentidad = $1 AND dd.conceptoinspeccion_key = $2
    AND d.estado = true
    AND (d.fechinicio IS NULL OR CURRENT_TIMESTAMP >= d.fechinicio)
    AND (d.fechfin IS NULL OR CURRENT_TIMESTAMP <= d.fechfin)

    UNION

    -- 2. Busqueda por Placa o Código en descuentocliente
    SELECT 'descuentocliente' AS source_table, dc.id AS source_id, d.nombre as campana, dd.monto, dd.conceptoinspeccion_key
    FROM descuentocliente dc
    JOIN descuentodetalle dd ON dd.id = dc.descuentodetalle_id
    JOIN descuento d ON d.id = dd.descuento_id
    WHERE (dc.placa = $1 OR dc.uuid = $1) AND dd.conceptoinspeccion_key = $2
    AND d.estado = true AND dc.estado = true
    AND (d.fechinicio IS NULL OR CURRENT_TIMESTAMP >= d.fechinicio)
    AND (d.fechfin IS NULL OR CURRENT_TIMESTAMP <= d.fechfin)

    UNION

    -- 3. Busqueda por DNI/RUC en descuentomasivo
    SELECT 'descuentomasivo' AS source_table, dm.id AS source_id, dm.nombre as campana, dmd.monto, dmd.conceptoinspeccion_key
    FROM descuentomasivodetalle dmd
    JOIN descuentomasivo dm ON dm.id = dmd.descuentomasivo_id
    WHERE dm.empresa_nrodocumentoidentidad = $1 AND dmd.conceptoinspeccion_key = $2
    AND dm.estado = true
    AND (dm.fechinicio IS NULL OR CURRENT_TIMESTAMP >= dm.fechinicio)
    AND (dm.fechfin IS NULL OR CURRENT_TIMESTAMP <= dm.fechfin)

    UNION

    -- 4. Busqueda por Placa o Código en descuentomasivocliente
    SELECT 'descuentomasivocliente' AS source_table, dmc.id AS source_id, dm.nombre as campana, dmd.monto, dmd.conceptoinspeccion_key
    FROM descuentomasivocliente dmc
    JOIN descuentomasivodetalle dmd ON dmd.descuentomasivo_id = dmc.descuentomasivo_id
    JOIN descuentomasivo dm ON dm.id = dmd.descuentomasivo_id
    WHERE (dmc.placa = $1 OR dmc.uuid = $1) AND dmd.conceptoinspeccion_key = $2
    AND dm.estado = true AND dmc.estado = true
    AND (dm.fechinicio IS NULL OR CURRENT_TIMESTAMP >= dm.fechinicio)
    AND (dm.fechfin IS NULL OR CURRENT_TIMESTAMP <= dm.fechfin)
  `, [documento, concepto]);

  return descRes.rows.map(row => ({
    source_table: row.source_table,
    source_id: row.source_id,
    campana: row.campana,
    monto: row.monto,
    concepto_key: row.conceptoinspeccion_key
  }));
};

const consumirDescuentoService = async ({ source_table, source_id }) => {
  if (!source_table || !source_id) {
    throw new Error("Se requiere la tabla de origen y el ID del descuento para consumirlo.");
  }
  
  const tablasValidas = ['descuento', 'descuentocliente', 'descuentomasivo', 'descuentomasivocliente'];
  if (!tablasValidas.includes(source_table)) {
    throw new Error("Tabla de descuento no válida.");
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

module.exports = {
  buscarInspecciones,
  consultarVehiculoYCajaService,
  buscarDescuentosService,
  consumirDescuentoService
};