const fs = require('fs');
const viewPath = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/NuevoCertificadoView.tsx';
let code = fs.readFileSync(viewPath, 'utf8');

if (!code.includes("import { useParams }")) {
    code = code.replace("import { useNavigate } from 'react-router-dom';", "import { useNavigate, useParams } from 'react-router-dom';");
}

if (!code.includes("const { id } = useParams();")) {
    code = code.replace("const navigate = useNavigate();", "const navigate = useNavigate();\n  const { id } = useParams();");
}

if (!code.includes("const [certificadoId,")) {
    code = code.replace("const [currentStepIndex,", "const [certificadoId, setCertificadoId] = useState<number | undefined>(undefined);\n  const [currentStepIndex,");
}

// Ensure the useEffect for loading the draft is there if missing, but maybe it's not needed for the build to pass?
// Wait, if I don't have the useEffect that loads the draft, the form won't load!
// Let me write a script to re-add the draft loading logic, which I wrote in Tarea 4.
const loadDraftLogic = `
  useEffect(() => {
    if (id) {
      const parsedId = parseInt(id);
      setCertificadoId(parsedId);
      faregasCertificadosApi.obtenerBorradorCompleto(parsedId).then(res => {
        if (res.ok && res.data) {
          const draft = res.data;
          // Set states
          if (draft.vehiculo) {
            setFormVehiculo({
              ...formVehiculo,
              ...draft.vehiculo
            });
          }
          if (draft.titulares) {
            setTitulares(draft.titulares);
          }
          if (draft.gnv) {
            setFormGnv(draft.gnv);
          }
          if (draft.glp) {
            setFormGlp(draft.glp);
          }
          if (draft.conformidad) {
            setFormConformidad(draft.conformidad);
          }
        }
      }).catch(err => {
        console.error(err);
      });
    }
  }, [id]);
`;

if (!code.includes("faregasCertificadosApi.obtenerBorradorCompleto(parsedId)")) {
    code = code.replace("export function NuevoCertificadoView() {", "export function NuevoCertificadoView() {\n" + loadDraftLogic);
}

fs.writeFileSync(viewPath, code);
console.log("Restored ID and draft logic");
