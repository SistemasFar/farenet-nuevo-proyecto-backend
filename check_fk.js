const pool = require('./config/database.js'); 
async function run() { 
    try { 
        const res = await pool.query("SELECT table_name, column_name, constraint_name, foreign_table_name, foreign_column_name, update_rule, delete_rule FROM information_schema.key_column_usage JOIN information_schema.table_constraints USING (constraint_name) JOIN information_schema.referential_constraints USING (constraint_name) WHERE table_name = 'fg_usuario_sesion'"); 
        console.log(res.rows); 
        
        const countRes = await pool.query("SELECT COUNT(*) FROM fg_usuario_sesion");
        console.log("Total sessions:", countRes.rows[0].count);
        
        const fKCheck = await pool.query("SELECT COUNT(*) FROM fg_usuario_sesion WHERE usuario_username IN (SELECT username FROM fg_usuario LIMIT 10)");
        console.log("Sessions with active users limit 10:", fKCheck.rows[0].count);
        
    } catch (e) { 
        console.error(e); 
    } finally { 
        pool.end(); 
    } 
} 
run();
