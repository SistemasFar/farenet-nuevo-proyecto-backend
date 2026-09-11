const fs = require('fs');
const file = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetBackend/modules/faregas/routes/faregas-formatos.routes.js';
let lines = fs.readFileSync(file, 'utf8').split('\n');
lines[101] = "    res.setHeader('Content-Disposition', 'attachment; filename=preview_' + req.params.versionId + '.docx');";
fs.writeFileSync(file, lines.join('\n'), 'utf8');
