const fs = require('fs');
const file = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetBackend/modules/faregas/routes/faregas-formatos.routes.js';
let content = fs.readFileSync(file, 'utf8');
content = content.replace("require('../../../middlewares/auth')", "require('../../../middlewares/auth.middleware')");
fs.writeFileSync(file, content, 'utf8');
