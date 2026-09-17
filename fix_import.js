const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\services\\faregas-ventas.service.js');
let c = fs.readFileSync(p, 'utf8');

c = c.replace("const nubefactService = require('../integrations/nubefact-faregas.service');", "const nubefactService = require('../../../services/integrations/nubefact.service');");

fs.writeFileSync(p, c);
console.log('Fixed nubefact import');
