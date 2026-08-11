const db = require('./config/database.js');

async function run() {
    try {
        console.log('--- INICIALIZANDO DB FAREGAS ---');
        
        // 1. Crear perfil SISTEMAS
        await db.query(`
            INSERT INTO fg_perfil (clave, nombre, visible)
            VALUES ('SISTEMAS', 'Sistemas', true)
            ON CONFLICT (clave) DO NOTHING;
        `);
        console.log('Perfil SISTEMAS verificado/creado.');

        // 2. Asignar perfil a grodas
        await db.query(`
            UPDATE fg_usuario 
            SET perfil_id = 'SISTEMAS'
            WHERE username = 'grodas'
        `);
        console.log('Perfil SISTEMAS asignado a grodas.');

        // 3. Copiar plantas si fg_planta está vacía
        const c = await db.query('SELECT COUNT(*) FROM fg_planta');
        if (Number(c.rows[0].count) === 0) {
            console.log('fg_planta está vacía. Copiando desde planta...');
            await db.query(`
                INSERT INTO fg_planta (key, nombre, direccion, telefono)
                SELECT key, nombre, direccion, telefono
                FROM planta
            `);
            console.log('Catálogo de plantas copiado.');
        } else {
            console.log(`fg_planta no está vacía (tiene ${c.rows[0].count} filas). Se omitió la copia.`);
        }

        console.log('--- DB FAREGAS LISTA ---');
    } catch(e) {
        console.error('Error DB:', e);
    } finally {
        process.exit(0);
    }
}
run();
