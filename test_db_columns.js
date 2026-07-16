const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

async function run() {
  try {
    // 1. Columnas de resultado_maquina
    const resRM = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'resultado_maquina'
    `);
    console.log("=== COLUMNAS resultado_maquina ===");
    console.log(resRM.rows.map(r => r.column_name).join(', '));

    // 2. Columnas de maquina
    const resM = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'maquina'
    `);
    console.log("=== COLUMNAS maquina ===");
    console.log(resM.rows.map(r => r.column_name).join(', '));

    // 3. Resultados reales para la inspección actual (INS-201-000158539)
    // Buscamos inspeccion_nrodocumento, pero si se llama distinto lo sabremos.
    // Asumiremos inspeccion_nrodocumento por ahora en esta query exploratoria.
    const hasCol = resRM.rows.find(r => r.column_name === 'inspeccion_nrodocumento');
    if (hasCol) {
        const queryResultados = `
            SELECT rm.id, rm.resultado, rm.data, rm.postdata, m.tipomaquina_key
            FROM resultado_maquina rm
            JOIN maquina m ON rm.maquina_id = m.id
            WHERE rm.inspeccion_nrodocumento = $1
        `;
        const resData = await pool.query(queryResultados, ['INS-201-000158539']);
        
        console.log("=== DATA DE INSPECCION INS-201-000158539 ===");
        resData.rows.forEach(r => {
            console.log(`Tipo: ${r.tipomaquina_key} | ID: ${r.id} | Result: ${r.resultado}`);
            const dataKeys = r.data ? Object.keys(r.data).join(', ') : 'null';
            const postdataKeys = r.postdata ? Object.keys(r.postdata).join(', ') : 'null';
            console.log(`   Data keys: ${dataKeys}`);
            console.log(`   Postdata keys: ${postdataKeys}`);
        });
    }

  } catch (error) {
    console.error(error);
  } finally {
    pool.end();
  }
}

run();
