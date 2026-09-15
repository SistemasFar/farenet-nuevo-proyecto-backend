const db = require('./config/database');
async function run() {
    try {
        await db.query(`
ALTER TABLE fg_tipo_certificado ADD COLUMN IF NOT EXISTS ancho_correlativo SMALLINT;
ALTER TABLE fg_tipo_certificado DROP CONSTRAINT IF EXISTS ck_fg_tipo_certificado_ancho_correlativo;
ALTER TABLE fg_tipo_certificado ADD CONSTRAINT ck_fg_tipo_certificado_ancho_correlativo CHECK (ancho_correlativo IS NULL OR ancho_correlativo BETWEEN 1 AND 12);

UPDATE fg_tipo_certificado SET ancho_correlativo = 7 WHERE clave = 'GNV_ANUAL';
UPDATE fg_tipo_certificado SET ancho_correlativo = 6 WHERE clave = 'GLP_ANUAL';
UPDATE fg_tipo_certificado SET ancho_correlativo = 6 WHERE clave = 'CONFORMIDAD';
`);
        console.log("Migration executed successfully.");
    } catch(e) { console.error(e); } finally { process.exit(0); }
}
run();