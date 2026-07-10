const pool = require('./config/database');

async function run() {
  const c = await pool.connect();

  console.log("=== 1. Estructura resultado_maquina ===");
  const res1 = await c.query(`
    SELECT column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'resultado_maquina' 
    ORDER BY ordinal_position
  `);
  console.table(res1.rows);

  console.log("=== 2. Constraints ===");
  const res2 = await c.query(`
    SELECT tc.constraint_name, tc.constraint_type, kcu.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name 
    FROM information_schema.table_constraints tc 
    LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name 
    LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name 
    WHERE kcu.table_name IN ('resultado_maquina', 'resultado_maquina_defecto', 'maquina', 'tipomaquina') 
    ORDER BY kcu.table_name, tc.constraint_type, tc.constraint_name
  `);
  console.table(res2.rows);

  console.log("=== 3. Catálogo tipomaquina ===");
  const res3 = await c.query(`SELECT * FROM tipomaquina ORDER BY key`);
  console.table(res3.rows);

  console.log("=== 4. Tabla maquina (primeros 20) ===");
  const res4 = await c.query(`SELECT id, tipomaquina_key, linea_key, descripcion, nombreequipo FROM maquina LIMIT 20`);
  console.table(res4.rows);

  console.log("=== 6. Estructura defectos ===");
  const res6 = await c.query(`
    SELECT table_name, column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name IN ('resultado_maquina_defecto', 'defecto') 
    ORDER BY table_name, ordinal_position
  `);
  console.table(res6.rows);

  c.release();
  process.exit(0);
}
run();
