const fs = require('fs');

const path = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Configuracion\\components\\FormatoDetalleModal.tsx';
let content = fs.readFileSync(path, 'utf8');

// Update imports
content = content.replace(/import \{ Formato, FormatoVersion, faregasFormatosApi \} from '\.\.\/\.\.\/\.\.\/services\/faregas-formatos\.api';/, 
  "import { Formato, FormatoVersion, faregasFormatosApi } from '../../../services/faregas-formatos.api';\nimport { ServicioConfiguracionFaregas, faregasConfigApi } from '../../../services/faregas-config.api';\nimport { TriangleAlert } from 'lucide-react';");

// Update Props
const newProps = `interface Props {
  formatoId?: number; // Permite ID directo
  formato?: Formato; // Permite objeto completo (legacy compatibility)
  contextoOperacion?: ServicioConfiguracionFaregas;
  onClose: () => void;
  onCreateVariant?: (f: Formato) => void;
}`;
content = content.replace(/interface Props \{[\s\S]*?\}/, newProps);

// Update component signature
content = content.replace(/export default function FormatoDetalleModal\(\{ formato, onClose, onCreateVariant \}: Props\) \{/,
  "export default function FormatoDetalleModal({ formatoId, formato: propFormato, contextoOperacion, onClose, onCreateVariant }: Props) {\n  const [formato, setFormato] = useState<Formato | null>(propFormato || null);\n  const [operacionesVinculadas, setOperacionesVinculadas] = useState<{id:number, codigo:string, nombre:string}[]>([]);\n  const [creandoVariante, setCreandoVariante] = useState(false);");

// Update useEffect to fetch formato if only ID is provided, and fetch vinculadas
const newUseEffect = `  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        let currentFormato = propFormato;
        if (!currentFormato && formatoId) {
           const list = await faregasFormatosApi.listarFormatos();
           currentFormato = list.find(f => f.id === formatoId);
           setFormato(currentFormato || null);
        }
        if (currentFormato) {
           const [vers, ops] = await Promise.all([
             faregasFormatosApi.listarVersiones(currentFormato.id),
             faregasFormatosApi.obtenerOperacionesPorFormato(currentFormato.id).catch(() => [])
           ]);
           setVersiones(vers);
           setOperacionesVinculadas(ops);
        }
      } catch (e) {
        toast.error('Error al cargar datos del formato');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [formatoId, propFormato]);`;
  
content = content.replace(/  useEffect\(\(\) => \{[\s\S]*?  \}, \[formato\.id\]\);/, newUseEffect);

// Wait, the UI renders based on `formato`. Since `formato` is now state, it might be null initially.
// We need to add an early return or check.
content = content.replace(/  const versionActiva = versiones\.find\(\(v\) => v\.estado === 'VIGENTE'\);/,
  "  if (!formato) return null;\n  const versionActiva = versiones.find((v) => v.estado === 'VIGENTE');");

// Inject Shared Warning Banner
const banner = `        <div className="p-6 pb-2">
           {operacionesVinculadas.length > 1 && (
              <div className="mb-4 rounded-lg bg-orange-50 p-4 border border-orange-200 text-orange-800 text-sm shadow-sm flex items-start gap-3">
                 <TriangleAlert className="shrink-0 mt-0.5 text-orange-600" size={18} />
                 <div>
                   <p className="font-bold mb-1">Este formato es compartido</p>
                   <p>Cualquier cambio afectará a {operacionesVinculadas.length} operaciones activas ({operacionesVinculadas.map(o => o.codigo).join(', ')}).</p>
                   {contextoOperacion && (
                     <button 
                       onClick={async () => {
                         if(!confirm('¿Crear una variante exclusiva para esta operación?')) return;
                         setCreandoVariante(true);
                         try {
                           const res = await faregasConfigApi.crearVarianteFormato(contextoOperacion.id);
                           toast.success('Variante creada');
                           onClose(); // Close to force reload context
                         } catch(e:any) {
                           toast.error(e.message||'Error');
                           setCreandoVariante(false);
                         }
                       }}
                       disabled={creandoVariante}
                       className="mt-2 text-orange-700 underline font-semibold hover:text-orange-900"
                     >
                       Crear una variante solo para {contextoOperacion.codigo}
                     </button>
                   )}
                 </div>
              </div>
           )}`;
           
content = content.replace(/        <div className="p-6 pb-2">/, banner);

fs.writeFileSync(path, content);
console.log('Updated FormatoDetalleModal.tsx');
