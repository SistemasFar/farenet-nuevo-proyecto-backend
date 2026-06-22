const pool = require('./config/database');
async function run() {
  try {
    await pool.query(`
      INSERT INTO vehiculo (
        nroplacaantigua, nromotor, fechcreacion
      ) VALUES (
        '222222222', 'TMP-INS-201-000624740', NOW()
      )
    `);
    console.log("INSERT SUCCESS");
    process.exit(0);
  } catch (err) {
    console.error("INSERT ERROR:", err.message);
    process.exit(1);
  }
}
run();
