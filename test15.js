const pool = require('./config/database');
const test = async () => {
  try {
    const res = await pool.query(`SELECT key, abreviatura, nombre FROM conceptoinspeccion`);
    const found = res.rows.find(r => r.abreviatura === 'PARTICULAR LIVIANOS' || r.nombre === 'PARTICULAR LIVIANOS');
    console.log(found || 'No encontrado con ese nombre/abreviatura exacto');
  } catch(e) {}
  process.exit(0);
};
test();
