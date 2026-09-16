require('dotenv').config();
const db = require('./config/database');

async function check() {
  const client = await db.connect();
  try {
    const res = await client.query("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_fg_chip_reserva'");
    console.log(res.rows[0]);
  } finally {
    client.release();
    process.exit(0);
  }
}
check();
