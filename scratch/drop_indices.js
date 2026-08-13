const db = require('../config/database');

async function run() {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        console.log("Eliminando índices redundantes...");
        await client.query(`
            DROP INDEX IF EXISTS idx_fg_certificado_nro;
            DROP INDEX IF EXISTS idx_fg_cert_glp_comp_cert;
            DROP INDEX IF EXISTS idx_fg_cert_glp_verif_cert;
            DROP INDEX IF EXISTS idx_fg_cert_gnv_verif_cert;
            DROP INDEX IF EXISTS idx_fg_cert_titular_cert;
        `);
        
        await client.query('COMMIT');
        console.log("✅ Índices redundantes eliminados con éxito.");

        console.log("\\nValidando existencia de restricciones UNIQUE y sus índices subyacentes...");
        const targetTables = [
            'fg_certificado',
            'fg_certificado_glp_componente',
            'fg_certificado_glp_verificacion',
            'fg_certificado_gnv_verificacion',
            'fg_certificado_titular'
        ];
        
        const idxQuery = `
            SELECT
                t.relname as table_name,
                i.relname as index_name,
                ix.indisunique,
                ix.indisprimary
            FROM
                pg_class t,
                pg_class i,
                pg_index ix
            WHERE
                t.oid = ix.indrelid
                and i.oid = ix.indexrelid
                and t.relkind = 'r'
                and t.relname = ANY($1)
            ORDER BY t.relname;
        `;
        const idxs = await client.query(idxQuery, [targetTables]);
        
        idxs.rows.forEach(idx => {
            console.log(`- [${idx.table_name}] Índice: ${idx.index_name} (Único: ${idx.indisunique}, PK: ${idx.indisprimary})`);
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("❌ ERROR, ROLLBACK EJECUTADO:", error);
    } finally {
        client.release();
    }
    process.exit(0);
}
run();
