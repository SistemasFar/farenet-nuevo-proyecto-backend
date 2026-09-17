const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/React\.useState/g, 'useState');
c = c.replace(/React\.useEffect/g, 'useEffect');

fs.writeFileSync(p, c);
console.log('Fixed React reference');
