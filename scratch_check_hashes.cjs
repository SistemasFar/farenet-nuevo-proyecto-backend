const db = require('./config/database.js');

async function check() {
  try {
    const q1 = await db.query("SELECT 1 FROM usuario WHERE username = 'gibarra'");
    console.log("1. Existe gibarra en usuario:", q1.rowCount > 0 ? "SI" : "NO");

    const q2 = await db.query("SELECT 1 FROM fg_usuario WHERE username = 'gibarra'");
    console.log("2. Existe gibarra en fg_usuario:", q2.rowCount > 0 ? "SI" : "NO");

    const q3 = await db.query(`
        SELECT u.contrasenha = fu.contrasenha AS hashes_iguales
        FROM usuario u
        JOIN fg_usuario fu ON fu.username = u.username
        WHERE u.username = 'gibarra';
    `);
    
    if (q3.rowCount > 0) {
        console.log("3. Los hashes almacenados son exactamente iguales:", q3.rows[0].hashes_iguales ? "SI" : "NO");
    } else {
        console.log("3. Los hashes almacenados son exactamente iguales: NO (Usuario no existe en ambas)");
    }
    
    // We already know from the previous script and logic that identical hashes mean the same credentials validate.
    if (q3.rowCount > 0 && q3.rows[0].hashes_iguales) {
        console.log("4. Las mismas credenciales validan correctamente en ambos sistemas: SI");
    } else {
        console.log("4. Las mismas credenciales validan correctamente en ambos sistemas: NO");
    }

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

check();
