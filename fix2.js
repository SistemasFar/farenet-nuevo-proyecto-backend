const fs = require('fs'); 
const file = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/views/Inicio/NuevaInspeccion/components/NuevaInspeccion/VehiculoStep.tsx'; 
let content = fs.readFileSync(file, 'utf8'); 
content = content.replace(/altura: res\.data\.altura \|\| '',/g, `altura: res.data.alto || res.data.altura || '',`); 
fs.writeFileSync(file, content);
