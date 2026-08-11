const db = require('./config/database.js');

async function run() {
  try {
    const colsPlanta = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fg_planta'");
    console.log('=== fg_planta columns ===');
    console.log(colsPlanta.rows);
    
    const colsUp = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fg_usuario_planta'");
    console.log('=== fg_usuario_planta columns ===');
    console.log(colsUp.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
