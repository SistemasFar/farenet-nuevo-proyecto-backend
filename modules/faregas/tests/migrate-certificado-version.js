const db = require('../../../config/database');
async function run() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    
    // Add formato_version_id to fg_certificado if it doesn't exist
    await client.query("ALTER TABLE fg_certificado ADD COLUMN IF NOT EXISTS formato_version_id INTEGER REFERENCES fg_certificado_formato_version(id)");
    
    await client.query('COMMIT');
    console.log('Migration successful');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
  } finally {
    client.release();
    process.exit();
  }
}
run();
