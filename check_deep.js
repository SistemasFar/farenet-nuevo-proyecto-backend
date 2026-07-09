const pool = require('./config/database');
const fs = require('fs');

async function check() {
  const c = await pool.connect();
  let log = "";
  
  const print = (title, res) => {
    log += `\n\n=== ${title} ===\n`;
    if (res.rows && res.rows.length > 0) {
      log += JSON.stringify(res.rows, null, 2);
    } else {
      log += "NO DATA";
    }
  };

  try {
    // 1. Tablas relacionadas
    const t1 = await c.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (
          table_name ILIKE '%estado%'
          OR table_name ILIKE '%etapa%'
          OR table_name ILIKE '%linea%'
          OR table_name ILIKE '%prueba%'
          OR table_name ILIKE '%maquina%'
          OR table_name ILIKE '%inspeccion%'
          OR table_name ILIKE '%concepto%'
          OR table_name ILIKE '%resultado%'
        )
      ORDER BY table_name;
    `);
    print("TABLAS CANDIDATAS", t1);
    
    // 2. Columnas candidatas
    const t2 = await c.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          table_name ILIKE '%estado%'
          OR table_name ILIKE '%etapa%'
          OR table_name ILIKE '%linea%'
          OR table_name ILIKE '%prueba%'
          OR table_name ILIKE '%maquina%'
          OR table_name ILIKE '%inspeccion%'
          OR table_name ILIKE '%concepto%'
          OR table_name ILIKE '%resultado%'
        )
      ORDER BY table_name, ordinal_position;
    `);
    print("COLUMNAS CANDIDATAS", t2);

    // 3. linea_etapa - All records limit 50
    const t3 = await c.query(`SELECT * FROM linea_etapa LIMIT 50;`);
    print("linea_etapa DATA", t3);
    
    // 3. linea_etapa columns
    const t4 = await c.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'linea_etapa'
      ORDER BY ordinal_position;
    `);
    print("linea_etapa COLUMNS", t4);

    // 4. Buscar textos en tablas
    const searchValues = ['GASES', 'OPACIDAD', 'LUCES', 'INSPECCION VISUAL', 'SONOMETRO', 'PROFUNDIMETRO', 'FRENOMETRO', 'ALINEACION', 'SUSPENSION', 'CONSOLIDACION'];
    // For simplicity, let's search in known catalog tables first, especially `etapa`.
    const t5 = await c.query(`SELECT * FROM etapa`);
    print("ETAPA TABLE", t5);
    
    // 5. Analizar registros legacy reales
    const t6 = await c.query(`
      SELECT
        i.tipoinspeccion_key,
        c.conceptoinspeccion_key,
        v.vehiculoclase_key as categoria_key,
        v.combustible_key,
        c.linea_key,
        SPLIT_PART(i.nrodocumentoinspeccion, '-', 2) AS planta_key_doc,
        i.posicion,
        COUNT(*) AS cantidad
      FROM inspeccion i
      LEFT JOIN comprobante c
        ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      LEFT JOIN vehiculo v
        ON v.nromotor = i.vehiculo_nromotor
      WHERE i.inspeccionestado_key = 'CON'
        AND i.posicion BETWEEN 5 AND 13
      GROUP BY
        i.tipoinspeccion_key,
        c.conceptoinspeccion_key,
        v.vehiculoclase_key,
        v.combustible_key,
        c.linea_key,
        SPLIT_PART(i.nrodocumentoinspeccion, '-', 2),
        i.posicion
      ORDER BY cantidad DESC
      LIMIT 100;
    `);
    print("AGRUPACION LEGACY", t6);

    // 7. fechconsolidado y fechaenlinea
    const t7 = await c.query(`
      SELECT
        inspeccionestado_key,
        posicion,
        fechaenlinea IS NOT NULL as tiene_fechaenlinea,
        fechconsolidado IS NOT NULL as tiene_fechconsolidado,
        COUNT(*)
      FROM inspeccion
      WHERE inspeccionestado_key = 'CON'
      GROUP BY inspeccionestado_key, posicion, fechaenlinea IS NOT NULL, fechconsolidado IS NOT NULL
      ORDER BY posicion;
    `);
    print("FECHAS EN ESTADO CON", t7);
    
  } catch (e) {
    console.error(e);
    log += "\nERROR: " + e.message;
  } finally {
    c.release();
    fs.writeFileSync('db_analysis.txt', log);
    process.exit(0);
  }
}
check();
