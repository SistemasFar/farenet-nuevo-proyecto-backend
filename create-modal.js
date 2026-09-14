const fs = require('fs');

const content = `import { useState, useEffect } from 'react';
import { X, Search, FileCode, CheckCircle, Plus, Copy } from 'lucide-react';
import { ServicioConfiguracionFaregas, faregasConfigApi } from '../../../services/faregas-config.api';
import { Formato, faregasFormatosApi } from '../../../services/faregas-formatos.api';
import toast from 'react-hot-toast';

interface Props {
  servicio: ServicioConfiguracionFaregas;
  onClose: () => void;
  onAsignado: (formato: Formato) => void;
}

export default function FormatoAsignadorModal({ servicio, onClose, onAsignado }: Props) {
  const [formatos, setFormatos] = useState<Formato[]>([]);
  const [loading, setLoading] = useState(true);
  const [modo, setModo] = useState<'SELECCIONAR' | 'CREAR_NUEVO' | 'VARIANTE'>('SELECCIONAR');
  const [filtro, setFiltro] = useState('');
  const [saving, setSaving] = useState(false);

  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoCodigo, setNuevoCodigo] = useState('');

  useEffect(() => {
    faregasFormatosApi.listarFormatos()
      .then(res => setFormatos(res.filter(f => f.activo)))
      .finally(() => setLoading(false));
  }, []);

  const handleAsignarExistente = async (formato: Formato) => {
    if (!confirm('¿Estás seguro de asociar este formato?')) return;
    setSaving(true);
    try {
      await faregasConfigApi.asignarFormato(servicio.id, formato.id);
      toast.success('Formato asociado');
      onAsignado(formato);
    } catch (e: any) {
      toast.error(e.message || 'Error');
      setSaving(false);
    }
  };

  const handleCrearNuevo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const formato = await faregasFormatosApi.crearFormato({
        nombre: nuevoNombre,
        codigo: nuevoCodigo,
        motor: 'HTML_DINAMICO',
      });
      await faregasConfigApi.asignarFormato(servicio.id, formato.id);
      toast.success('Formato creado');
      onAsignado(formato);
    } catch (e: any) {
      toast.error(e.message || 'Error');
      setSaving(false);
    }
  };

  const handleCrearVariante = async (formatoPadre: Formato) => {
    if (!confirm('¿Crear variante para esta operación?')) return;
    setSaving(true);
    try {
      const formato = await faregasFormatosApi.crearFormato({
        nombre: formatoPadre.nombre + ' (' + servicio.codigo + ')',
        codigo: formatoPadre.codigo + '_' + servicio.codigo,
        motor: 'HTML_DINAMICO',
        formato_padre_id: formatoPadre.id
      });
      await faregasConfigApi.asignarFormato(servicio.id, formato.id);
      toast.success('Variante creada');
      onAsignado(formato);
    } catch (e: any) {
      toast.error(e.message || 'Error');
      setSaving(false);
    }
  };

  const filtrados = formatos.filter(f => f.nombre.toLowerCase().includes(filtro.toLowerCase()) || f.codigo.toLowerCase().includes(filtro.toLowerCase()));
  const delSistema = filtrados.filter(f => f.es_protegido && f.motor === 'SISTEMA');
  const dinamicos = filtrados.filter(f => !f.es_protegido);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-full w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Configurar documento</h2>
            <p className="text-sm text-slate-500">{servicio.codigo}</p>
          </div>
          <button onClick={onClose} disabled={saving}><X size={20} /></button>
        </header>

        <div className="flex shrink-0 border-b">
          <button className={\`flex-1 py-3 text-sm font-bold \${modo === 'SELECCIONAR' ? 'text-blue-700' : 'text-slate-500'}\`} onClick={() => setModo('SELECCIONAR')}>Usar existente</button>
          <button className={\`flex-1 py-3 text-sm font-bold \${modo === 'VARIANTE' ? 'text-blue-700' : 'text-slate-500'}\`} onClick={() => setModo('VARIANTE')}>Variante</button>
          <button className={\`flex-1 py-3 text-sm font-bold \${modo === 'CREAR_NUEVO' ? 'text-blue-700' : 'text-slate-500'}\`} onClick={() => setModo('CREAR_NUEVO')}>Nuevo</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? <div>Cargando...</div> : modo === 'CREAR_NUEVO' ? (
            <form onSubmit={handleCrearNuevo} className="mx-auto max-w-md space-y-4">
               <input placeholder="CÓDIGO" value={nuevoCodigo} onChange={e => setNuevoCodigo(e.target.value)} className="w-full border p-2" required />
               <input placeholder="Nombre" value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} className="w-full border p-2" required />
               <button type="submit" disabled={saving} className="w-full bg-blue-700 p-2 text-white font-bold rounded">Crear y asignar</button>
            </form>
          ) : (
            <div className="space-y-4">
              <input placeholder="Buscar..." value={filtro} onChange={e => setFiltro(e.target.value)} className="w-full border p-2 rounded" />
              <div className="grid grid-cols-2 gap-4">
                {(modo === 'SELECCIONAR' ? dinamicos : delSistema).map(f => (
                  <div key={f.id} className="border p-4 rounded-xl flex flex-col justify-between">
                     <div>
                       <h4 className="font-bold">{f.nombre}</h4>
                       <p className="text-xs">{f.codigo}</p>
                     </div>
                     <button onClick={() => modo === 'SELECCIONAR' ? handleAsignarExistente(f) : handleCrearVariante(f)} className="mt-4 border p-2 rounded font-bold text-blue-700">
                        {modo === 'SELECCIONAR' ? 'Asignar' : 'Crear variante'}
                     </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}`;

fs.writeFileSync('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Configuracion\\components\\FormatoAsignadorModal.tsx', content);
