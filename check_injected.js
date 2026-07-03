const pool = require('./config/database');
async function test() {
  try {
    const res = await pool.query("SELECT uuid, estado, placa FROM descuentocliente WHERE uuid IN ('25799fed-e4c1-4f91-a5a8-bdc9dc3db039', 'aecab574-845f-4e00-98e6-69a965b5db41', '648f5a18-7b79-4514-bc47-610ea8f7e115')");
    console.log(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
test();
