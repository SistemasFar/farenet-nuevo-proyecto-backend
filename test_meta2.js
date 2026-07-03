const pool = require('./config/database');
pool.query("SELECT ui_metadata FROM inspeccion WHERE placa = 'TEST01' ORDER BY fechcreacion DESC LIMIT 1")
  .then(res => {
    console.log('Exists?', res.rows.length > 0);
    if (res.rows.length > 0) {
      console.log('Metadata length:', res.rows[0].ui_metadata ? res.rows[0].ui_metadata.length : 0);
      console.log('Metadata start:', res.rows[0].ui_metadata ? res.rows[0].ui_metadata.substring(0, 200) : 'null');
    }
  })
  .catch(console.error)
  .finally(() => process.exit());
