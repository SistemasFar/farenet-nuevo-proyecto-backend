const db = require('./config/database.js');

async function runTest() {
  try {
    const u = await db.query("SELECT contrasenha FROM usuario WHERE username = 'gibarra'");
    console.log('Length:', u.rows[0].contrasenha.length);
    console.log('Starts with:', u.rows[0].contrasenha.substring(0, 10));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

runTest();
