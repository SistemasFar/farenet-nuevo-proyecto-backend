const fs = require('fs');

// 1. Update API
const apiFile = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\services\\faregas-productos.api.ts';
let apiContent = fs.readFileSync(apiFile, 'utf8');
if (!apiContent.includes('eliminar: async')) {
    apiContent = apiContent.replace(
        `cambiarEstado: async (id: number, activo: boolean): Promise<void> => {
    await request(\`/productos/\${id}/estado\`, { method: 'PUT', body: JSON.stringify({ activo }) });
  }`,
        `cambiarEstado: async (id: number, activo: boolean): Promise<void> => {
    await request(\`/productos/\${id}/estado\`, { method: 'PUT', body: JSON.stringify({ activo }) });
  },
  eliminar: async (id: number): Promise<void> => {
    await request(\`/productos/\${id}\`, { method: 'DELETE' });
  }`
    );
    fs.writeFileSync(apiFile, apiContent);
    console.log('API updated');
}

// 2. Update Component
const compFile = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Configuracion\\components\\TabProductos.tsx';
let compContent = fs.readFileSync(compFile, 'utf8');

if (!compContent.includes('Trash2')) {
    compContent = compContent.replace(
        `import { Edit, Link2, Power, PowerOff } from 'lucide-react';`,
        `import { Edit, Link2, Power, PowerOff, Trash2 } from 'lucide-react';`
    );
}

if (!compContent.includes('Trash2 size={18}')) {
    const buttonToInsert = `<button onClick={async () => {
    if (!confirm(\`¿Seguro que deseas eliminar permanentemente el SKU \${producto.codigo_sku}?\`)) return;
    try {
      await faregasProductosApi.eliminar(producto.id);
      await cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al eliminar producto');
    }
  }} title="Eliminar" className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-red-600 transition-colors hover:bg-red-100"><Trash2 size={18} /></button>`;
    
    // We insert it next to the Edit button
    compContent = compContent.replace(
        `<button onClick={() => { setMode('EDIT'); setActual(producto); setProductoGuardado(''); setModal(true); }} title="Editar" className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[#052A79] transition-colors hover:bg-blue-100"><Edit size={18} /></button>`,
        `<button onClick={() => { setMode('EDIT'); setActual(producto); setProductoGuardado(''); setModal(true); }} title="Editar" className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[#052A79] transition-colors hover:bg-blue-100"><Edit size={18} /></button>${buttonToInsert}`
    );
    fs.writeFileSync(compFile, compContent);
    console.log('Component updated');
}
