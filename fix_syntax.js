const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx');
let c = fs.readFileSync(p, 'utf8');

c = c.replace("import { ${p1}, FileText } from 'lucide-react';", "import { DownloadCloud, Info, Cpu, Boxes, FileText } from 'lucide-react';");

fs.writeFileSync(p, c);
console.log('Fixed syntax error in import');
