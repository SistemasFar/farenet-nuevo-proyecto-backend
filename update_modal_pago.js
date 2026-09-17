const fs = require('fs');
const path = require('path');

const modalPath = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ModalVentaChips.tsx');
const modalCode = `import { useState, useMemo, useEffect } from 'react';
import { faregasChipsApi, Chip, ProductoInventariable } from '../../services/faregas-chips.api';
import { ChipScannerInput, parseChipScan } from './ChipScannerInput';
import { PagoStep } from '../NuevoCertificado/components/NuevoCertificado/PagoStep';
import { maestrosApi } from '@/services/api';
import type { MaestrosPagoResponse } from '@/types/maestros';
import type { FormPagoState, PagoAgregado } from '../NuevoCertificado/NuevoCertificadoView';

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
  
  // Nuevo estado para pagos
  const [condicionPago, setCondicionPago] = useState<'CONTADO' | 'CREDITO'>('CONTADO');
  const [pagoTab, setPagoTab] = useState<PagoAgregado['tipo']>('EFECTIVO');
  const [pagosAgregados, setPagosAgregados] = useState<PagoAgregado[]>([]);
  const [formPago, setFormPago] = useState<FormPagoState>({});
  const [maestrosPago, setMaestrosPago] = useState<MaestrosPagoResponse['data'] | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const parsed = parseChipScan(scan);

  useEffect(() => {
    maestrosApi.obtenerMaestrosPagoAsync()
      .then(res => setMaestrosPago(res.data))
      .catch(err => console.error("Error al cargar maestros pago:", err));
  }, []);

  const { totalMonto } = useMemo(() => {
    let total = 0;
    for (const num of parsed.validos) {
      const currentChip = chipsConfig.find(c => c.numero_chip === num);
      let precio = 0;
      if (currentChip) {
        const prod = productosConfig.find(p => p.id === currentChip.producto_inventariable_id);
        const sede = prod?.sedes.find(s => s.plantaKey === plantaKey);
        precio = Number(sede?.precio || 0);
      }
      total += precio;
    }
    return { totalMonto: total };
  }, [parsed.validos, chipsConfig, productosConfig, plantaKey]);

  const handleAgregarPago = () => {
    if (!formPago.importe) return;
    setPagosAgregados(prev => [...prev, {
      tipo: pagoTab,
      importe: formPago.importe || '0',
      tarjetaKey: formPago.tarjetaKey,
      nroOperacion: formPago.nroOperacion,
      digitosTarjeta: formPago.digitosTarjeta,
      entidadFinancieraKey: formPago.entidadFinancieraKey,
      cuentaCorrienteKey: formPago.cuentaCorrienteKey,
      fechaDeposito: formPago.fechaDeposito
    }]);
    setFormPago({});
  };

  const eliminarPago = (index: number) => {
    setPagosAgregados(prev => prev.filter((_, i) => i !== index));
  };

  const totalPagado = pagosAgregados.reduce((sum, p) => sum + parseFloat(p.importe), 0);
  const pendiente = totalMonto - totalPagado;

  const handleSubmit = async () => {
    try {
      setError('');
      if (parsed.validos.length === 0) throw new Error('Debe escanear al menos un chip.');
      if (parsed.errores.length > 0 || parsed.duplicados.length > 0) throw new Error('Corrija los errores en el escaneo.');
      if (!nroDocumento || !nombreRazonSocial) throw new Error('Complete los datos del cliente.');
      
      if (condicionPago === 'CONTADO' && pendiente > 0) {
        throw new Error('Debe completar el pago para confirmar la venta al contado.');
      }

      setLoading(true);
      await faregasChipsApi.ventaDirecta({
        tipoComprobante,
        tipoDocumentoCliente,
        nroDocumento,
        nombreRazonSocial,
        condicionPago,
        medioPago: pagosAgregados.length > 0 ? pagosAgregados[0].tipo : 'EFECTIVO', // Fallback
        pagosAgregados,
        chips: parsed.validos
      } as any);

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
      <div className="w-full max-w-6xl rounded-2xl bg-white shadow-xl my-8">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h2 className="text-xl font-bold text-slate-900">Venta Directa de Chips</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-8 border-b border-slate-100">
          <div className="space-y-4">
            <h3 className="font-bold text-sm text-slate-700 border-b pb-2">1. Datos de Facturación</h3>
            
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
          </div>
          
          <div className="space-y-4">
            <h3 className="font-bold text-sm text-slate-700 border-b pb-2">2. Chips a vender</h3>
            <p className="text-xs text-slate-500">Escanee los chips disponibles. El precio se calculará automáticamente según la tarifa configurada para la sede.</p>
            <ChipScannerInput value={scan} onChange={setScan} />
            
            <div className="mt-4 rounded-xl bg-slate-50 p-4 border border-slate-200">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">Chips válidos escaneados:</span>
                <span className="font-bold">{parsed.validos.length}</span>
              </div>
            </div>

            {error && <p className="text-sm font-bold text-red-600 bg-red-50 p-3 rounded border border-red-200">{error}</p>}
          </div>
        </div>

        <div className="p-5">
          <PagoStep
            pagoTab={pagoTab}
            setPagoTab={setPagoTab}
            formPago={formPago}
            setFormPago={setFormPago}
            pagosAgregados={pagosAgregados}
            handleAgregarPago={handleAgregarPago}
            eliminarPago={eliminarPago}
            totalPagar={totalMonto}
            tarifaOriginal={totalMonto}
            maestrosPago={maestrosPago}
            condicionPago={condicionPago}
            onCondicionPagoChange={setCondicionPago}
          />
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
console.log('ModalVentaChips.tsx updated.');
