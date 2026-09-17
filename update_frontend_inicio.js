const fs = require('fs');

const apiFile = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Inicio\\InicioView.tsx';
let apiContent = fs.readFileSync(apiFile, 'utf8');

const target1 = `const comprobanteAceptado = estadoFacturacion === 'ACEPTADO' && ins.aceptadaSunat === true;`;
const replacement1 = `const comprobanteAceptado = (estadoFacturacion === 'ACEPTADO' && ins.aceptadaSunat === true) || estadoFacturacion === 'PENDIENTE_SUNAT';`;

if (apiContent.includes(target1)) {
    apiContent = apiContent.replace(target1, replacement1);
    fs.writeFileSync(apiFile, apiContent);
    console.log('InicioView updated successfully');
} else {
    console.log('Target string not found');
}
