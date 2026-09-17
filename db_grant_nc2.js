const db = require('./config/database');
async function run() {
    await db.query("INSERT INTO fg_permiso (clave, descripcion, categoria, nivel) VALUES ('FAREGAS_NOTA_CREDITO', 'Emitir Notas de Crédito Faregas', 'FAREGAS', 1) ON CONFLICT DO NOTHING;");
    await db.query("INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave) SELECT p.clave, 'FAREGAS_NOTA_CREDITO' FROM fg_perfil p WHERE NOT EXISTS (SELECT 1 FROM fg_perfil_permiso WHERE perfil_clave = p.clave AND permiso_clave = 'FAREGAS_NOTA_CREDITO')");
    console.log('Permisos concedidos');
    process.exit(0);
}
run();
