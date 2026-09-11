const db = require('../../../config/database');
async function run() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    
    // Add formato_datos_snapshot to fg_certificado if it doesn't exist
    await client.query("ALTER TABLE fg_certificado ADD COLUMN IF NOT EXISTS formato_datos_snapshot JSONB");
    
    await client.query('COMMIT');
    console.log('Snapshot migration successful');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
  } finally {
    client.release();
    process.exit();
  }
}
run();
