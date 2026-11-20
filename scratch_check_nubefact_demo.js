require('./config/env-loader');
const nubefactConfigService = require('./modules/faregas/services/faregas-nubefact-config.service');
const nubefactService = require('./services/integrations/nubefact.service');

async function checkNubefactDemo() {
  const cfg = await nubefactConfigService.resolverParaPlanta('98');
  console.log('Credenciales configuradas:', {
    empresaKey: cfg.empresaKey,
    rucEmisor: cfg.rucEmisor,
    razonSocialEmisor: cfg.razonSocialEmisor,
    environment: cfg.environment,
    apiUrl: cfg.credentials?.apiUrl
  });

  // Consultar últimos comprobantes FFF1
  for (let n of [56, 60, 61, 62, 63, 68, 69, 70]) {
    const r = await nubefactService.consultarComprobante({
      tipoDeComprobante: 1,
      serie: 'FFF1',
      numero: n
    }, { credentials: cfg.credentials });
    console.log(`Consulta FFF1-${n}:`, r.status, r.httpStatus, r.data?.sunat_description || r.data?.errors || r.reason);
  }
}

checkNubefactDemo().catch(console.error);

