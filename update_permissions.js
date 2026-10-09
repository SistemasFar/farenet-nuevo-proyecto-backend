const db = require('./config/database');

async function migrate() {
  try {
    const query = `
      INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
      VALUES 
      ('AMINISTRADOR', 'MENU_CONFIGURACION'),
      ('AMINISTRADOR', 'MENU_CONFIGURACION_SEDES'),
      ('AMINISTRADOR', 'MENU_CONFIGURACION_CATALOGO'),
      ('AMINISTRADOR', 'MENU_CONFIGURACION_TARIFAS'),
      ('AMINISTRADOR', 'MENU_CONFIGURACION_CORRELATIVOS'),
      ('AMINISTRADOR', 'MENU_CONFIGURACION_EMPRESAS'),
      ('AMINISTRADOR', 'CONFIGURACION_SEDES'),
      ('AMINISTRADOR', 'CONFIGURACION_SERVICIOS'),
      ('AMINISTRADOR', 'CONFIGURACION_TARIFAS'),
      ('AMINISTRADOR', 'CONFIGURACION_CATEGORIAS'),
      ('AMINISTRADOR', 'CONFIGURACION_PRODUCTOS'),
      ('AMINISTRADOR', 'CONFIGURACION_SERIES'),
      ('AMINISTRADOR', 'CONFIGURACION_EMPRESAS'),
      ('AMINISTRADOR', 'MENU_CHIPS'),
      ('AMINISTRADOR', 'MENU_CHIPS_VENTAS'),
      ('AMINISTRADOR', 'CHIPS_VER'),
      ('AMINISTRADOR', 'CHIPS_VENDER'),
      ('AMINISTRADOR', 'MENU_DESCUENTOS'),
      ('AMINISTRADOR', 'DESCUENTOS_ADMINISTRAR')
      ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING
      RETURNING *;
    `;
    const res = await db.query(query);
    console.log('Permisos insertados:', res.rows.length);
    if (res.rows.length > 0) {
      res.rows.forEach(r => console.log(`- ${r.permiso_clave}`));
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
}

migrate();
