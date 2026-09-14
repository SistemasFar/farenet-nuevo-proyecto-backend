const fs = require('fs');
const path = require('path');

const targetPath = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Configuracion\\components\\FormatoAsignadorModal.tsx';
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

  // Formulario nuevo
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoCodigo, setNuevoCodigo] = useState('');

  useEffect(() => {
    faregasFormatosApi.listarFormatos()
      .then(res => setFormatos(res.filter(f => f.activo)))
      .finally(() => setLoading(false));
  }, []);

  const handleAsignarExistente = async (formato: Formato) => {
    if (!confirm(\`¿Estás seguro de asociar el formato "\${formato.nombre}" a esta operación?\`)) return;
    setSaving(true);
    try {
      await faregasConfigApi.asignarFormato(servicio.id, formato.id);
      toast.success('Formato asociado exitosamente');
      onAsignado(formato);
    } catch (e: any) {
      toast.error(e.message || 'Error al asociar formato');
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
      toast.success('Formato creado y asignado exitosamente');
      onAsignado(formato);
    } catch (e: any) {
      toast.error(e.message || 'Error al crear formato');
      setSaving(false);
    }
  };

  const handleCrearVariante = async (formatoPadre: Formato) => {
    if (!confirm(\`¿Crear una variante de "\${formatoPadre.nombre}" para esta operación?\`)) return;
    setSaving(true);
    try {
      // Usamos el endpoint específico para clonar y asignar directamente.
      // Ojo: Para variantes no usamos faregasFormatosApi.crearFormato y asignarFormato por separado, 
      // porque faregas-config.api.ts ya tiene un método \`crearVarianteFormato\`.
      // Pero wait, el endpoint \`crearVarianteFormato\` de configApi asume que el servicio YA tiene un formato base.
      // En este flujo, el servicio NO tiene formato base aún.
      // Así que usamos faregasFormatosApi.crearFormato con formato_padre_id, y luego asignarFormato.
      const formato = await faregasFormatosApi.crearFormato({
        nombre: \`\${formatoPadre.nombre} (\${servicio.codigo})\`,
        codigo: \`\${formatoPadre.codigo}_\${servicio.codigo}\`,
        motor: 'HTML_DINAMICO',
        formato_padre_id: formatoPadre.id
      });
      await faregasConfigApi.asignarFormato(servicio.id, formato.id);
      toast.success('Variante creada y asignada exitosamente');
      onAsignado(formato);
    } catch (e: any) {
      toast.error(e.message || 'Error al crear variante');
      setSaving(false);
    }
  };

  const filtrados = formatos.filter(f => f.nombre.toLowerCase().includes(filtro.toLowerCase()) || f.codigo.toLowerCase().includes(filtro.toLowerCase()));
  const delSistema = filtrados.filter(f => f.es_protegido && f.motor === 'SISTEMA');
  const dinamicos = filtrados.filter(f => !f.es_protegido);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-full w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Configurar documento</h2>
            <p className="text-sm text-slate-500">{servicio.codigo} — {servicio.nombre}</p>
          </div>
          <button onClick={onClose} disabled={saving} className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X size={20} /></button>
        </header>

        <div className="flex shrink-0 border-b">
          <button className={\`flex-1 py-3 text-sm font-bold \${modo === 'SELECCIONAR' ? 'border-b-2 border-[#052A79] text-[#052A79]' : 'text-slate-500 hover:bg-slate-50'}\`} onClick={() => setModo('SELECCIONAR')}>
            Usar formato existente
          </button>
          <button className={\`flex-1 py-3 text-sm font-bold \${modo === 'VARIANTE' ? 'border-b-2 border-[#052A79] text-[#052A79]' : 'text-slate-500 hover:bg-slate-50'}\`} onClick={() => setModo('VARIANTE')}>
            Crear variante de SISTEMA
          </button>
          <button className={\`flex-1 py-3 text-sm font-bold \${modo === 'CREAR_NUEVO' ? 'border-b-2 border-[#052A79] text-[#052A79]' : 'text-slate-500 hover:bg-slate-50'}\`} onClick={() => setModo('CREAR_NUEVO')}>
            Crear dinámico nuevo
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="py-12 text-center text-slate-500">Cargando formatos...</div>
          ) : modo === 'SELECCIONAR' || modo === 'VARIANTE' ? (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
                <input
                  autoFocus
                  placeholder="Buscar formato por código o nombre..."
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                  className="w-full rounded-lg border py-2 pl-10 pr-4 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {(modo === 'SELECCIONAR' ? dinamicos : delSistema).map(formato => (
                  <div key={formato.id} className="flex flex-col justify-between rounded-xl border border-slate-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50">
                    <div>
                      <div className="flex items-center gap-2">
                        <FileCode size={16} className="text-slate-400" />
                        <h4 className="font-bold text-slate-800">{formato.nombre}</h4>
                      </div>
                      <p className="mt-1 font-mono text-xs text-slate-500">{formato.codigo}</p>
                      <div className="mt-2 text-xs">
                        {formato.es_protegido ? (
                           <span className="rounded bg-violet-100 px-2 py-0.5 font-semibold text-violet-700">SISTEMA PROTEGIDO</span>
                        ) : (
                           <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{formato.motor}</span>
                        )}
                      </div>
                    </div>
                    <button 
                      onClick={() => modo === 'SELECCIONAR' ? handleAsignarExistente(formato) : handleCrearVariante(formato)}
                      disabled={saving}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#052A79] shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {modo === 'SELECCIONAR' ? <><CheckCircle size={16} /> Usar este formato</> : <><Copy size={16} /> Crear variante</>}
                    </button>
                  </div>
                ))}
                {(modo === 'SELECCIONAR' ? dinamicos : delSistema).length === 0 && (
                  <div className="col-span-2 py-8 text-center text-sm text-slate-500">No se encontraron formatos coincidentes.</div>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={handleCrearNuevo} className="mx-auto max-w-md space-y-4 pt-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Código interno</label>
                <input
                  required
                  pattern="[A-Za-z0-9_]+"
                  placeholder="Ej: NUEVO_CERTIFICADO_V2"
                  value={nuevoCodigo}
                  onChange={(e) => setNuevoCodigo(e.target.value.toUpperCase().replace(/\\s+/g, '_'))}
                  className="w-full rounded-lg border border-slate-300 p-2 uppercase outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Nombre legible</label>
                <input
                  required
                  placeholder="Ej: Certificado Nuevo Formato"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Motor</label>
                <input
                  disabled
                  value="HTML_DINAMICO"
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 p-2 font-mono text-sm text-slate-500"
                />
              </div>
              <button
                type="submit"
                disabled={saving || !nuevoCodigo || !nuevoNombre}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#052A79] py-2.5 font-bold text-white shadow hover:bg-blue-900 disabled:opacity-50"
              >
                <Plus size={18} />
                Crear y asignar formato
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
\`;

fs.writeFileSync(targetPath, content);
console.log('Created FormatoAsignadorModal.tsx');
