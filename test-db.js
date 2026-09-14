const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || '192.168.14.19',
  database: process.env.DB_NAME || 'inspeccion',
  password: process.env.DB_PASSWORD || 'farenet2026**',
  port: process.env.DB_PORT || 5432,
});

async function main() {
  try {
    const tipos = await pool.query(`SELECT clave FROM fg_tipo_certificado`);
    console.log("TIPOS CERTIFICADO:", tipos.rows);

    const operation = await pool.query(`
      SELECT * FROM fg_servicio WHERE codigo = '8081';
    `);
    console.log("OPERATION 8081:", operation.rows);
    
    if (product.rows.length > 0 && operation.rows.length > 0) {
        console.log("Category Match?", product.rows[0].categoria_id === operation.rows[0].categoria_id);
    }
    
    const tarifa = await pool.query(`
      SELECT * FROM fg_tarifa WHERE servicio_id = (SELECT id FROM fg_servicio WHERE codigo = '8081') AND planta_key = 201;
    `);
    console.log("TARIFA 8081 (INDEPENDENCIA):", tarifa.rows);

  } catch (err) {
    console.error("DB ERROR", err);
  } finally {
    pool.end();
  }
}

main();
