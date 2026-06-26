const pool = require('./config/database');
async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE vehiculo SET 
        marca_key = '68', 
        modelo_key = '724', 
        color_key = '8', 
        vehiculoclase_key = '11', 
        carroceria_key = '46', 
        combustible_key = '1',
        aniofabricacion = 2015,
        nrocilindros = 4,
        kilometraje = 150000,
        nroasientos = 5,
        nropasajeros = 4,
        nropuertas = 4
      WHERE nroplacaantigua = 'VIEJ11'
    `);
    console.log("Vehículo VIEJ11 actualizado con datos completos.");
  } finally {
    client.release();
    process.exit(0);
  }
}
run();
