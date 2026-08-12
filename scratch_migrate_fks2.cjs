const db = require('./config/database.js');

async function migrateFKs() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    
    console.log("Modificando fg_usuario_planta (fk_fg_up_usuario)...");
    await client.query(`
      ALTER TABLE fg_usuario_planta 
      DROP CONSTRAINT fk_fg_up_usuario;
    `);
    await client.query(`
      ALTER TABLE fg_usuario_planta 
      ADD CONSTRAINT fk_fg_up_usuario 
      FOREIGN KEY (usuario_username) 
      REFERENCES fg_usuario(username) 
      ON UPDATE CASCADE 
      ON DELETE NO ACTION;
    `);
    
    console.log("Modificando fg_usuario_sesion (fk_fg_us_usuario)...");
    await client.query(`
      ALTER TABLE fg_usuario_sesion 
      DROP CONSTRAINT fk_fg_us_usuario;
    `);
    await client.query(`
      ALTER TABLE fg_usuario_sesion 
      ADD CONSTRAINT fk_fg_us_usuario 
      FOREIGN KEY (usuario_username) 
      REFERENCES fg_usuario(username) 
      ON UPDATE CASCADE 
      ON DELETE NO ACTION;
    `);
    
    await client.query('COMMIT');
    console.log("Migración FK completada exitosamente.");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error durante migración, ROLLBACK ejecutado.", e);
  } finally {
    client.release();
    
    // Verificación
    const resFkUsuario = await db.query(`
      SELECT
        tc.table_name AS origen_tabla,
        tc.constraint_name,
        rc.update_rule AS on_update,
        rc.delete_rule AS on_delete
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
      WHERE ccu.table_name = 'fg_usuario' AND tc.constraint_type = 'FOREIGN KEY'
    `);
    console.table(resFkUsuario.rows);
    process.exit(0);
  }
}
migrateFKs();
