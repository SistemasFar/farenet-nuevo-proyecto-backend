const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx');
let c = fs.readFileSync(p, 'utf8');

c = c.replace('chipsList={chipsList}', 'chipsList={chips}');

fs.writeFileSync(p, c);
console.log('Fixed chipsList reference.');
