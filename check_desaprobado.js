const pool = require('./config/database');

async function run() {
  const result = await pool.query(`
    SELECT i.nrodocumentoinspeccion, c.placamotor, c.conceptoinspeccion_key, i.fechconsolidado
    FROM inspeccion i
    JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
    WHERE i.resultado = 'Desaprobado'
      AND i.fechconsolidado IS NOT NULL
      AND i.fechconsolidado >= NOW() - INTERVAL '30 days'
    ORDER BY i.fechconsolidado DESC
    LIMIT 5
  `);
  console.log("Desaprobados recientes:", result.rows);

  const result2 = await pool.query(`
    SELECT i.nrodocumentoinspeccion, c.placamotor, c.conceptoinspeccion_key, i.fechconsolidado
    FROM inspeccion i
    JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
    WHERE i.resultado = 'Desaprobado'
      AND i.fechconsolidado IS NOT NULL
    ORDER BY i.fechconsolidado DESC
    LIMIT 5
  `);
  console.log("Cualquier desaprobado:", result2.rows);
  
  process.exit(0);
}
run();
