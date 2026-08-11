const db=require('./config/database.js'); 
async function run() { 
  try { 
    const u = await db.query("SELECT * FROM fg_usuario WHERE username='grodas'");
    console.log('fg_usuario grodas:', u.rowCount > 0);

    const p = await db.query('SELECT key, nombre FROM fg_planta LIMIT 20'); 
    console.log('fg_planta:', p.rows); 
    
    const up = await db.query("SELECT p.key, p.nombre FROM fg_usuario_planta up JOIN fg_planta p ON up.planta_id = p.id JOIN fg_usuario u ON up.usuario_id = u.id WHERE u.username='grodas'"); 
    console.log('fg_usuario_planta grodas:', up.rows); 
    
    const us = await db.query('SELECT count(*) FROM fg_usuario_sesion'); 
    console.log('fg_usuario_sesion:', us.rows); 
  } catch(e){ 
    console.error(e) 
  } finally { 
    process.exit(0); 
  } 
} 
run();
