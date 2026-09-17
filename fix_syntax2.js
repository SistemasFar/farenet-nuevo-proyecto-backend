const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx');
let c = fs.readFileSync(p, 'utf8');

// Replace the buggy line with the correct full import list
c = c.replace(/import \{ \$\{p1\}, Search \} from 'lucide-react';/g, "import { DownloadCloud, Info, Cpu, Boxes, FileText, Search } from 'lucide-react';");

fs.writeFileSync(p, c);
console.log('Fixed syntax error for real');
