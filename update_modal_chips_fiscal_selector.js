const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  `import { faregasChipsApi, type Chip, type ChipResumen, type ProductoInventariable } from '../../services/faregas-chips.api';\nimport { ChipScannerInput, parseChipScan } from './ChipScannerInput';`,
  `import { faregasChipsApi, type Chip, type ChipResumen, type ProductoInventariable } from '../../services/faregas-chips.api';\nimport { faregasProductosApi, type ProductoFacturacion } from '../../services/faregas-productos.api';\nimport { ChipScannerInput, parseChipScan } from './ChipScannerInput';`
);

c = c.replace(
  `  const [productos, setProductos] = useState<ProductoInventariable[]>([]);\n  const [catalogos, setCatalogos] = useState<{ sedes: { key: string, nombre: string }[] }>({ sedes: [] });`,
  `  const [productos, setProductos] = useState<ProductoInventariable[]>([]);\n  const [productosFiscales, setProductosFiscales] = useState<ProductoFacturacion[]>([]);\n  const [catalogos, setCatalogos] = useState<{ sedes: { key: string, nombre: string }[] }>({ sedes: [] });`
);

c = c.replace(
  `  const [newProductName, setNewProductName] = useState('');\n  const [newProductTipo, setNewProductTipo] = useState('CHIP_SERIALIZADO');\n  const [savingProduct, setSavingProduct] = useState(false);`,
  `  const [newProductName, setNewProductName] = useState('');\n  const [newProductTipo, setNewProductTipo] = useState('CHIP_SERIALIZADO');\n  const [newProductProductoFacturacionId, setNewProductProductoFacturacionId] = useState<number | ''>('');\n  const [savingProduct, setSavingProduct] = useState(false);`
);

c = c.replace(
  `      const [r, l, prods, cat] = await Promise.all([\n        faregasChipsApi.resumen(selectedProductId === '' ? undefined : Number(selectedProductId)),\n        faregasChipsApi.listar({ buscar, estado: filtroEstado === 'TODOS' ? undefined : filtroEstado }),\n        faregasChipsApi.listarProductosInventariables(),\n        faregasChipsApi.catalogosProductosInventariables()\n      ]);\n      setResumen(r);\n      setChips(l.items);\n      setProductos(prods);\n      setCatalogos(cat);`,
  `      const [r, l, prods, cat, pf] = await Promise.all([\n        faregasChipsApi.resumen(selectedProductId === '' ? undefined : Number(selectedProductId)),\n        faregasChipsApi.listar({ buscar, estado: filtroEstado === 'TODOS' ? undefined : filtroEstado }),\n        faregasChipsApi.listarProductosInventariables(),\n        faregasChipsApi.catalogosProductosInventariables(),\n        faregasProductosApi.listar()\n      ]);\n      setResumen(r);\n      setChips(l.items);\n      setProductos(prods);\n      setCatalogos(cat);\n      setProductosFiscales(pf.filter((p: any) => p.activo && p.es_para_venta));`
);

c = c.replace(
  `        codigo: newProductCodigo,\n        nombre: newProductName,\n        tipo: newProductTipo,\n        sedes: []`,
  `        codigo: newProductCodigo,\n        nombre: newProductName,\n        tipo: newProductTipo,\n        productoFacturacionId: newProductProductoFacturacionId === '' ? undefined : Number(newProductProductoFacturacionId),\n        sedes: []`
);

c = c.replace(
  `      setNewProductCodigo('');\n      setNewProductName('');\n      setNewProductTipo('CHIP_SERIALIZADO');\n      await cargar();`,
  `      setNewProductCodigo('');\n      setNewProductName('');\n      setNewProductTipo('CHIP_SERIALIZADO');\n      setNewProductProductoFacturacionId('');\n      await cargar();`
);

const targetForm = `            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-1 block text-sm font-bold text-slate-700">Código del tipo</label><input type="text" disabled={!!editingProductoId} value={editingProductoId ? editProductCodigo : newProductCodigo} onChange={(e) => setNewProductCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} placeholder="Ej. SUPERCHIP" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100" /></div>
              <div><label className="mb-1 block text-sm font-bold text-slate-700">Clasificación</label><select value={editingProductoId ? editProductTipo : newProductTipo} onChange={(e) => editingProductoId ? setEditProductTipo(e.target.value) : setNewProductTipo(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="CHIP_SERIALIZADO">Chip serializado</option><option value="ACCESORIO">Accesorio</option><option value="OTRO_PRODUCTO_FISICO">Otro producto físico</option></select></div>
            </div>
            <div><label className="mb-1 block text-sm font-bold text-slate-700">Nombre del tipo de chip</label><input type="text" value={editingProductoId ? editProductName : newProductName} onChange={(e) => editingProductoId ? setEditProductName(e.target.value) : setNewProductName(e.target.value)} placeholder="Ej. Superchip GNV" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">Precio Venta (S/)</label>`;

const replacementForm = `            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-1 block text-sm font-bold text-slate-700">Código del tipo</label><input type="text" disabled={!!editingProductoId} value={editingProductoId ? editProductCodigo : newProductCodigo} onChange={(e) => setNewProductCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} placeholder="Ej. SUPERCHIP" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100" /></div>
              <div><label className="mb-1 block text-sm font-bold text-slate-700">Clasificación</label><select value={editingProductoId ? editProductTipo : newProductTipo} onChange={(e) => editingProductoId ? setEditProductTipo(e.target.value) : setNewProductTipo(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="CHIP_SERIALIZADO">Chip serializado</option><option value="ACCESORIO">Accesorio</option><option value="OTRO_PRODUCTO_FISICO">Otro producto físico</option></select></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-1 block text-sm font-bold text-slate-700">Nombre del tipo de chip</label><input type="text" value={editingProductoId ? editProductName : newProductName} onChange={(e) => editingProductoId ? setEditProductName(e.target.value) : setNewProductName(e.target.value)} placeholder="Ej. Superchip GNV" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" /></div>
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">Producto Fiscal Vinculado</label>
                <select value={editingProductoId ? editProductProductoFacturacionId : newProductProductoFacturacionId} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ''; if (editingProductoId) setEditProductProductoFacturacionId(v); else setNewProductProductoFacturacionId(v); }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  <option value="">Ninguno (No se podrá vender)</option>
                  {productosFiscales.map(pf => <option key={pf.id} value={pf.id}>{pf.codigo_sku} - {pf.descripcion}</option>)}
                </select>
                <p className="mt-1 text-xs text-slate-500">Debe tener unidad NIU o ZZ e IGV 10.</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">Precio Venta (S/)</label>`;

c = c.replace(targetForm, replacementForm);

fs.writeFileSync(p, c);
console.log('Done replacing');
