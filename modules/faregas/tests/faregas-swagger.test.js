const test = require('node:test');
const assert = require('node:assert');
const { getSwaggerOptions } = require('../../../config/swagger-config');

test('Swagger Configuration', async (t) => {
    await t.test('Swagger utiliza el PORT dinamico (PORT=3001)', () => {
        const options = getSwaggerOptions(3001);
        
        assert.strictEqual(options.definition.servers[0].url, 'http://127.0.0.1:3001/api');
        assert.strictEqual(options.definition.openapi, '3.0.0');
    });
});
