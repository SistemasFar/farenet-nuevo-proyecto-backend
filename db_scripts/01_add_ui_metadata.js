const pool = require('../config/database');

async function run() {
  try {
    console.log("Adding ui_metadata column to inspeccion table...");
    await pool.query(`
      ALTER TABLE inspeccion 
      ADD COLUMN IF NOT EXISTS ui_metadata JSONB DEFAULT '{}'::jsonb;
    `);
    console.log("✅ Column ui_metadata successfully added.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error adding column:", err.message);
    process.exit(1);
  }
}

run();
