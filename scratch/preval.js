const db = require('../config/database');
async function run() {
    try {
        const client = await db.connect();
        const res = await client.query(`
            SELECT table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale 
            FROM information_schema.columns 
            WHERE table_name IN ('fg_usuario', 'fg_planta', 'vehiculo', 'fg_auditoria_acceso') 
            AND column_name IN (
                'username', 'key', 'fecha_creacion', 'nroplacaantigua', 'categoriaextra', 
                'vehiculoclase_key', 'marca_key', 'modelo_key', 'nromotor', 'combustible_key', 
                'color_key', 'carroceria_key', 'vin', 'nroserie', 'fecha_evento', 'pesobruto', 'pesoseco', 'nroejes'
            );
        `);
        console.log(JSON.stringify(res.rows, null, 2));
        client.release();
    } catch(e) { console.error(e); }
    process.exit(0);
}
run();
