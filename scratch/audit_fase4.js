require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT)
});

async function runAudit() {
  await client.connect();
  const tables = [
    'fg_certificado_gnv',
    'fg_certificado_gnv_verificacion',
    'fg_certificado_glp',
    'fg_certificado_glp_componente',
    'fg_certificado_glp_verificacion',
    'fg_certificado_conformidad',
    'fg_taller_autorizado'
  ];

  const results = {};

  for (const table of tables) {
    const columnsRes = await client.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position;
    `, [table]);
    
    const constraintsRes = await client.query(`
        SELECT
            tc.constraint_name,
            tc.constraint_type,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name,
            rc.update_rule,
            rc.delete_rule
        FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            LEFT JOIN information_schema.referential_constraints AS rc
              ON tc.constraint_name = rc.constraint_name
              AND tc.constraint_schema = rc.constraint_schema
            LEFT JOIN information_schema.constraint_column_usage AS ccu
              ON rc.unique_constraint_name = ccu.constraint_name
              AND rc.constraint_schema = ccu.constraint_schema
        WHERE tc.table_name = $1;
    `, [table]);

    results[table] = {
      columns: columnsRes.rows,
      constraints: constraintsRes.rows
    };
  }

  const fs = require('fs');
  fs.writeFileSync('C:\\Users\\Sistemas2\\.gemini\\antigravity-ide\\brain\\067fb97b-563f-46c1-a117-76763f8ed83d\\scratch\\audit_fase4_output.json', JSON.stringify(results, null, 2));
  console.log('Done');
  await client.end();
}

runAudit().catch(err => console.error(err));
