const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx');
let c = fs.readFileSync(p, 'utf8');

// 1. Quitar el botón verde de Inventario
c = c.replace(
  '<button onClick={() => setShowVentaModal(true)} className="rounded px-3 py-2 text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700">Vender Chips</button>',
  ''
);

// 2. Reescribir TabVentas para que se vea como InicioView
const newTabVentas = `
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
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Operaciones recientes</h2>
          <p className="text-xs text-slate-500">Listado de chips vendidos</p>
        </div>
        <button onClick={() => setShowVentaModal(true)} className="rounded-lg bg-[#052A79] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#041c53]">
          + Vender Chips
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-xs text-slate-600">
            <thead className="bg-slate-50 uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-bold">N° VENTA</th>
                <th className="px-4 py-3 font-bold">FECHA Y HORA</th>
                <th className="px-4 py-3 font-bold">DNI / RUC</th>
                <th className="px-4 py-3 font-bold">NOMBRES / RAZÓN SOCIAL</th>
                <th className="px-4 py-3 font-bold">CHIPS VENDIDOS</th>
                <th className="px-4 py-3 font-bold">ESTADO DE VENTA</th>
                <th className="px-4 py-3 font-bold text-right">TOTAL</th>
                <th className="px-4 py-3 font-bold text-center">COMPROBANTE</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Cargando registros...</td></tr>
              ) : ventas.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">No se encontraron ventas.</td></tr>
              ) : (
                ventas.map((v) => (
                  <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50/50 transition">
                    <td className="px-4 py-3 font-bold text-[#052A79]">VENTA #{v.id}</td>
                    <td className="px-4 py-3">{new Date(v.creado_en).toLocaleString()}</td>
                    <td className="px-4 py-3 font-medium">{v.cliente_nro_documento}</td>
                    <td className="px-4 py-3 font-medium">{v.cliente_nombre}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[150px]">
                        {v.chips?.map((c, idx) => (
                          <span key={idx} className="bg-blue-50 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-200">
                            {c.numero_chip}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        {v.venta_estado === 'COMPLETADO' ? 'Pagado' : v.venta_estado}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-black text-slate-800">S/ {Number(v.importe_total).toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      {v.enlace_pdf ? (
                        <a href={v.enlace_pdf} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded bg-red-50 px-2 text-[11px] font-bold text-red-600 transition hover:bg-red-100 border border-red-200">
                          <FileText size={12} /> {v.nro_comprobante || 'PDF'}
                        </a>
                      ) : (
                        <span className="text-[10px] text-slate-400">Sin doc.</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
`;

// Primero borramos el TabVentas viejo (con regex que atrape toda la función)
// Ya que la escribí al final del archivo, simplemente haré replace del function TabVentas(...) { ... } entero.
c = c.replace(/function TabVentas\(\{\s*plantaKey[\s\S]*?\}\s*\)\s*\{[\s\S]*?\n\}\n/m, newTabVentas + '\n');

fs.writeFileSync(p, c);
console.log('TabVentas replaced and old button removed.');
