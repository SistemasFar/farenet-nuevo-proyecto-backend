const fs = require('fs');

const path = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Configuracion\\components\\TabCertificadosBase.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add lucide imports
content = content.replace(/import \{ Pencil \} from 'lucide-react';/, "import { Pencil, FileText, FileEdit, Plus } from 'lucide-react';");

// 2. Add Modal imports
const modalImports = `import FormatoAsignadorModal from './FormatoAsignadorModal';
import FormatoDetalleModal from './FormatoDetalleModal';\n`;
if (!content.includes('FormatoAsignadorModal')) {
    content = content.replace(/import ServicioModal/, modalImports + "import ServicioModal");
}

// 3. Add states
const states = `  const [asignarFormatoServicio, setAsignarFormatoServicio] = useState<ServicioConfiguracionFaregas | null>(null);
  const [editarFormatoId, setEditarFormatoId] = useState<number | null>(null);
  const [contextoEdicionServicio, setContextoEdicionServicio] = useState<ServicioConfiguracionFaregas | null>(null);\n`;
content = content.replace(/const \[modal, setModal\] = useState<ModalState \| null>\(null\);/, "const [modal, setModal] = useState<ModalState | null>(null);\n" + states);

// 4. Remove old badge `Formato: {nombreFormato(servicio)}`
content = content.replace(/<span className="rounded-full bg-violet-100 px-2 py-1 font-bold text-violet-700">Formato: [^<]+<\/span>/, "");

// 5. Inject Documento details
const docDetails = `
{servicio.requiere_certificado && (
    <div className="mt-4 rounded-lg bg-slate-50 p-3 border border-slate-200">
       <div className="flex items-center gap-2 mb-2">
          <FileText size={16} className="text-slate-500" />
          <span className="font-bold text-slate-700">Documento: {servicio.formato_nombre || 'No asignado'}</span>
       </div>
       {servicio.formato_id && (
          <div className="pl-6 space-y-1 text-[11px] text-slate-500">
             <p>Código: <span className="font-mono">{servicio.formato_codigo || servicio.formato_id}</span></p>
          </div>
       )}
    </div>
)}`;
content = content.replace(/\{servicio\.requiere_certificado \? 'Genera certificado' : 'No genera certificado'\}<\/label>/, "{servicio.requiere_certificado ? 'Genera certificado' : 'No genera certificado'}</label>" + docDetails);

// 6. Update buttons
const buttons = `<div className="flex flex-col gap-2 shrink-0">
{canManageTarifas && canViewProducts && <button type="button" onClick={() => setModal({ mode: 'EDIT', categoria, servicio, productoInicialId: productosServicio[0]?.id })} className="flex items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-[#052A79] hover:bg-blue-100 w-full"><Pencil size={14} /> Configurar</button>}
{servicio.requiere_certificado && (
    servicio.formato_id ? (
      <button type="button" onClick={() => { setEditarFormatoId(servicio.formato_id!); setContextoEdicionServicio(servicio); }} className="flex items-center justify-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100 w-full"><FileEdit size={14} /> Editar formato</button>
    ) : (
      <button type="button" onClick={() => setAsignarFormatoServicio(servicio)} className="flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 w-full"><Plus size={14} /> Agregar formato</button>
    )
)}
</div></div></div>;`;

// Find where the old Configurar button is and replace it
content = content.replace(/\{canManageTarifas && canViewProducts && <button type="button" onClick=\{[^}]+\} className="flex shrink-0 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-\[\#052A79\] hover:bg-blue-100"><Pencil size=\{14\} \/> Configurar<\/button>\}<\/div><\/div>;/, buttons);

// 7. Add Modals at the end
const modals = `
        {asignarFormatoServicio && (
          <FormatoAsignadorModal 
            servicio={asignarFormatoServicio} 
            onClose={() => setAsignarFormatoServicio(null)} 
            onAsignado={(formato) => {
              setAsignarFormatoServicio(null);
              setVersion(v => v + 1);
              setContextoEdicionServicio(asignarFormatoServicio);
              setEditarFormatoId(formato.id);
            }} 
          />
        )}
        {editarFormatoId && contextoEdicionServicio && (
          <FormatoDetalleModal 
            formatoId={editarFormatoId} 
            contextoOperacion={contextoEdicionServicio}
            onClose={() => { setEditarFormatoId(null); setContextoEdicionServicio(null); setVersion(v => v + 1); }} 
          />
        )}
      </div>
    );
`;
content = content.replace(/<\/div>\s*\);\s*\}\s*$/, modals + "\n  }\n");

fs.writeFileSync(path, content);
console.log('Updated TabCertificadosBase.tsx');
