const db = require('./config/database');

async function main() {
    const ids = [159, 160, 161, 162];
    
    for (const formatoId of ids) {
        const res = await db.query("SELECT id, estado, configuracion FROM fg_certificado_formato_version WHERE formato_id = $1", [formatoId]);
        
        for (const row of res.rows) {
            let conf = row.configuracion;
            if (!conf || !conf.html) continue;

            let html = conf.html;

            // Update the cabecera-fija style to make it left-aligned but internally centered
            html = html.replace(
                /<div class="cabecera-fija" style="text-align: center; margin-bottom: 15px; font-size: 10px; line-height: 1\.4;">/g, 
                '<div class="cabecera-fija" style="display: inline-block; text-align: center; margin-bottom: 15px; font-size: 10px; line-height: 1.4;">'
            );

            conf.html = html;

            await db.query("UPDATE fg_certificado_formato_version SET configuracion = $1 WHERE id = $2", [conf, row.id]);
            console.log(`Updated HTML for format ${formatoId}, version ${row.id} (${row.estado})`);
        }
    }
    
    process.exit(0);
}

main().catch(console.error);
