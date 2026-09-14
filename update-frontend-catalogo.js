const fs = require('fs');

const path = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Configuracion\\components\\TabCatalogo.tsx';
let content = fs.readFileSync(path, 'utf8');

// Remove TabFormatos import
content = content.replace(/import TabFormatos from '.\/TabFormatos';\r?\n/, '');

// Remove FORMATOS from CatalogoTab
content = content.replace(/'OPERACIONES' \| 'FORMATOS'/, "'OPERACIONES'");

// Remove the button
content = content.replace(/<button\s+onClick=\{\(\) => setActiveTab\('FORMATOS'\)\}.*?<\/button>/s, '');

// Remove the conditional rendering
content = content.replace(/\{\s*activeTab === 'FORMATOS'.*?<TabFormatos \/>\s*\}/s, '');

fs.writeFileSync(path, content);
console.log('Updated TabCatalogo.tsx');
