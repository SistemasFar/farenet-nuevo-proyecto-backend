const db = require('../../../config/database');

async function main() {
  const r = await db.query("SELECT id, codigo, nombre, tipo_flujo, activo FROM fg_servicio WHERE tipo_flujo = 'TALLER_INSPECCION'");
  console.log('Services with TALLER_INSPECCION:', r.rows);

  const tAll = await db.query("SELECT id, codigo, nombre, tipo_flujo, activo FROM fg_servicio WHERE nombre ILIKE '%TALLER%'");
  console.log('Services with TALLER in name:', tAll.rows);

  await db.end();
}

main().catch(console.error);
