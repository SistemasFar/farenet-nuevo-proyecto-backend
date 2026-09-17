const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ModalVentaChips.tsx');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  "import { faregasChipsApi, Chip, ProductoInventariable } from '../../services/faregas-chips.api';",
  "import { faregasChipsApi } from '../../services/faregas-chips.api';\nimport type { Chip, ProductoInventariable } from '../../services/faregas-chips.api';"
);

fs.writeFileSync(p, c);
console.log('Fixed frontend import');
