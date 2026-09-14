const fs = require('fs');

const path = "C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Configuracion\\components\\ServicioModal.tsx";
let content = fs.readFileSync(path, 'utf8');

const replacement = `<option value="TALLER_GNV_INICIAL">Taller GNV Inicial</option>
                      <option value="TALLER_GNV_ANUAL">Taller GNV Anual</option>
                      <option value="TALLER_GLP_INICIAL">Taller GLP Inicial</option>
                      <option value="TALLER_GLP_ANUAL">Taller GLP Anual</option>`;

// Replace using regex that ignores the exact text matching of "Inspección"
content = content.replace(/<option value="TALLER_INSPECCION">Taller Inspecci.*?n \(Din.*?mico\)<\/option>/g, replacement);

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed JSX in ServicioModal.tsx');
