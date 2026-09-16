const fs = require('fs');
const p = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/Chips/ChipsView.tsx';
let t = fs.readFileSync(p, 'utf8');

// State
t = t.replace(
  'const [newProductTipo, setNewProductTipo] = useState(\'OTRO_PRODUCTO_FISICO\');',
  'const [newProductTipo, setNewProductTipo] = useState(\'OTRO_PRODUCTO_FISICO\');\n  const [newProductProductoFacturacionId, setNewProductProductoFacturacionId] = useState<number | \'\'>(\'\');'
);
t = t.replace(
  'const [editProductTipo, setEditProductTipo] = useState(\'OTRO_PRODUCTO_FISICO\');',
  'const [editProductTipo, setEditProductTipo] = useState(\'OTRO_PRODUCTO_FISICO\');\n  const [editProductProductoFacturacionId, setEditProductProductoFacturacionId] = useState<number | \'\'>(\'\');'
);

// Payload Crear
t = t.replace(
  'codigo: newProductCodigo,',
  'productoFacturacionId: newProductProductoFacturacionId === \'\' ? undefined : Number(newProductProductoFacturacionId),\n        codigo: newProductCodigo,'
);
// Payload Editar
t = t.replace(
  'codigo: editProductCodigo, // included just to satisfy type, backend ignores it',
  'productoFacturacionId: editProductProductoFacturacionId === \'\' ? undefined : Number(editProductProductoFacturacionId),\n        codigo: editProductCodigo, // included just to satisfy type, backend ignores it'
);

// Open Modal Editar
t = t.replace(
  'setEditProductTipo(prod.tipo);',
  'setEditProductTipo(prod.tipo);\n    setEditProductProductoFacturacionId(prod.producto_facturacion_id || \'\');'
);

// Clear Modal Crear
t = t.replace(
  'setNewProductTipo(\'OTRO_PRODUCTO_FISICO\');',
  'setNewProductTipo(\'OTRO_PRODUCTO_FISICO\');\n      setNewProductProductoFacturacionId(\'\');'
);

// UI Edit
const uiEdit = `
            </div>
            <div className="form-group mb-3">
              <label className="form-label">Producto fiscal de venta</label>
              <select className="form-select" value={editProductProductoFacturacionId} onChange={e => setEditProductProductoFacturacionId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">(Ninguno)</option>
                {maestrosFacturacion.map(f => (
                  <option key={f.id} value={f.id}>{f.nombre}</option>
                ))}
              </select>
            </div>
            <div className="mb-3">
`;
t = t.replace(
  '            </div>\n            <div className="mb-3">\n              <label className="form-label fw-bold mb-2">Configuración por Sedes (Requerido)</label>',
  uiEdit + '\n              <label className="form-label fw-bold mb-2">Configuración por Sedes (Requerido)</label>'
);

// UI New
const uiNew = `
            </div>
            <div className="form-group mb-3">
              <label className="form-label">Producto fiscal de venta</label>
              <select className="form-select" value={newProductProductoFacturacionId} onChange={e => setNewProductProductoFacturacionId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">(Ninguno)</option>
                {maestrosFacturacion.map(f => (
                  <option key={f.id} value={f.id}>{f.nombre}</option>
                ))}
              </select>
            </div>
            <div className="mb-3">
`;
t = t.replace(
  '            </div>\n            <div className="mb-3">\n              <label className="form-label fw-bold mb-2">Configuración por Sedes (Opcional si no se requiere inventario)</label>',
  uiNew + '\n              <label className="form-label fw-bold mb-2">Configuración por Sedes (Opcional si no se requiere inventario)</label>'
);

fs.writeFileSync(p, t);
