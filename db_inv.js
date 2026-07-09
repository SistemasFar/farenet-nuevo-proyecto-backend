require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function run() {
  await client.connect();
  
  console.log('--- 1. Columnas candidatas ---');
  const q1 = `
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
            column_name ILIKE '%tipoplaca%'
         OR column_name ILIKE '%tipo_placa%'
         OR column_name ILIKE '%tipo%placa%'
         OR column_name ILIKE '%placa%tipo%'
         OR column_name ILIKE '%placatipo%'
         OR column_name ILIKE '%placa%'
      )
    ORDER BY table_name, ordinal_position;
  `;
  const res1 = await client.query(q1);
  console.table(res1.rows);
  
  console.log('\n--- 2. Foreign keys hacia tipoplaca ---');
  const q2 = `
    SELECT tc.table_schema, tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'tipoplaca'
    ORDER BY tc.table_name, kcu.column_name;
  `;
  const res2 = await client.query(q2);
  console.table(res2.rows);

  console.log('\n--- 3. tipoplaca rows ---');
  const q3 = `SELECT * FROM tipoplaca ORDER BY id`;
  const res3 = await client.query(q3);
  console.table(res3.rows);

  console.log('\n--- 4. Buscando 502 en vehículo u otras tablas relacionadas ---');
  // I will just execute it based on what I see in columns
  await client.end();
}
run().catch(console.error);
