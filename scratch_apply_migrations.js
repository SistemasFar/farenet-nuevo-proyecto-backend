const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('./config/env-loader');

(async () => {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'faregas_contingencia_demo'
  });

  try {
    await client.connect();
    console.log('Connected to faregas_contingencia_lab!');

    const migrationsDir = path.join(__dirname, 'modules/faregas/database/migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    console.log('Migrations to apply:', files);

    for (const file of files) {
      console.log(`Applying ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      console.log(`Applied ${file} successfully.`);
    }

    const res = await client.query('SELECT count(*)::int FROM information_schema.tables WHERE table_schema = \'public\'');
    console.log('Total tables in faregas_contingencia_lab:', res.rows[0].count);
  } catch (err) {
    console.error('Error applying migrations:', err);
  } finally {
    await client.end().catch(() => {});
  }
})();
