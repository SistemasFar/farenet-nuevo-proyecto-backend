const pool = require('./config/database');
pool.query("INSERT INTO vehiculo (nrodocumento, placamotor) VALUES ('TEST01', 'TEST01') ON CONFLICT DO NOTHING")
  .then(() => console.log('Inserted TEST01 vehiculo'))
  .catch(console.error)
  .finally(() => process.exit(0));
