const fs = require('fs');
const path = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetBackend/modules/faregas/routes/faregas-formatos.routes.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace("const { verificarToken, requiereRol } = require('../../../middlewares/auth.middleware');", "const verificarToken = require('../../../middlewares/auth.middleware');");
content = content.replace(/, requiereRol\('ADMIN'\)/g, '');

fs.writeFileSync(path, content, 'utf8');
