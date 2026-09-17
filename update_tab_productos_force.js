const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Configuracion\\components\\TabProductos.tsx');
let c = fs.readFileSync(p, 'utf8');

const startStr = '<label className="flex items-center gap-2 text-sm font-semibold text-slate-700">';
let startIdx = c.indexOf(startStr);
let endIdx = c.indexOf(')}</div>', startIdx);

if (startIdx !== -1 && endIdx !== -1) {
    c = c.substring(0, startIdx) + '</div>' + c.substring(endIdx + 8);
    fs.writeFileSync(p, c);
    console.log('Successfully removed chip configuration from TabProductos.tsx');
} else {
    console.log('Could not find indices!');
}
