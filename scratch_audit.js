const db = require('./config/database');
async function run() {
    const client = await db.connect();
    try {
        // Filas existentes
        const gnvCount = await client.query('SELECT COUNT(*) FROM fg_certificado_gnv');
        const glpCount = await client.query('SELECT COUNT(*) FROM fg_certificado_glp');
        console.log('Filas fg_certificado_gnv:', gnvCount.rows[0].count);
        console.log('Filas fg_certificado_glp:', glpCount.rows[0].count);

        // Columnas actuales GNV
        const gnvCols = await client.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'fg_certificado_gnv' ORDER BY ordinal_position`);
        console.log('\nColumnas fg_certificado_gnv:', gnvCols.rows.map(r => r.column_name));

        // Columnas actuales GLP
        const glpCols = await client.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'fg_certificado_glp' ORDER BY ordinal_position`);
        console.log('Columnas fg_certificado_glp:', glpCols.rows.map(r => r.column_name));

        // Columnas fg_taller_autorizado
        const tallerCols = await client.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'fg_taller_autorizado' ORDER BY ordinal_position`);
        console.log('\nColumnas fg_taller_autorizado:', tallerCols.rows);

        // Filas existentes en talleres
        const talleres = await client.query('SELECT * FROM fg_taller_autorizado');
        console.log('Filas fg_taller_autorizado:', talleres.rows);

    } catch(e) {
        console.error(e.message);
    } finally {
        client.release();
        process.exit(0);
    }
}
run();
