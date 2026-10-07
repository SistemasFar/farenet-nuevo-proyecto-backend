const db = require('./config/database');

async function main() {
    const ids = [159, 160, 161, 162];
    
    for (const formatoId of ids) {
        const res = await db.query("SELECT id, estado, configuracion FROM fg_certificado_formato_version WHERE formato_id = $1 AND estado = 'VIGENTE'", [formatoId]);
        
        for (const row of res.rows) {
            let conf = row.configuracion;
            if (!conf || !conf.html) continue;

            let html = conf.html;

            // Replace R.D. N
            html = html.replace(/R\.D\. N°\s*\{\{empresa\.resolucion\}\}/g, "R.D. N° 0296-2024-MTC /17.03");
            html = html.replace(/Domicilio Fiscal:\s*\{\{empresa\.direccion\}\}/g, "Domicilio Fiscal: Calle Alberto Secada N° 315");
            html = html.replace(/Celular:\s*\{\{empresa\.telefono\}\}/g, "Celular: 966702160");
            
            // Wait, also "La empresa {{empresa.razon_social}}, autorizada como Entidad Certificadora de Conversión a {{inspeccion.tipo_combustible}}, con R.D. N° {{empresa.resolucion}}"
            html = html.replace(/La empresa\s*\{\{empresa\.razon_social\}\}/g, "La empresa FAREGAS S.A.C.");
            html = html.replace(/con R\.D\. N°\s*\{\{empresa\.resolucion\}\}/g, "con R.D. N° 0296-2024-MTC /17.03");

            conf.html = html;

            await db.query("UPDATE fg_certificado_formato_version SET configuracion = $1 WHERE id = $2", [conf, row.id]);
            console.log(`Updated HTML for format ${formatoId}, version ${row.id}`);
        }
    }
    
    process.exit(0);
}

main().catch(console.error);
