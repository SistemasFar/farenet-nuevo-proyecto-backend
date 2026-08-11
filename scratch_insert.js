const bcrypt=require('bcryptjs'); 
const db=require('./config/database.js'); 
async function run() { 
  try { 
    const hash = bcrypt.hashSync('1234', 10); 
    const r = await db.query('SELECT username FROM fg_usuario WHERE username = $1', ['grodas']); 
    if (r.rowCount>0) { 
      console.log('DUPLICADO: grodas ya existe'); 
      return; 
    } 
    await db.query('INSERT INTO fg_usuario (username, contrasenha, estado, user_type) VALUES ($1, $2, true, $3)', ['grodas', hash, 'USER']); 
    console.log('INSERTADO grodas exitosamente'); 
  } catch(e) { 
    console.error(e); 
  } finally { 
    process.exit(0); 
  } 
}; 
run();
