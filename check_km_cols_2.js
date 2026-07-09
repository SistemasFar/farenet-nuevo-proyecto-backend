const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  password: '123',
  host: 'localhost',
  port: 5432,
  database: 'farenet'
});

async function run() {
  await client.connect();
  try {
    const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'inspeccion' AND column_name LIKE '%kilom%'");
    console.log('inspeccion columns:', res.rows);
    const res2 = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'vehiculo' AND column_name LIKE '%kilom%'");
    console.log('vehiculo columns:', res2.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
