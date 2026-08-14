const pool = require('../config/database');

async function audit() {
    try {
        const q1 = await pool.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'fg_certificado_vehiculo'");
        console.log('VEHICULO:', q1.rows);
        
        const q2 = await pool.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'fg_certificado_titular'");
        console.log('TITULAR:', q2.rows);

        const q3 = await pool.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'fg_certificado_gnv'");
        console.log('GNV:', q3.rows);

        const q4 = await pool.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'fg_certificado_glp'");
        console.log('GLP:', q4.rows);
        
        const q5 = await pool.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'fg_certificado_conformidad'");
        console.log('CONFORMIDAD:', q5.rows);

        const q6 = await pool.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'fg_tipo_certificado'");
        console.log('TIPO:', q6.rows);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
audit();
