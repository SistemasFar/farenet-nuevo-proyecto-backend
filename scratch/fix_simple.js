const fs = require('fs');
const viewPath = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/NuevoCertificadoView.tsx';
let code = fs.readFileSync(viewPath, 'utf8');

// 1. Add id and certificadoId
code = code.replace(
  'const { nroInspeccion } = useParams<{ nroInspeccion: string }>();',
  `const { nroInspeccion, id } = useParams<{ nroInspeccion?: string; id?: string }>();`
);

code = code.replace(
  'const [currentStepIndex, setCurrentStepIndex] = useState(0);',
  `const [certificadoId, setCertificadoId] = useState<number | undefined>(undefined);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);`
);

// 2. Add isEmitido
code = code.replace(
  'const [isConsultado, setIsConsultado] = useState(false);',
  `const [isConsultado, setIsConsultado] = useState(false);
  const [isEmitido, setIsEmitido] = useState(false);`
);

// 3. Add titulares, catalogo, talleres
code = code.replace(
  'const [formConformidad, setFormConformidad] = useState<any>({});',
  `const [formConformidad, setFormConformidad] = useState<any>({});
  const [titulares, setTitulares] = useState<any[]>([]);
  const [catalogoVerificaciones, setCatalogoVerificaciones] = useState<any[]>([]);
  const [talleres, setTalleres] = useState<any[]>([]);`
);

// 4. Update VehiculoStep props
code = code.replace(
  `formConformidad={formConformidad}
            setFormConformidad={setFormConformidad}
          />`,
  `formConformidad={formConformidad}
            setFormConformidad={setFormConformidad}
            titulares={titulares}
            setTitulares={setTitulares}
            catalogoVerificaciones={catalogoVerificaciones}
            talleres={talleres}
          />`
);

// 5. Update VerificacionStep props
code = code.replace(
  `tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}`,
  `certificadoId={certificadoId || (id ? parseInt(id) : undefined)}
            onEmisionExitosa={() => setIsEmitido(true)}
            tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}`
);

// 6. Fix footer
const footerRegex = /\{\/\* FOOTER ACTIONS \*\/\}.*?(?=\n    <\/div>\n  \);\n\})/s;
const newFooter = `{/* FOOTER ACTIONS */}
      <div className="bg-slate-50 border-t border-slate-200 p-4 flex justify-between items-center">
        {currentStepIndex > 0 ? (
          <button
            type="button"
            onClick={() => { if(!isEmitido) { if (currentStepIndex > 0) setCurrentStepIndex(currentStepIndex - 1); } }}
            className={\`rounded-lg border px-5 py-2 text-xs font-bold transition \${isEmitido ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}\`}
            disabled={isEmitido}
          >
            Atrás
          </button>
        ) : <div></div>}

        <div className="flex flex-col items-end gap-1.5">
          {currentStepIndex === STEPS.length - 1 ? (
            <div className="flex gap-3">
              {isEmitido ? (
                <button type="button" onClick={() => navigate('/faregas/inicio')} className="bg-green-600 text-white rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm hover:bg-green-700">VOLVER A INICIO</button>
              ) : (
                <button type="button" onClick={irSiguientePaso} className="bg-gold-3d hover:-translate-y-0.5 rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm">FINALIZAR</button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={irSiguientePaso}
              className={\`flex items-center gap-2 rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm bg-gold-3d hover:-translate-y-0.5\`}
            >
              Siguiente Paso
            </button>
          )}
        </div>
      </div>`;

code = code.replace(footerRegex, newFooter);

fs.writeFileSync(viewPath, code);
console.log('Restored props');
