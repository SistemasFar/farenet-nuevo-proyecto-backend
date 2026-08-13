const db = require('../../config/database');
const fs = require('fs');

async function getTables(client) {
    const res = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'fg_%' ORDER BY tablename");
    return res.rows.map(r => r.tablename);
}

async function getColumns(client, tableName) {
    const res = await client.query(`
        SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
    `, [tableName]);
    return res.rows;
}

async function getConstraints(client, tableName) {
    const res = await client.query(`
        SELECT tc.constraint_type, tc.constraint_name, kcu.column_name, 
               ccu.table_name AS foreign_table_name,
               ccu.column_name AS foreign_column_name, 
               rc.update_rule, rc.delete_rule,
               cc.check_clause
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        LEFT JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
        LEFT JOIN information_schema.check_constraints cc ON tc.constraint_name = cc.constraint_name
        WHERE tc.table_name = $1
    `, [tableName]);
    return res.rows;
}

async function getIndexesAndExclude(client, tableName) {
    const res = await client.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = $1
    `, [tableName]);
    return res.rows;
}

async function run() {
    const client = await db.connect();
    try {
        const tables = await getTables(client);
        const data = {};
        for(let t of tables) {
            data[t] = {
                columns: await getColumns(client, t),
                constraints: await getConstraints(client, t),
                indexes: await getIndexesAndExclude(client, t)
            };
        }
        fs.writeFileSync('schema_raw.json', JSON.stringify(data, null, 2));
        console.log("Extracted schema to schema_raw.json. Total fg_ tables: " + tables.length);
    } catch(e) {
        console.error(e);
    } finally {
        client.release();
    }
    process.exit(0);
}
run();
