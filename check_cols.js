const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres', host: '192.168.14.19', database: 'inspeccion',
    password: 'farenet2026**', port: 5432, connectionTimeoutMillis: 10000
});
async function main() {
    const client = await pool.connect();
    try {
        const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'fg_facturacion' ORDER BY ordinal_position");
        console.log('fg_facturacion columns:', cols.rows.map(r => r.column_name).join(', '));
        
        const credCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'fg_credito' ORDER BY ordinal_position");
        console.log('fg_credito columns:', credCols.rows.map(r => r.column_name).join(', '));
    } finally { client.release(); await pool.end(); }
}
main().catch(e => console.error('ERROR:', e.message));
