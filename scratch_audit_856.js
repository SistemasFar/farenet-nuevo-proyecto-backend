require('./config/env-loader');
const pool = require('./config/database');

async function audit856() {
  console.log('=== AUDITORÍA CERTIFICADO 856 ===');
  const cert = await pool.query('SELECT * FROM fg_certificado WHERE id = 856');
  console.log('Certificado 856:', cert.rows[0]);

  const fac = await pool.query('SELECT * FROM fg_facturacion WHERE certificado_id = 856');
  console.log('Facturación de 856:', fac.rows[0]);

  const orden = await pool.query('SELECT * FROM fg_orden_pago WHERE certificado_id = 856');
  console.log('Orden de pago de 856:', orden.rows[0]);

  if (fac.rows[0]?.id) {
    const intentos = await pool.query('SELECT * FROM fg_facturacion_intento WHERE facturacion_id = $1 ORDER BY id DESC', [fac.rows[0].id]);
    console.log('Intentos de facturación:', intentos.rows);
  }

  // Check if contingencia table exists
  const tableCheck = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'fg_facturacion_contingencia'");
  console.log('Tabla fg_facturacion_contingencia existe?:', tableCheck.rowCount > 0);

  if (tableCheck.rowCount > 0) {
    const cont = await pool.query('SELECT * FROM fg_facturacion_contingencia WHERE certificado_id = 856');
    console.log('Contingencia 856:', cont.rows);
  }

  await pool.end();
}

audit856().catch(err => {
  console.error(err);
  process.exit(1);
});

