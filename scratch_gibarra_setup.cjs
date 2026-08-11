const db = require('./config/database.js');

async function runTest() {
  try {
    console.log("=== FASE 1: AUDITORÍA PREVIA FARENET ===");
    const uResult = await db.query("SELECT username, estado, perfil_id, user_type, contrasenha FROM usuario WHERE username = 'gibarra'");
    if (uResult.rowCount === 0) {
      console.log("gibarra no existe en usuario FARENET");
      return process.exit(0);
    }
    const user = uResult.rows[0];
    console.log(`Username: ${user.username}`);
    console.log(`Estado: ${user.estado}`);
    console.log(`Perfil actual: ${user.perfil_id}`);
    console.log(`User Type: ${user.user_type}`);

    const pResult = await db.query("SELECT COUNT(*) FROM usuario_planta WHERE usuario_username = $1", [user.username]);
    console.log(`Plantas asignadas: ${pResult.rows[0].count}`);

    console.log("\n=== FASE 2: PERFIL SISTEMAS FARENET ===");
    const perfResult = await db.query("SELECT clave, nombre FROM perfil WHERE UPPER(nombre) LIKE '%SISTEMAS%'");
    if (perfResult.rowCount === 0) {
        console.log("NO SE ENCONTRÓ PERFIL SISTEMAS EN FARENET");
        return process.exit(0);
    }
    const sysPerfilId = perfResult.rows[0].clave;
    console.log(`Clave real: ${sysPerfilId}, Nombre: ${perfResult.rows[0].nombre}`);

    // Update perfil in FARENET
    await db.query("UPDATE usuario SET perfil_id = $1 WHERE username = $2", [sysPerfilId, user.username]);
    console.log(`gibarra actualizado a perfil SISTEMAS en FARENET (${sysPerfilId})`);

    console.log("\n=== FASE 3: CREDENCIAL REAL ===");
    const hash = user.contrasenha;
    if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
      console.log("Algoritmo compatible con bcrypt: SI");
    } else {
      console.log("Algoritmo compatible con bcrypt: NO, asumiendo plain text u otro (funciona igual en FAREGAS con bcrypt.compare fallback si es plain)");
    }

    console.log("\n=== FASE 4: PLANTAS FARENET ===");
    const allPlants = await db.query("SELECT key FROM planta");
    console.log(`Total plantas FARENET: ${allPlants.rowCount}`);
    
    // Solo insertar las que faltan
    let assigned = 0;
    for(const p of allPlants.rows) {
      const exists = await db.query("SELECT 1 FROM usuario_planta WHERE usuario_username = $1 AND plantas_key = $2", [user.username, p.key]);
      if (exists.rowCount === 0) {
        await db.query("INSERT INTO usuario_planta (usuario_username, plantas_key) VALUES ($1, $2)", [user.username, p.key]);
        assigned++;
      }
    }
    console.log(`Nuevas plantas insertadas en FARENET para gibarra: ${assigned}`);
    const currentPResult = await db.query("SELECT COUNT(*) FROM usuario_planta WHERE usuario_username = $1", [user.username]);
    console.log(`Total asignadas en usuario_planta: ${currentPResult.rows[0].count}`);

    console.log("\n=== FASE 5 & 6: ACTUALIZAR EN FAREGAS ===");
    const fgUResult = await db.query("SELECT username FROM fg_usuario WHERE username = 'gibarra'");
    let changes = 0;
    if (fgUResult.rowCount === 0) {
      await db.query(`
        INSERT INTO fg_usuario (username, contrasenha, perfil_id, estado, user_type) 
        VALUES ($1, $2, $3, $4, $5)
      `, [user.username, hash, 'SISTEMAS', true, 'USER']);
      console.log("gibarra CREADO en fg_usuario");
      changes++;
    } else {
      await db.query(`
        UPDATE fg_usuario 
        SET contrasenha = $1, perfil_id = $2, estado = $3 
        WHERE username = 'gibarra'
      `, [hash, 'SISTEMAS', true]);
      console.log("gibarra ACTUALIZADO en fg_usuario");
      changes++;
    }

    console.log("\n=== FASE 7: PLANTAS FAREGAS ===");
    // SISTEMAS en FAREGAS usa todas fg_planta por regla.
    const fgPl = await db.query("SELECT COUNT(*) FROM fg_planta");
    console.log(`COUNT(fg_planta): ${fgPl.rows[0].count}`);
    console.log("No se inserta en fg_usuario_planta porque perfil SISTEMAS ya tiene bypass en faregas-auth.service.js");

    console.log("\n=== FASE 8: VERIFICACIÓN FÍSICA POSTERIOR ===");
    const postU = await db.query("SELECT username, estado, perfil_id FROM usuario WHERE username = 'gibarra'");
    console.log("FARENET:", postU.rows[0]);
    const postFg = await db.query("SELECT username, estado, perfil_id FROM fg_usuario WHERE username = 'gibarra'");
    console.log("FAREGAS:", postFg.rows[0]);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

runTest();
