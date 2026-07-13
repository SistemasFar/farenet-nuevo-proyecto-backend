const db = require('./config/database');

async function checkSchema() {
  try {
    const resVehiculo = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'vehiculo'`);
    console.log("VEHICULO COLUMNS:\n", resVehiculo.rows.map(r => r.column_name).join(', '));

    const resTarjeta = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tarjetapropiedad'`);
    console.log("\nTARJETAPROPIEDAD COLUMNS:\n", resTarjeta.rows.map(r => r.column_name).join(', '));

    const resPersona = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'persona'`);
    console.log("\nPERSONA COLUMNS:\n", resPersona.rows.map(r => r.column_name).join(', '));

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkSchema();
