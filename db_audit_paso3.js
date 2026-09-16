const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/faregas'
});

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT id, codigo, nombre, producto_facturacion_id
    FROM fg_producto_inventariable
    WHERE tipo = 'CHIP_SERIALIZADO' AND control_stock = true AND activo = true
  `);
  console.log('CHIPS:', res.rows);
  
  const fk = await client.query(`
    SELECT
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
    FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name='fg_producto_inventariable';
  `);
  console.log('FKS:', fk.rows);

  const certSchema = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'fg_certificado'
  `);
  console.log('CERT_COLS:', certSchema.rows.map(r => r.column_name).join(', '));
  
  await client.end();
}
run().catch(console.error);
