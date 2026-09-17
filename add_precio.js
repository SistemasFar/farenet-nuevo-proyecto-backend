const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx');
let c = fs.readFileSync(p, 'utf8');

const targetStr = `<div><label className="mb-1 block text-sm font-bold text-slate-700">Nombre del tipo de chip</label><input type="text" value={editingProductoId ? editProductName : newProductName} onChange={(e) => editingProductoId ? setEditProductName(e.target.value) : setNewProductName(e.target.value)} placeholder="Ej. Superchip GNV" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" /></div>`;

const addition = `
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">Precio Venta (S/)</label>
                <input type="number" min="0" step="0.01" 
                  value={editingProductoId ? (editProductSedes[plantaKey]?.precio || '') : (newProductSedes[plantaKey]?.precio || '')} 
                  onChange={(e) => {
                    const val = e.target.value;
                    if (editingProductoId) {
                      setEditProductSedes({...editProductSedes, [plantaKey]: {...editProductSedes[plantaKey], precio: val}});
                    } else {
                      setNewProductSedes({...newProductSedes, [plantaKey]: {...newProductSedes[plantaKey], precio: val}});
                    }
                  }} 
                  placeholder="0.00" 
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" 
                />
                <p className="mt-1 text-xs text-slate-500">Aplica solo para tu sede ({plantaNombre || plantaKey})</p>
              </div>
            </div>`;

if (c.includes(targetStr)) {
    c = c.replace(targetStr, targetStr + addition);
    fs.writeFileSync(p, c);
    console.log('Successfully added precio input');
} else {
    console.log('Could not find target string in ChipsView.tsx');
}
