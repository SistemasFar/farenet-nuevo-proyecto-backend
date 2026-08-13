const db = require('../config/database');
const fs = require('fs');

async function getTableInfo(t) {
  const cols = await db.query(`
    SELECT column_name, data_type, character_maximum_length, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_name = $1 
    ORDER BY ordinal_position
  `, [t]);
  
  const idx = await db.query('SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1', [t]);
  
  const tc = await db.query(`
    SELECT
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.update_rule,
        rc.delete_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_name = $1
  `, [t]);

  return { columns: cols.rows, indexes: idx.rows, constraints: tc.rows };
}

async function run() {
  const result = {
      fg_certificado: await getTableInfo('fg_certificado'),
      fg_certificado_vehiculo: await getTableInfo('fg_certificado_vehiculo'),
      fg_certificado_titular: await getTableInfo('fg_certificado_titular')
  };
  fs.writeFileSync('scratch/db_audit_fase3.json', JSON.stringify(result, null, 2));
  console.log("Audited tables to scratch/db_audit_fase3.json");
  process.exit(0);
}
run();
