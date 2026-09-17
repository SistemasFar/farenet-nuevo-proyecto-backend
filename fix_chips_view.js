const fs = require('fs');
const p = 'C:\\\\Users\\\\Sistemas2\\\\Desktop\\\\farenet nuevo proyecto\\\\farenetFrontend\\\\src\\\\modules\\\\faregas\\\\views\\\\Chips\\\\ChipsView.tsx';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  /<div><label className="mb-1 block text-sm font-bold text-slate-700">Nombre del tipo de chip<\/label><input type="text" value={editingProductoId \? editProductName : newProductName} onChange={\(e\) => editingProductoId \? setEditProductName\(e\.target\.value\) : setNewProductName\(e\.target\.value\)} placeholder="Ej\. Superchip GNV" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" \/><\/div>/g,
  `<div className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-1 block text-sm font-bold text-slate-700">Nombre del tipo de chip</label><input type="text" value={editingProductoId ? editProductName : newProductName} onChange={(e) => editingProductoId ? setEditProductName(e.target.value) : setNewProductName(e.target.value)} placeholder="Ej. Superchip GNV" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" /></div>
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">Producto Fiscal Vinculado</label>
                <select value={editingProductoId ? editProductProductoFacturacionId : newProductProductoFacturacionId} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ''; if (editingProductoId) setEditProductProductoFacturacionId(v); else setNewProductProductoFacturacionId(v); }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  <option value="">Ninguno (No se podrá vender)</option>
                  {productosFiscales.map(pf => <option key={pf.id} value={pf.id}>{pf.codigo_sku} - {pf.descripcion}</option>)}
                </select>
                <p className="mt-1 text-xs text-slate-500">Debe tener unidad NIU o ZZ e IGV 10.</p>
              </div>
            </div>`
);

fs.writeFileSync(p, c);
console.log('Success');
