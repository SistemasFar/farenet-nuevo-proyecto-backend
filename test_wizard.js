const db = require('./config/database');
const LineaService = require('./services/linea.service');

async function run() {
  try {
    const data = await LineaService.getWizardModel('INS-201-000160224');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    db.end();
  }
}

run();
