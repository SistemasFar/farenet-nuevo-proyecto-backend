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
    const res = await pool.query("SELECT inspeccion_nrodocumentoinspeccion FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion LIKE '%000158539%'");
    console.log("MATCHES FOR 000158539:", res.rows);
    
    // Si no hay, busquemos una inspeccion que sí tenga todos los equipos para usar de ejemplo en los logs del entregable.
    const resAll = await pool.query(`
        SELECT rm.inspeccion_nrodocumentoinspeccion, count(*) as c 
        FROM resultado_maquina rm
        GROUP BY rm.inspeccion_nrodocumentoinspeccion
        ORDER BY count(*) DESC
        LIMIT 1
    `);
    if(resAll.rows.length > 0) {
        const topInsp = resAll.rows[0].inspeccion_nrodocumentoinspeccion;
        console.log(`TOP INSPECCION CON MAQUINAS: ${topInsp} (count: ${resAll.rows[0].c})`);
        
        const queryResultados = `
            SELECT rm.id, rm.resultado, rm.data, rm.postdata, m.tipomaquina_key
            FROM resultado_maquina rm
            JOIN maquina m ON rm.maquina_id = m.id
            WHERE rm.inspeccion_nrodocumentoinspeccion = $1
        `;
        const resData = await pool.query(queryResultados, [topInsp]);
        
        console.log(`=== DATA DE INSPECCION ${topInsp} ===`);
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
