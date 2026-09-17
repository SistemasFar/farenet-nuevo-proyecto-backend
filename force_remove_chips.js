const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Configuracion\\components\\TabProductos.tsx');
let c = fs.readFileSync(p, 'utf8');

const targetStr = `<div className="border-t pt-4">
          <label className="flex items-center gap-2 text-sm font-semibold mb-3">`;

let startIdx = c.indexOf(targetStr);
if (startIdx !== -1) {
    let endIdx = c.indexOf(')}</div>', startIdx);
    if (endIdx !== -1) {
        c = c.substring(0, startIdx) + c.substring(endIdx + 8);
        fs.writeFileSync(p, c);
        console.log('Removed successfully!');
    } else {
        console.log('End index not found');
    }
} else {
    console.log('Start index not found');
}
