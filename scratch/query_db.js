const db = require('../config/database');
const fs = require('fs');

async function run() {
    const client = await db.connect();
    let report = "";
    try {
        const q1 = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'seriedocumento'
        `);
        report += "### seriedocumento columns:\n";
        q1.rows.forEach(r => report += `${r.column_name} (${r.data_type})\n`);

        const q2 = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'seriedocumentobase'
        `);
        report += "\n### seriedocumentobase columns:\n";
        q2.rows.forEach(r => report += `${r.column_name} (${r.data_type})\n`);

        const q3 = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'seriedocumentoot'
        `);
        report += "\n### seriedocumentoot columns:\n";
        q3.rows.forEach(r => report += `${r.column_name} (${r.data_type})\n`);

        const q4 = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'tipocertificado'
        `);
        report += "\n### tipocertificado columns:\n";
        q4.rows.forEach(r => report += `${r.column_name} (${r.data_type})\n`);

        const q5 = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'certificado'
        `);
        report += "\n### certificado columns:\n";
        q5.rows.forEach(r => report += `${r.column_name} (${r.data_type})\n`);

        const d1 = await client.query(`SELECT * FROM seriedocumento LIMIT 5`);
        report += "\n### Data seriedocumento:\n" + JSON.stringify(d1.rows, null, 2);

        const d2 = await client.query(`SELECT * FROM seriedocumentobase LIMIT 5`);
        report += "\n### Data seriedocumentobase:\n" + JSON.stringify(d2.rows, null, 2);

        const d3 = await client.query(`SELECT nrodocumentocertificado, estado, anulado, fechcreacion FROM certificado LIMIT 5`);
        report += "\n### Data certificado:\n" + JSON.stringify(d3.rows, null, 2);

        fs.writeFileSync('scratch/db_audit.txt', report);
        console.log("Done");
    } catch(e) { console.error(e); } finally { client.release(); }
    process.exit(0);
}
run();
