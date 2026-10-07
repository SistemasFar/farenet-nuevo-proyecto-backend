const fs = require('fs');

const path = 'c:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\NuevoCertificado\\components\\NuevoCertificado\\CajaStep.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/Catǟlogo/g, 'Catálogo');
content = content.replace(/catǟlogo/g, 'catálogo');
content = content.replace(/Categorǟa/g, 'Categoría');
content = content.replace(/categorǟa/g, 'categoría');
content = content.replace(/cambiǟ/g, 'cambió');
content = content.replace(/estǭ/g, 'está');
content = content.replace(/vehǟculo/g, 'vehículo');
content = content.replace(/Vehǟculo/g, 'Vehículo');
content = content.replace(/tǸcnico/g, 'técnico');
content = content.replace(/TǸcnico/g, 'Técnico');
content = content.replace(/Validacin/g, 'Validación');
content = content.replace(/validacin/g, 'validación');
content = content.replace(/facturacin/g, 'facturación');
content = content.replace(/Facturacin/g, 'Facturación');
content = content.replace(/emisin/g, 'emisión');
content = content.replace(/Emisin/g, 'Emisión');
content = content.replace(/Previsualizacin/g, 'Previsualización');
content = content.replace(/Facturacin/g, 'Facturación');
content = content.replace(/Emisin/g, 'Emisión');
content = content.replace(/Vehculo/g, 'Vehículo');
content = content.replace(/Tcnico/g, 'Técnico');
content = content.replace(/Catlogo/g, 'Catálogo');
content = content.replace(/categora/g, 'categoría');
content = content.replace(/cambi/g, 'cambió');
content = content.replace(/est/g, 'está');
content = content.replace(/nmero/g, 'número');
content = content.replace(/ningn/g, 'ningún');
content = content.replace(/devielv/g, 'devolvió');

// Fix  with any letter
content = content.replace(//g, '');

fs.writeFileSync(path, content, 'utf8');
console.log('Encoding fixed.');
