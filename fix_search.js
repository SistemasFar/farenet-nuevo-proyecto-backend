const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/import\s+\{([^}]+)\}\s+from\s+['"]lucide-react['"];/, (match, p1) => {
    if (!p1.includes('Search')) {
        return `import { \${p1}, Search } from 'lucide-react';`;
    }
    return match;
});

fs.writeFileSync(p, c);
console.log('Added Search import');
