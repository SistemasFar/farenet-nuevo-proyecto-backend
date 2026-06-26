const pool = require('./config/database');
pool.query("SELECT categoria_key, marca_key, tipoplaca_key, nroplacaantigua FROM vehiculo WHERE nroplacaantigua = '333666'").then(res => {
  console.log(res.rows);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
