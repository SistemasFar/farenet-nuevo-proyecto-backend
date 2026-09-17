const db = require('./config/database');
db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fg_empresa_facturador';")
  .then(res => { console.log(res.rows); db.end(); })
  .catch(err => { console.error(err); db.end(); });
