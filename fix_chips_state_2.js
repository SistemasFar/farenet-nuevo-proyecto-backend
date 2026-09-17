const fs = require('fs');
const p = 'C:\\\\Users\\\\Sistemas2\\\\Desktop\\\\farenet nuevo proyecto\\\\farenetFrontend\\\\src\\\\modules\\\\faregas\\\\views\\\\Chips\\\\ChipsView.tsx';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  `  const [productos, setProductos] = useState<ProductoInventariable[]>([]);\n  const [catalogos, setCatalogos] = useState<{ sedes: { key: string, nombre: string }[] }>({ sedes: [] });`,
  `  const [productos, setProductos] = useState<ProductoInventariable[]>([]);\n  const [catalogos, setCatalogos] = useState<{ sedes: { key: string, nombre: string }[] }>({ sedes: [] });\n  const [productosFiscales, setProductosFiscales] = useState<ProductoFacturacion[]>([]);`
);

c = c.replace(
  `  const [savingProduct, setSavingProduct] = useState(false);`,
  `  const [savingProduct, setSavingProduct] = useState(false);\n  const [newProductProductoFacturacionId, setNewProductProductoFacturacionId] = useState<number | ''>('');\n  const [newProductSedes, setNewProductSedes] = useState<Record<string, EditableSede>>({});`
);

c = c.replace(
  `        faregasChipsApi.catalogosProductosInventariables()\n      ]);`,
  `        faregasChipsApi.catalogosProductosInventariables(),\n        faregasProductosApi.listar()\n      ]);`
);

c = c.replace(
  `const [r, l, prods, cat] = await Promise.all([`,
  `const [r, l, prods, cat, pf] = await Promise.all([`
);

c = c.replace(
  `      setCatalogos(cat);`,
  `      setCatalogos(cat);\n      setProductosFiscales(pf.filter((p: any) => p.activo && p.es_para_venta));`
);

c = c.replace(
  `        tipo: newProductTipo,\n        sedes: []`,
  `        tipo: newProductTipo,\n        productoFacturacionId: newProductProductoFacturacionId === '' ? undefined : Number(newProductProductoFacturacionId),\n        sedes: []`
);

c = c.replace(
  `import { faregasChipsApi, type Chip, type ChipResumen, type ProductoInventariable } from '../../services/faregas-chips.api';`,
  `import { faregasChipsApi, type Chip, type ChipResumen, type ProductoInventariable } from '../../services/faregas-chips.api';\nimport { faregasProductosApi, type ProductoFacturacion } from '../../services/faregas-productos.api';`
);

fs.writeFileSync(p, c);
console.log('Fixed states');
