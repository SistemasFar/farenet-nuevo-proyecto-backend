const pool = require('./config/database');

async function main() {
  // Persona existente
  const persona = await pool.query(`SELECT nrodocumentoidentidad, nombres, apellidos FROM persona LIMIT 3`);
  console.log('=== PERSONAS ==='); console.table(persona.rows);

  // Maquinas linea 102
  const maquinas = await pool.query(`
    SELECT m.id, m.tipomaquina_key, tm.descripcion
    FROM maquina m JOIN tipomaquina tm ON tm.key = m.tipomaquina_key
    WHERE m.linea_key = 'L1_COMBINADA_SANMIGUEL'
    LIMIT 20
  `);
  console.log('=== MAQUINAS L1_COMBINADA_SANMIGUEL ==='); console.table(maquinas.rows);

  // vehiculo N1, gasolina (para que pida GASES no OPACIDAD)
  const veh = await pool.query(`
    SELECT nromotor, nroplacaantigua, categoria_key, combustible_key, pesobruto
    FROM vehiculo WHERE categoria_key = 'N1' AND combustible_key = '2' AND pesobruto <= 3500 LIMIT 3
  `);
  console.log('=== VEHICULO CANDIDATO ==='); console.table(veh.rows);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
