const pool = require('./config/database');
const test = async () => {
  try {
    const query = `
      SELECT cam.id, cam.key, cam.nombre
      FROM campania cam
      INNER JOIN tipodescuento td ON cam.tipodescuento_key = td.key
      INNER JOIN campanias_plantas cp ON cam.id = cp.campania_id
      INNER JOIN planta pl ON cp.planta_key = pl.key
      INNER JOIN campaniadetalle cd ON cam.id = cd.campania_id
      INNER JOIN conceptoinspeccion ci ON cd.conceptoinspeccion_key = ci.key
      LEFT JOIN campanias_personas ce ON cam.id = ce.campania_id
      LEFT JOIN persona emp ON ce.persona_id = emp.nrodocumentoidentidad
      LEFT JOIN verificaciondescuento vd ON cam.id = vd.campania_id
      WHERE pl.key = '201' AND ci.key = '2' AND cam.estado = true 
      AND (vd.id IS NULL OR vd.estado = true)
      AND (emp.nrodocumentoidentidad = '20498456856' OR vd.codigo = '20498456856')
    `;
    const res = await pool.query(query);
    console.log(res.rows);
  } catch(e) {}
  process.exit(0);
};
test();
