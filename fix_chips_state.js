const fs = require('fs');
const p = 'C:\\\\Users\\\\Sistemas2\\\\Desktop\\\\farenet nuevo proyecto\\\\farenetFrontend\\\\src\\\\modules\\\\faregas\\\\views\\\\Chips\\\\ChipsView.tsx';
let lines = fs.readFileSync(p, 'utf8').split('\n');

// 1. Add missing useStates after savingProduct
const savingProductIdx = lines.findIndex(l => l.includes('const [savingProduct, setSavingProduct]'));
if (savingProductIdx !== -1 && !lines.some(l => l.includes('newProductSedes'))) {
    lines.splice(savingProductIdx + 1, 0, 
        "  const [newProductProductoFacturacionId, setNewProductProductoFacturacionId] = useState<number | ''>('');",
        "  const [newProductSedes, setNewProductSedes] = useState<Record<string, EditableSede>>({});"
    );
}

// 2. Add productosFiscales state
const productosIdx = lines.findIndex(l => l.includes('const [productos, setProductos]'));
if (productosIdx !== -1 && !lines.some(l => l.includes('productosFiscales'))) {
    lines.splice(productosIdx + 1, 0, "  const [productosFiscales, setProductosFiscales] = useState<ProductoFacturacion[]>([]);");
}

// 3. Add to imports
if (!lines.some(l => l.includes('faregas-productos.api'))) {
    const importIdx = lines.findIndex(l => l.includes('faregas-chips.api'));
    lines.splice(importIdx + 1, 0, "import { faregasProductosApi, type ProductoFacturacion } from '../../services/faregas-productos.api';");
}

// 4. Update cargar() to fetch productosFiscales
const promiseAllIdx = lines.findIndex(l => l.includes('await Promise.all(['));
if (promiseAllIdx !== -1 && !lines.some(l => l.includes('faregasProductosApi.listar'))) {
    // find the end of Promise.all
    let endIdx = promiseAllIdx;
    while (!lines[endIdx].includes(']);')) endIdx++;
    // add it before the end
    lines[endIdx - 1] += ',';
    lines.splice(endIdx, 0, "        faregasProductosApi.listar()");
    
    // find the set variables after await
    const catIdx = lines.findIndex(l => l.includes('setCatalogos(cat);'));
    if (catIdx !== -1) {
        lines.splice(catIdx + 1, 0, "      setProductosFiscales(pf.filter((p: any) => p.activo && p.es_para_venta));");
        // modify the destructuring
        const destrIdx = lines.findIndex(l => l.includes('const [r, l, prods, cat] ='));
        if (destrIdx !== -1) {
            lines[destrIdx] = lines[destrIdx].replace('const [r, l, prods, cat]', 'const [r, l, prods, cat, pf]');
        }
    }
}

// 5. Ensure the payload in handleCrearProducto includes productoFacturacionId
const payloadIdx = lines.findIndex(l => l.includes('tipo: newProductTipo,'));
if (payloadIdx !== -1 && !lines[payloadIdx + 1].includes('productoFacturacionId')) {
    lines.splice(payloadIdx + 1, 0, "        productoFacturacionId: newProductProductoFacturacionId === '' ? undefined : Number(newProductProductoFacturacionId),");
}

fs.writeFileSync(p, lines.join('\n'));
console.log('Fixed states and imports.');
