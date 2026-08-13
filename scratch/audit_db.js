const db = require('../config/database');
const fs = require('fs');

async function getCols(t) {
  const res = await db.query('SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position', [t]);
  return res.rows;
}

async function getIndex(t) {
    const res = await db.query('SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1', [t]);
    return res.rows;
}

async function run() {
  const result = {
      fg_cliente: { columns: await getCols('fg_cliente'), indexes: await getIndex('fg_cliente') },
      persona: { columns: await getCols('persona'), indexes: await getIndex('persona') },
      vehiculo: { columns: await getCols('vehiculo'), indexes: await getIndex('vehiculo') },
      marca: { columns: await getCols('marca') },
      modelo: { columns: await getCols('modelo') },
      categoria: { columns: await getCols('categoria') },
      vehiculoclase: { columns: await getCols('vehiculoclase') },
      color: { columns: await getCols('color') },
      combustible: { columns: await getCols('combustible') },
      carroceria: { columns: await getCols('carroceria') },
  };
  fs.writeFileSync('scratch/db_audit.json', JSON.stringify(result, null, 2));
  console.log("Audited tables to scratch/db_audit.json");
  process.exit(0);
}
run();
