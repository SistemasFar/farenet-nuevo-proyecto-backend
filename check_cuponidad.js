const pool = require('./config/database');

async function checkTables() {
  try {
    const res1 = await pool.query("SELECT * FROM descuento WHERE UPPER(nombre) LIKE '%CUPONIDAD%' LIMIT 1");
    console.log("=== CUPONIDAD EN DESCUENTO ===");
    console.log(res1.rows);

    if (res1.rows.length > 0) {
      const desc_id = res1.rows[0].id;
      const res2 = await pool.query("SELECT * FROM descuentodetalle WHERE descuento_id = $1 LIMIT 2", [desc_id]);
      console.log("\n=== DESCUENTODETALLE DE CUPONIDAD ===");
      console.log(res2.rows);

      if (res2.rows.length > 0) {
        const desc_det_id = res2.rows[0].id;
        const res3 = await pool.query("SELECT * FROM descuentocliente WHERE descuentodetalle_id = $1 LIMIT 2", [desc_det_id]);
        console.log("\n=== DESCUENTOCLIENTE DE CUPONIDAD ===");
        console.log(res3.rows);
      }
    }
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

checkTables();
