const { Client } = require('pg');
const client = new Client({ connectionString: 'postgres://postgres:farenet2026**@192.168.14.19:5432/inspeccion' });

async function run() {
  try {
    await client.connect();

    // 1. Get physical products
    const resChips = await client.query(`SELECT id, codigo, nombre FROM fg_producto_inventariable WHERE codigo IN ('CHIP', 'HOJA_GLP', 'HOJA_CONFORMIDAD')`);
    const physicalProducts = resChips.rows;
    console.log('--- PRODUCTOS FÍSICOS ---');
    console.table(physicalProducts);

    // 2. Get fiscal products
    const resFiscales = await client.query(`
      SELECT id, codigo_sku, descripcion 
      FROM fg_producto_facturacion 
      WHERE descripcion ILIKE '%CHIP%' OR codigo_sku IN ('130', '132')
    `);
    const fiscalProducts = resFiscales.rows;
    console.log('\n--- PRODUCTOS FISCALES ---');
    console.table(fiscalProducts);

    // 3. Check if column exists
    const resCols = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'fg_producto_facturacion' AND column_name = 'producto_inventariable_id';
    `);
    console.log('\n--- COLUMNA producto_inventariable_id EXISTE? ---');
    console.log(resCols.rowCount > 0 ? 'SÍ' : 'NO');

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
