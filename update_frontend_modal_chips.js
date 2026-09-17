const fs = require('fs');
const path = require('path');

const modalPath = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ModalVentaChips.tsx');
let modalCode = `import { useState, useMemo } from 'react';
import { faregasChipsApi, Chip, ProductoInventariable } from '../../services/faregas-chips.api';
import { ChipScannerInput, parseChipScan } from './ChipScannerInput';

export function ModalVentaChips({ 
  onClose, 
  onVentaExitosa,
  chipsConfig,
  productosConfig,
  plantaKey
}: { 
  onClose: () => void; 
  onVentaExitosa: () => void;
  chipsConfig: Chip[];
  productosConfig: ProductoInventariable[];
  plantaKey: string;
}) {
  const [scan, setScan] = useState('');
  const [tipoComprobante, setTipoComprobante] = useState('BOLETA');
  const [tipoDocumentoCliente, setTipoDocumentoCliente] = useState('DNI');
  const [nroDocumento, setNroDocumento] = useState('');
  const [nombreRazonSocial, setNombreRazonSocial] = useState('');
  const [condicionPago, setCondicionPago] = useState('CONTADO');
  const [medioPago, setMedioPago] = useState('EFECTIVO');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const parsed = parseChipScan(scan);

  // Calcular totales
  const { totalMonto, itemsConPrecio } = useMemo(() => {
    let total = 0;
    let items = [];
    for (const num of parsed.validos) {
      const currentChip = chipsConfig.find(c => c.numero_chip === num);
      let precio = 0;
      if (currentChip) {
        const prod = productosConfig.find(p => p.id === currentChip.producto_inventariable_id);
        const sede = prod?.sedes.find(s => s.plantaKey === plantaKey);
        precio = Number(sede?.precio || 0);
      }
      total += precio;
      items.push({ num, precio });
    }
    return { totalMonto: total, itemsConPrecio: items };
  }, [parsed.validos, chipsConfig, productosConfig, plantaKey]);

  const handleSubmit = async () => {
    try {
      setError('');
      if (parsed.validos.length === 0) throw new Error('Debe escanear al menos un chip.');
      if (parsed.errores.length > 0 || parsed.duplicados.length > 0) throw new Error('Corrija los errores en el escaneo.');
      if (!nroDocumento || !nombreRazonSocial) throw new Error('Complete los datos del cliente.');

      setLoading(true);
      await faregasChipsApi.ventaDirecta({
        tipoComprobante,
        tipoDocumentoCliente,
        nroDocumento,
        nombreRazonSocial,
        condicionPago,
        medioPago,
        chips: parsed.validos
      });

      onVentaExitosa();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Error al procesar la venta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-xl my-8">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h2 className="text-lg font-bold text-slate-900">Venta Directa de Chips</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="font-bold text-sm text-slate-700 border-b pb-2">Datos de Facturación</h3>
            
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-bold text-slate-700">Comprobante
                <select value={tipoComprobante} onChange={e => {
                  setTipoComprobante(e.target.value);
                  setTipoDocumentoCliente(e.target.value === 'FACTURA' ? 'RUC' : 'DNI');
                }} className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:border-blue-500 focus:outline-none">
                  <option value="BOLETA">BOLETA</option>
                  <option value="FACTURA">FACTURA</option>
                </select>
              </label>
              <label className="block text-sm font-bold text-slate-700">Documento
                <select value={tipoDocumentoCliente} onChange={e => setTipoDocumentoCliente(e.target.value)} disabled={tipoComprobante === 'FACTURA'} className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:border-blue-500 focus:outline-none disabled:bg-slate-100">
                  <option value="DNI">DNI</option>
                  <option value="RUC">RUC</option>
                  <option value="CE">CARNET EXTR.</option>
                </select>
              </label>
            </div>

            <label className="block text-sm font-bold text-slate-700">Nro Documento
              <input value={nroDocumento} onChange={e => setNroDocumento(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:border-blue-500 focus:outline-none" />
            </label>
            
            <label className="block text-sm font-bold text-slate-700">Nombre / Razón Social
              <input value={nombreRazonSocial} onChange={e => setNombreRazonSocial(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:border-blue-500 focus:outline-none" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-bold text-slate-700">Condición
                <select value={condicionPago} onChange={e => setCondicionPago(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:border-blue-500 focus:outline-none">
                  <option value="CONTADO">CONTADO</option>
                  <option value="CREDITO">CRÉDITO</option>
                </select>
              </label>
              <label className="block text-sm font-bold text-slate-700">Medio
                <select value={medioPago} onChange={e => setMedioPago(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:border-blue-500 focus:outline-none">
                  <option value="EFECTIVO">EFECTIVO</option>
                  <option value="YAPE">YAPE</option>
                  <option value="PLIN">PLIN</option>
                  <option value="TRANSFERENCIA">TRANSFERENCIA</option>
                  <option value="TARJETA">TARJETA</option>
                </select>
              </label>
            </div>
          </div>
          
          <div className="space-y-4">
            <h3 className="font-bold text-sm text-slate-700 border-b pb-2">Chips a vender</h3>
            <p className="text-xs text-slate-500">Escanee los chips disponibles. El precio se calculará automáticamente según la tarifa configurada para la sede.</p>
            <ChipScannerInput value={scan} onChange={setScan} />
            
            <div className="mt-4 rounded-xl bg-slate-50 p-4 border border-slate-200">
              <div className="flex justify-between items-center text-sm mb-2">
                <span className="text-slate-600">Total chips escaneados:</span>
                <span className="font-bold">{parsed.validos.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 font-bold text-lg">Monto Total a Cobrar:</span>
                <span className="font-black text-2xl text-[#052A79]">S/ {totalMonto.toFixed(2)}</span>
              </div>
            </div>

            {error && <p className="text-sm font-bold text-red-600 bg-red-50 p-3 rounded">{error}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50 p-5">
          <button onClick={onClose} disabled={loading} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200">Cancelar</button>
          <button onClick={handleSubmit} disabled={loading || parsed.validos.length === 0} className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50">
            {loading ? 'Procesando...' : 'Confirmar Venta y Emitir'}
          </button>
        </div>
      </div>
    </div>
  );
}
`;
fs.writeFileSync(modalPath, modalCode);

const chipsViewPath = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx');
let chipsViewContent = fs.readFileSync(chipsViewPath, 'utf8');

chipsViewContent = chipsViewContent.replace(
    "<ModalVentaChips onClose={() => setShowVentaModal(false)} onVentaExitosa={() => { alert('Venta exitosa'); cargar(); }} />",
    "<ModalVentaChips onClose={() => setShowVentaModal(false)} onVentaExitosa={() => { alert('Venta exitosa'); cargar(); }} chipsConfig={chips} productosConfig={productos} plantaKey={plantaKey} />"
);

fs.writeFileSync(chipsViewPath, chipsViewContent);
console.log('Frontend modal updated with price.');
