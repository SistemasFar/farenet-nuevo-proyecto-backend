const db = require('./config/database');

async function checkSinDNI() {
  try {
    const res = await db.query(`SELECT nrodocumentoidentidad, nombres, apellidos, nombrerazonsocial FROM persona WHERE nrodocumentoidentidad LIKE '%SIN%' OR nrodocumentoidentidad LIKE '00000000' OR nrodocumentoidentidad = '' LIMIT 10`);
    console.log("PERSONAS SIN DNI:\n", res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkSinDNI();
