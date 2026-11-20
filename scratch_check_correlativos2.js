require('./config/env-loader');
const nubefactConfigService = require('./modules/faregas/services/faregas-nubefact-config.service');
const nubefactService = require('./services/integrations/nubefact.service');

async function checkCorrelativos() {
  const cfg = await nubefactConfigService.resolverParaPlanta('98');

  // Let's check FFF1 from 1 to 20
  console.log('Checking FFF1 1..10:');
  for (let n = 1; n <= 10; n++) {
    const r = await nubefactService.consultarComprobante({
      tipoDeComprobante: 1,
      serie: 'FFF1',
      numero: n
    }, { credentials: cfg.credentials });
    if (r.status === 'ACCEPTED') {
      console.log(`FFF1-${n}: EXISTE`, r.data?.sunat_description);
    } else {
      console.log(`FFF1-${n}:`, r.data?.errors || r.reason);
    }
  }

  // Also check BBB1
  console.log('Checking BBB1 1..5:');
  for (let n = 1; n <= 5; n++) {
    const r = await nubefactService.consultarComprobante({
      tipoDeComprobante: 2,
      serie: 'BBB1',
      numero: n
    }, { credentials: cfg.credentials });
    if (r.status === 'ACCEPTED') {
      console.log(`BBB1-${n}: EXISTE`, r.data?.sunat_description);
    } else {
      console.log(`BBB1-${n}:`, r.data?.errors || r.reason);
    }
  }
}

checkCorrelativos().catch(console.error);

