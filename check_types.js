const pool = require('./config/database');

async function check() {
  try {
    const res1 = await pool.query("SELECT id, nombre, tipodescuento_key FROM descuento WHERE UPPER(nombre) LIKE '%CUPON%'");
    console.log("Variaciones de Cuponidad en tabla 'descuento':", res1.rows);

    const desc_ids = res1.rows.map(r => r.id);
    
    if (desc_ids.length > 0) {
      const res2 = await pool.query("SELECT descuento_id, tipopagodescuento_key, COUNT(*) as cantidad FROM descuentodetalle WHERE descuento_id = ANY($1) GROUP BY descuento_id, tipopagodescuento_key", [desc_ids]);
      console.log("Tipos de cobro por programa de Cuponidad:", res2.rows);
    }
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
check();
