const pool = require('./config/database');

async function checkTables() {
  try {
    const r1 = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tipopagodescuento'`);
    console.log('--- tipopagodescuento schema ---');
    console.log(r1.rows);

    const r2 = await pool.query(`SELECT * FROM tipopagodescuento LIMIT 10`);
    console.log('--- tipopagodescuento data ---');
    console.log(r2.rows);

    const r3 = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tipodescuento'`);
    console.log('--- tipodescuento schema ---');
    console.log(r3.rows);

    const r4 = await pool.query(`SELECT * FROM tipodescuento LIMIT 10`);
    console.log('--- tipodescuento data ---');
    console.log(r4.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

checkTables();
