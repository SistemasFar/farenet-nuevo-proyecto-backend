const pool = require('./config/database');

async function setupDatabase() {
  try {
    console.log('Iniciando setup de tablas Multiempresa (Modelo Híbrido)...');

    // 1. Crear tabla usuario_empresa
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuario_empresa (
        usuario_username VARCHAR(100),
        empresa_key VARCHAR(50),
        activo BOOLEAN DEFAULT true,
        fechcreacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (usuario_username, empresa_key)
      );
    `);
    console.log('Tabla "usuario_empresa" creada o verificada.');

    // 2. Insertar Farenet y Faregas en la tabla empresa existente
    await pool.query(`
      INSERT INTO empresa (key, nombre, ruc, direccion, telefono, ctabanconacion) 
      VALUES 
        ('FARENET', 'FARENET S.A.C.', '20512345678', 'Av. Principal 123', '01-555-5555', '00-000-000000'),
        ('FAREGAS', 'FAREGAS S.A.C.', '20587654321', 'Av. Secundaria 456', '01-666-6666', '00-111-111111')
      ON CONFLICT (key) DO NOTHING;
    `);
    console.log('Datos base de empresas Farenet y Faregas insertados.');

    // 3. Asignar Farenet y Faregas a los primeros 5 usuarios que existan (para facilitar el desarrollo)
    const resUser = await pool.query(`SELECT username FROM usuario LIMIT 5`);
    
    if (resUser.rows.length > 0) {
      for (const user of resUser.rows) {
        await pool.query(`
          INSERT INTO usuario_empresa (usuario_username, empresa_key)
          VALUES 
            ($1, 'FARENET'),
            ($1, 'FAREGAS')
          ON CONFLICT DO NOTHING;
        `, [user.username]);
        console.log(`Empresas Farenet y Faregas asignadas al usuario ${user.username}.`);
      }
    }

    console.log('✅ Setup completado exitosamente.');
  } catch (error) {
    console.error('❌ Error ejecutando el setup:', error);
  } finally {
    await pool.end();
  }
}

setupDatabase();
