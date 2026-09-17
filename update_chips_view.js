const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  "import { faregasChipsApi, Chip, ChipResumen, ProductoInventariable } from '../../services/faregas-chips.api';",
  "import { faregasChipsApi, Chip, ChipResumen, ProductoInventariable, ChipVenta } from '../../services/faregas-chips.api';"
);
c = c.replace(
  "import { DownloadCloud, Info } from 'lucide-react';",
  "import { DownloadCloud, Info, FileText } from 'lucide-react';"
);

c = c.replace(
  "type Tab = 'INVENTARIO' | 'PRODUCTOS';",
  "type Tab = 'INVENTARIO' | 'PRODUCTOS' | 'VENTAS';"
);

c = c.replace(
  "<button type=\"button\" onClick={() => setActiveTab('PRODUCTOS')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-xs font-bold transition ${activeTab === 'PRODUCTOS' ? 'bg-[#052A79] text-white shadow' : 'text-slate-600 hover:bg-white'}`}><Boxes size={17} /> TIPOS DE CHIP</button>",
  `<button type="button" onClick={() => setActiveTab('PRODUCTOS')} className={\`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-xs font-bold transition \${activeTab === 'PRODUCTOS' ? 'bg-[#052A79] text-white shadow' : 'text-slate-600 hover:bg-white'}\`}><Boxes size={17} /> TIPOS DE CHIP</button>
      <button type="button" onClick={() => setActiveTab('VENTAS')} className={\`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-xs font-bold transition \${activeTab === 'VENTAS' ? 'bg-[#052A79] text-white shadow' : 'text-slate-600 hover:bg-white'}\`}><FileText size={17} /> VENTAS DE CHIPS</button>`
);

c = c.replace(
  '<div className="grid grid-cols-1 gap-2 rounded-xl bg-slate-200 p-1 sm:grid-cols-2">',
  '<div className="grid grid-cols-1 gap-2 rounded-xl bg-slate-200 p-1 sm:grid-cols-3">'
);

// Mover el boton de venta:
// Original:
/*
          <button
            onClick={() => setShowVentaModal(true)}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-700"
          >
            Vender Chips
          </button>
*/
c = c.replace(
  /<button\s*onClick=\{\(\) => setShowVentaModal\(true\)\}\s*className="rounded bg-emerald-600 px-3 py-1\.5 text-xs font-bold text-white shadow hover:bg-emerald-700"\s*>\s*Vender Chips\s*<\/button>/,
  ""
);

// We'll append a TabVentas at the end of the file, and then call it inside the main render.
const tabVentasComponent = `
function TabVentas({ plantaKey, productos, chipsList, onVentaExitosa, setShowVentaModal }: { plantaKey: string, productos: ProductoInventariable[], chipsList: Chip[], onVentaExitosa: () => void, setShowVentaModal: (v: boolean) => void }) {
  const [ventas, setVentas] = React.useState<ChipVenta[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    cargar();
  }, []);

  const cargar = async () => {
    try {
      setLoading(true);
      const res = await faregasChipsApi.listarVentas();
      if (res.success) setVentas(res.ventas);
    } catch(e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 sm:flex-row sm:items-center">
        <div>
          <p className="font-bold">Registro de Ventas de Chips</p>
          <p className="mt-1">Aquí encontrarás el historial de chips vendidos al contado o crédito en esta sede.</p>
        </div>
        <button onClick={() => setShowVentaModal(true)} className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white shadow transition hover:bg-emerald-700">INICIAR VENTA DE CHIPS</button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">ID / Fecha</th>
              <th className="p-3">Cliente</th>
              <th className="p-3">Chips Vendidos</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3">Comprobante</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="p-4 text-center">Cargando ventas...</td></tr> : 
             ventas.length === 0 ? <tr><td colSpan={5} className="p-4 text-center">No hay ventas registradas.</td></tr> :
             ventas.map(v => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="p-3">
                  <div className="font-bold text-[#052A79]">#{v.id}</div>
                  <div className="text-xs text-slate-500">{new Date(v.creado_en).toLocaleString()}</div>
                </td>
                <td className="p-3">
                  <div className="font-bold">{v.cliente_nombre}</div>
                  <div className="text-xs text-slate-500">{v.cliente_nro_documento}</div>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {v.chips?.map((c, idx) => (
                      <span key={idx} className="bg-slate-100 text-xs px-2 py-1 rounded border border-slate-200" title={c.producto}>
                        {c.numero_chip}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="p-3 text-right font-bold text-slate-700">
                  S/ {Number(v.importe_total).toFixed(2)}
                </td>
                <td className="p-3">
                  {v.enlace_pdf ? (
                    <a href={v.enlace_pdf} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 bg-red-100 text-red-700 px-2 py-1 rounded font-bold text-xs hover:bg-red-200">
                      <FileText size={14}/> {v.nro_comprobante}
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">Sin comprobante</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
`;

c = c.replace(
  "{activeTab === 'INVENTARIO' && <>",
  `{activeTab === 'VENTAS' && <TabVentas plantaKey={plantaKey} productos={productos} chipsList={chipsList} setShowVentaModal={setShowVentaModal} onVentaExitosa={async () => { await cargar(); }} />}
    {activeTab === 'INVENTARIO' && <>`
);

c = c + '\n\n' + tabVentasComponent;

fs.writeFileSync(p, c);
console.log('ChipsView.tsx updated.');
