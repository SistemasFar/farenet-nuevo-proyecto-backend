const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const testsDir = join(__dirname, '..', 'modules', 'faregas', 'tests');
const scope = process.argv.find(argument => argument.startsWith('--scope='))?.split('=')[1] || 'nubefact';
const nubefactFiles = new Set([
    'faregas-catalogo-fiscal-import.test.js',
    'faregas-correlativos-nubefact.test.js',
    'faregas-documentos-electronicos.test.js',
    'faregas-facturacion-admin.test.js',
    'faregas-facturacion.test.js',
    'faregas-nubefact-production-guard.test.js',
    'faregas-nubefact-readiness.test.js',
    'faregas-nubefact-simulation.test.js',
    'faregas-nubefact.service.test.js',
    'faregas-pagos.service.test.js',
    'faregas-resumen-tributario.service.test.js',
    'faregas-series.controller.test.js',
    'faregas-tarifas-admin.controller.test.js'
]);

const files = readdirSync(testsDir)
    .filter(file => file.endsWith('.test.js'))
    .filter(file => scope === 'all' || nubefactFiles.has(file))
    .sort()
    .map(file => join(testsDir, file));

if (files.length === 0) {
    console.error(`No se encontraron pruebas para el alcance ${scope}.`);
    process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
    stdio: 'inherit',
    env: process.env
});

if (result.error) {
    console.error(result.error);
    process.exit(1);
}
process.exit(result.status ?? 1);
