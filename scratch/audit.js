const fs = require('fs');
const db = require('../config/database');

async function main() {
    console.log("Iniciando extracción...");
    const client = await db.connect();
    
    try {
        const tablesRes = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);
        const tables = tablesRes.rows.map(r => r.table_name);
        
        const schema = {};
        for (let t of tables) {
            console.log("Analizando " + t + "...");
            const rowCountRes = await client.query("SELECT count(*) FROM \"" + t + "\"");
            const rowCount = parseInt(rowCountRes.rows[0].count);
            
            const colsRes = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1 
                ORDER BY ordinal_position
            `, [t]);
            
            const consRes = await client.query(`
                SELECT 
                    tc.constraint_type, 
                    kcu.column_name, 
                    ccu.table_name AS foreign_table_name,
                    ccu.column_name AS foreign_column_name,
                    rc.update_rule,
                    rc.delete_rule
                FROM information_schema.table_constraints tc 
                JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name 
                LEFT JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
                LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
                WHERE tc.table_name = $1
            `, [t]);
            
            schema[t] = {
                rowCount,
                columns: colsRes.rows,
                constraints: consRes.rows
            };
        }
        
        fs.writeFileSync('schema_dump.json', JSON.stringify(schema, null, 2));
        console.log("Extracción completada en schema_dump.json");
    } finally {
        client.release();
    }
    process.exit(0);
}

main().catch(console.error);
