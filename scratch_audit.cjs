const db = require('./config/database.js');

async function audit() {
  try {
    console.log("=== 4. AUDITAR fg_usuario ===");
    const resUsuarios = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'fg_usuario'
    `);
    console.table(resUsuarios.rows);

    console.log("=== 5. FK QUE APUNTAN A fg_usuario ===");
    const resFkUsuario = await db.query(`
      SELECT
        tc.table_name AS origen_tabla,
        kcu.column_name AS origen_columna,
        ccu.table_name AS destino_tabla,
        ccu.column_name AS destino_columna,
        rc.update_rule AS on_update,
        rc.delete_rule AS on_delete
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
      WHERE ccu.table_name = 'fg_usuario'
    `);
    console.table(resFkUsuario.rows);

    console.log("=== 8. AUDITAR fg_perfil ===");
    const resPerfil = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'fg_perfil'
    `);
    console.table(resPerfil.rows);
    
    const resPerfilData = await db.query(`SELECT clave, nombre, visible FROM fg_perfil`);
    console.table(resPerfilData.rows);

    console.log("=== 9. FK QUE APUNTAN A fg_perfil ===");
    const resFkPerfil = await db.query(`
      SELECT
        tc.table_name AS origen_tabla,
        kcu.column_name AS origen_columna,
        ccu.table_name AS destino_tabla,
        ccu.column_name AS destino_columna,
        rc.update_rule AS on_update,
        rc.delete_rule AS on_delete
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
      WHERE ccu.table_name = 'fg_perfil'
    `);
    console.table(resFkPerfil.rows);

    console.log("=== 11. AUDITAR fg_usuario_planta ===");
    const resUp = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'fg_usuario_planta'
    `);
    console.table(resUp.rows);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

audit();
