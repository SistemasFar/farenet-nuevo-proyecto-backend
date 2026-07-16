const db = require('./config/database');

async function validate() {
  const queries = [
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'vehiculo'",
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'tarjetapropiedad'",
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'persona'",
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'certificado'",
    "SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%empresa%'",
    "SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%carroceria%'"
  ];
  
  for (let q of queries) {
    console.log("-------------------");
    console.log("Executing:", q);
    try {
      const res = await db.query(q);
      console.log(res.rows);
    } catch(e) {
      console.error(e);
    }
  }
  process.exit(0);
}

validate();
