const pool = require('./config/database');

async function consultarReinspeccionesActivasService(placa) {
  const sqlHistorial = `
    SELECT i.nrodocumentoinspeccion, i.fechconsolidado, i.tipodesaprobado, i.resultado, i.inspeccionestado_key,
           c.conceptoinspeccion_key, c.formapago_key, c.importetotal
    FROM inspeccion i
    JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
    WHERE c.placamotor = $1
      AND i.fechconsolidado IS NOT NULL
      AND (i.inspeccionestado_key = 'CON' OR i.inspeccionestado_key IS NULL)
    ORDER BY i.fechconsolidado DESC
    LIMIT 50
  `;
  const resultHistorial = await pool.query(sqlHistorial, [placa]);

  if (resultHistorial.rows.length === 0) {
    return [];
  }

  // Agrupar por concepto
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

    // Si la última no fue Desaprobado, no hay reinspección activa para este concepto
    if (ultima.resultado !== 'D') continue;

    let conteoReinspeccionesGratis = 0;
    let fechaOriginalPagada = ultima.fechconsolidado;

    for (let j = 0; j < inspecciones.length; j++) {
      const row = inspecciones[j];
      if (row.resultado === 'A' || row.resultado === 'APROBADO') {
        break;
      }
      if (Number(row.importetotal) === 0) {
        conteoReinspeccionesGratis++;
      } else {
        fechaOriginalPagada = row.fechconsolidado;
        break;
      }
    }

    if (conteoReinspeccionesGratis >= 3) {
      continue; // Agotó intentos
    }

    const fechconsolidado = new Date(fechaOriginalPagada);
    const ahora = new Date();
    const diffTime = Math.abs(ahora.getTime() - fechconsolidado.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    // Validar el periodo de gracia
    // Para simplificar, buscamos la regla genérica del concepto
    // Normalmente es de 30 o 60 días dependiendo del tipoDesaprobado
    // Como no tenemos planta_key aquí, usamos un límite estándar de 60 días como precaución,
    // o consultamos periodoreinspeccion.
    // Vamos a consultar los días configurados.
    const sqlPeriodo = `
      SELECT diasvigencia 
      FROM periodoreinspeccion 
      WHERE tipodesaprobado = $1 
        AND conceptoinspeccion_key = $2
      ORDER BY diasvigencia DESC LIMIT 1
    `;
    const resPeriodo = await pool.query(sqlPeriodo, [ultima.tipodesaprobado || 'D', concepto]);
    let maxDias = 30; // Default
    if (resPeriodo.rows.length > 0) {
        maxDias = resPeriodo.rows[0].diasvigencia;
    }

    if (diffDays <= maxDias) {
      activas.push({
        concepto,
        dias_transcurridos: diffDays,
        dias_restantes: maxDias - diffDays,
        intentos_usados: conteoReinspeccionesGratis,
        intentos_restantes: 3 - conteoReinspeccionesGratis,
        nrodocumento: ultima.nrodocumentoinspeccion
      });
    }
  }

  return activas;
}

consultarReinspeccionesActivasService('5555').then(res => {
    console.log("Activas:", res);
    process.exit(0);
}).catch(console.error);
