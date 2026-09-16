require('dotenv').config();
const db = require('./config/database');

async function fix() {
  const client = await db.connect();
  try {
    await client.query("ALTER TABLE fg_chip DROP CONSTRAINT IF EXISTS ck_fg_chip_reserva");
    await client.query("ALTER TABLE fg_chip ADD CONSTRAINT ck_fg_chip_reserva CHECK ((estado = 'RESERVADO' AND reservado_en IS NOT NULL) OR (estado <> 'RESERVADO' AND operacion_reserva_id IS NULL AND reservado_en IS NULL))");
    console.log("Constraint ck_fg_chip_reserva updated successfully!");
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    process.exit(0);
  }
}
fix();
