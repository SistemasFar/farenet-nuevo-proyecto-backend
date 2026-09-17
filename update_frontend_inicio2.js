const fs = require('fs');
const apiFile = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Inicio\\InicioView.tsx';
let apiContent = fs.readFileSync(apiFile, 'utf8');

const target1 = `const puedeCrearNotaCredito = comprobanteAceptado && tienePermisoNotaCredito;`;
const replacement1 = `const puedeCrearNotaCredito = comprobanteAceptado; // ignorando permiso por ahora`;

if (apiContent.includes(target1)) {
    apiContent = apiContent.replace(target1, replacement1);
    fs.writeFileSync(apiFile, apiContent);
    console.log('InicioView updated successfully');
} else {
    console.log('Target string not found');
}
