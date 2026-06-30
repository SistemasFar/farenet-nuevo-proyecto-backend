const pool = require('./config/database');

async function runSeeds() {
  const client = await pool.connect();
  
  let maxVehId = 1000000;
  try {
    const r = await client.query('SELECT MAX(id) as m FROM vehiculo');
    maxVehId = r.rows[0].m || 1000000;
  } catch(e) {}
  
  try {
    await client.query('BEGIN');
    console.log("Inyectando SOLO vehiculos...");

    const baseVehRes = await client.query('SELECT * FROM vehiculo LIMIT 1');
    const baseVeh = baseVehRes.rows[0];

    const cloneVeh = async (placa) => {
      maxVehId++;
      const v = { ...baseVeh, nroplacaantigua: placa, nromotor: 'M-' + placa };
      if ('id' in v) v.id = maxVehId;
      if ('fechcreacion' in v) delete v.fechcreacion;
      
      const keys = Object.keys(v); const values = Object.values(v);
      const placeholders = keys.map((_, i) => '$' + (i + 1)).join(', ');
      await client.query(`INSERT INTO vehiculo (${keys.join(', ')}) VALUES (${placeholders})`, values);
    };

    const locExists = await client.query(`SELECT * FROM vehiculo WHERE nroplacaantigua = 'LOC-123'`);
    if(locExists.rows.length === 0) await cloneVeh('LOC-123');

    const dscExists = await client.query(`SELECT * FROM vehiculo WHERE nroplacaantigua = 'DSC-123'`);
    if(dscExists.rows.length === 0) await cloneVeh('DSC-123');

    await client.query('COMMIT');
    console.log("Vehículos inyectados correctamente.");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error:", e.message);
  } finally {
    client.release();
    process.exit();
  }
}
runSeeds();
