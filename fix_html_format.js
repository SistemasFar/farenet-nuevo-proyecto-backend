const db = require('./config/database');

async function main() {
    const ids = [159, 160, 161, 162];
    
    for (const formatoId of ids) {
        const res = await db.query("SELECT id, estado, configuracion FROM fg_certificado_formato_version WHERE formato_id = $1", [formatoId]);
        
        for (const row of res.rows) {
            let conf = row.configuracion;
            if (!conf || !conf.html) continue;

            let html = conf.html;

            // Remove the user's manual space-indented block if it exists
            html = html.replace(/<div><p><\/p><p><\/p><p>\s*R\.D\. N°[\s\S]*?Celular: 966702160<\/p><\/div>/, '');

            // Ensure we don't duplicate the block if already added properly
            if (!html.includes('cabecera-fija')) {
                // We will insert the block right before <h1 class="titulo-principal">
                const block = `<div class="cabecera-fija" style="text-align: center; margin-bottom: 15px; font-size: 10px; line-height: 1.4;">
<p style="margin: 0;">R.D. N° 0296-2024-MTC /17.03</p>
<p style="margin: 0;">Domicilio Fiscal: Calle Alberto Secada N° 315</p>
<p style="margin: 0;">Provincia Constitucional del Callao</p>
<p style="margin: 0;">Celular: 966702160</p>
</div>`;
                html = html.replace(/(<h1 class="titulo-principal">)/, block + '\n$1');
            }

            // Also make sure to replace any leftover variables in paragraph
            html = html.replace(/La empresa <strong><span data-faregas-var="empresa\.razon_social"[^>]*>\{\{empresa\.razon_social\}\}<\/span><\/strong>/g, "La empresa <strong>FAREGAS S.A.C.</strong>");
            html = html.replace(/con R\.D\. N° <span data-faregas-var="empresa\.resolucion"[^>]*>\{\{empresa\.resolucion\}\}<\/span>/g, "con R.D. N° 0296-2024-MTC /17.03");
            
            // And generic ones
            html = html.replace(/\{\{empresa\.razon_social\}\}/g, "FAREGAS S.A.C.");
            html = html.replace(/\{\{empresa\.resolucion\}\}/g, "0296-2024-MTC /17.03");

            conf.html = html;

            await db.query("UPDATE fg_certificado_formato_version SET configuracion = $1 WHERE id = $2", [conf, row.id]);
            console.log(`Updated HTML for format ${formatoId}, version ${row.id} (${row.estado})`);
        }
    }
    
    process.exit(0);
}

main().catch(console.error);
