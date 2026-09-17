const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx');
let c = fs.readFileSync(p, 'utf8');

if (!c.includes('FileText')) {
    // If there is an existing import from lucide-react, append it
    if (c.includes('lucide-react')) {
        c = c.replace(/import\s+\{([^}]+)\}\s+from\s+['"]lucide-react['"];/, (match, p1) => {
            return `import { \${p1}, FileText } from 'lucide-react';`;
        });
    } else {
        c = `import { FileText } from 'lucide-react';\n` + c;
    }
    fs.writeFileSync(p, c);
    console.log('Added FileText import');
} else {
    console.log('FileText already included, but maybe not from lucide-react');
    if (!c.match(/import.*FileText.*lucide-react/)) {
        c = c.replace(/import\s+\{([^}]+)\}\s+from\s+['"]lucide-react['"];/, (match, p1) => {
            return `import { \${p1}, FileText } from 'lucide-react';`;
        });
        fs.writeFileSync(p, c);
        console.log('Added FileText to lucide-react');
    }
}
