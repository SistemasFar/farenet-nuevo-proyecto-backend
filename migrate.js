const pool = require('./config/database.js');

async function run() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Create fg_perfil_planta
        await client.query(`
            CREATE TABLE IF NOT EXISTS fg_perfil_planta (
                perfil_clave VARCHAR(255) NOT NULL,
                planta_key VARCHAR(20) NOT NULL,
                PRIMARY KEY (perfil_clave, planta_key),
                FOREIGN KEY (perfil_clave) REFERENCES fg_perfil(clave),
                FOREIGN KEY (planta_key) REFERENCES fg_planta(key)
            )
        `);

        // 2. Insert for SISTEMAS
        await client.query(`
            INSERT INTO fg_perfil_planta (perfil_clave, planta_key)
            SELECT 'SISTEMAS', key FROM fg_planta
            ON CONFLICT DO NOTHING
        `);

        // 3. Create permissions if not exist
        await client.query(`
            INSERT INTO fg_permiso (clave, nombre, modulo, activo)
            VALUES 
                ('MENU_INICIO', 'Inicio', 'MENU', true),
                ('MENU_USUARIOS', 'Usuarios', 'MENU', true)
            ON CONFLICT (clave) DO NOTHING
        `);

        // 4. Assign permissions to SISTEMAS
        await client.query(`
            INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
            VALUES 
                ('SISTEMAS', 'MENU_INICIO'),
                ('SISTEMAS', 'MENU_USUARIOS')
            ON CONFLICT DO NOTHING
        `);

        await client.query('COMMIT');
        
        // Report
        const c1 = await client.query("SELECT COUNT(*) FROM fg_planta");
        const c2 = await client.query("SELECT COUNT(*) FROM fg_perfil_planta WHERE perfil_clave = 'SISTEMAS'");
        const c3 = await client.query("SELECT clave FROM fg_permiso WHERE clave IN ('MENU_INICIO', 'MENU_USUARIOS')");
        const c4 = await client.query("SELECT permiso_clave FROM fg_perfil_permiso WHERE perfil_clave = 'SISTEMAS'");
        
        console.log("Resultados DDL:");
        console.log("Cantidad fg_planta:", c1.rows[0].count);
        console.log("Cantidad fg_perfil_planta para SISTEMAS:", c2.rows[0].count);
        console.log("Permisos MENU creados/existentes:", c3.rows.map(r => r.clave).join(', '));
        console.log("Permisos asignados a SISTEMAS:", c4.rows.map(r => r.permiso_clave).join(', '));
        
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
    } finally {
        client.release();
        process.exit(0);
    }
}

run();
