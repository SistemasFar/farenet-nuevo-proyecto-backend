const db = require('./config/database.js');

async function auditDB() {
  try {
    // 1. Verificar fg_usuario para grodas
    const user = await db.query("SELECT username, user_type, perfil_id, estado, persona_nrodocumentoidentidad FROM fg_usuario WHERE username = 'grodas'");
    console.log("=== 1. GRODAS EN fg_usuario ===");
    console.log(user.rows);

    // 2. Verificar fg_perfil para SISTEMAS
    const perfil = await db.query("SELECT clave, nombre, visible FROM fg_perfil WHERE clave = 'SISTEMAS'");
    console.log("=== 2. PERFIL SISTEMAS EN fg_perfil ===");
    console.log(perfil.rows);

    // 7. Contar fg_planta y planta
    const fgPlantaCount = await db.query("SELECT COUNT(*) FROM fg_planta");
    const plantaCount = await db.query("SELECT COUNT(*) FROM planta");
    console.log("=== 7. CONTEO PLANTAS ===");
    console.log("fg_planta:", fgPlantaCount.rows[0].count);
    console.log("planta:", plantaCount.rows[0].count);

    // 8. Comparación (simplificada a diferencias)
    const fgPlantas = await db.query("SELECT key, nombre FROM fg_planta ORDER BY key");
    const plantas = await db.query("SELECT key, nombre FROM planta ORDER BY key");
    let fgKeys = fgPlantas.rows.map(r => r.key);
    let pKeys = plantas.rows.map(r => r.key);
    console.log("=== 8. COMPARACIÓN DE CATÁLOGOS ===");
    console.log("Total fg_planta:", fgKeys.length);
    console.log("Total planta:", pKeys.length);
    
    // 13. fg_usuario_sesion para grodas
    const fgSesion = await db.query("SELECT id, usuario_username, isactive, planta_key, logintime_utc FROM fg_usuario_sesion WHERE usuario_username = 'grodas'");
    console.log("=== 13. SESIÓN EN fg_usuario_sesion ===");
    console.log(fgSesion.rows);

    // 14. usuario_sesion para grodas (FARENET)
    const fSesion = await db.query("SELECT id, usuario_username, isactive, planta_key, logintime_utc FROM usuario_sesion WHERE usuario_username = 'grodas'");
    console.log("=== 14. SESIÓN EN usuario_sesion (FARENET) ===");
    console.log(fSesion.rows);

  } catch (err) {
    console.error("Error en auditoría DB:", err);
  } finally {
    process.exit(0);
  }
}

auditDB();
