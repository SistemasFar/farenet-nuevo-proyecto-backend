const fs = require('fs');
const apiPath = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/services/faregas-chips.api.ts';
let apiTxt = fs.readFileSync(apiPath, 'utf8');
apiTxt = apiTxt.replace(
    'await faregasFetch<{ chips: { id: number; codigo: string; nombre: string; }[] }>(\'/chips/catalogo-fiscales\')',
    'await faregasFetch(\'/chips/catalogo-fiscales\') as { chips: { id: number; codigo: string; nombre: string; }[] }'
);
fs.writeFileSync(apiPath, apiTxt);

const tabPath = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/Configuracion/components/TabProductos.tsx';
let tabTxt = fs.readFileSync(tabPath, 'utf8');
tabTxt = tabTxt.replace('import {', 'import { faregasChipsApi } from \'../../../services/faregas-chips.api\';\nimport {');
fs.writeFileSync(tabPath, tabTxt);
