const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool();

async function run() {
  try {
    const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'inspeccion' AND column_name LIKE '%kilom%'");
    console.log("Columns in inspeccion matching kilom:");
    console.log(res.rows);
    
    const res2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'vehiculo' AND column_name LIKE '%kilom%'");
    console.log("Columns in vehiculo matching kilom:");
    console.log(res2.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
