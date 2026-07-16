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
    const queryResultados = `
        SELECT rm.id, rm.resultado, rm.data, rm.postdata, m.tipomaquina_key
        FROM resultado_maquina rm
        JOIN maquina m ON rm.maquina_id = m.id
        WHERE rm.inspeccion_nrodocumentoinspeccion = $1
    `;
    const resData = await pool.query(queryResultados, ['INS-201-000158539']);
    
    console.log("=== DATA DE INSPECCION INS-201-000158539 ===");
    resData.rows.forEach(r => {
        console.log(`Tipo: ${r.tipomaquina_key} | ID: ${r.id} | Result: ${r.resultado}`);
        const dataKeys = r.data ? Object.keys(r.data).join(', ') : 'null';
        const postdataKeys = r.postdata ? Object.keys(r.postdata).join(', ') : 'null';
        console.log(`   Data keys: ${dataKeys}`);
        console.log(`   Postdata keys: ${postdataKeys}`);
        
        // Also log the actual content for precision
        if (r.tipomaquina_key === '3') { // Frenos example
            console.log("   DATA CONTENT FRENOS:");
            console.log(r.data);
            console.log("   POSTDATA CONTENT FRENOS:");
            console.log(r.postdata);
        }
    });

  } catch (error) {
    console.error(error);
  } finally {
    pool.end();
  }
}

run();
