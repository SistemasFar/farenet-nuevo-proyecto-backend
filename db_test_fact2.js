const db = require('./config/database');

async function run() {
    const res = await db.query("SELECT id, certificado_id, nro_comprobante, estado, aceptada_sunat, enlace_pdf FROM fg_facturacion ORDER BY id DESC LIMIT 5");
    console.table(res.rows);
    process.exit(0);
}

run();
