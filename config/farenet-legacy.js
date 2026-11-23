const habilitarRutasFarenet = () => process.env.FARENET_LEGACY_ROUTES_ENABLED !== 'false';
const habilitarCronFarenet = () => process.env.FARENET_LEGACY_CRON_ENABLED !== 'false';

module.exports = { habilitarRutasFarenet, habilitarCronFarenet };
