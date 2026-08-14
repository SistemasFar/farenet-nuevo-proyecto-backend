const fs = require('fs');
const viewPath = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/NuevoCertificadoView.tsx';
let viewCode = fs.readFileSync(viewPath, 'utf8');

// 1. Add isEmitido state
viewCode = viewCode.replace(
    'const [isCreatingDraft, setIsCreatingDraft] = useState(false);',
    'const [isCreatingDraft, setIsCreatingDraft] = useState(false);\n  const [isEmitido, setIsEmitido] = useState(false);'
);

// 2. Add props to VerificacionStep
viewCode = viewCode.replace(
    '<VerificacionStep',
    '<VerificacionStep\n            certificadoId={certificadoId || (id ? parseInt(id) : undefined)}\n            onEmisionExitosa={() => setIsEmitido(true)}'
);

// 3. Modify Atrás button
viewCode = viewCode.replace(
    'onClick={irPasoAnterior}',
    'onClick={() => { if(!isEmitido) irPasoAnterior(); }}'
);
viewCode = viewCode.replace(
    'className="rounded-lg border border-slate-300 bg-white px-5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"',
    'className={`rounded-lg border px-5 py-2 text-xs font-bold transition ${isEmitido ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}\n            disabled={isEmitido}'
);

// 4. Modify Finalizar button block precisely
const oldFinalizar = `{currentStepIndex === STEPS.length - 1 ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={irSiguientePaso}
                className="bg-gold-3d hover:-translate-y-0.5 rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm"
              >
                FINALIZAR
              </button>
            </div>
          ) : (`;

const newFinalizar = `{currentStepIndex === STEPS.length - 1 ? (
            <div className="flex gap-3">
              {isEmitido ? (
                <button type="button" onClick={() => navigate('/faregas/inicio')} className="bg-green-600 text-white rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm hover:bg-green-700">VOLVER A INICIO</button>
              ) : (
                <button type="button" onClick={irSiguientePaso} className="bg-gold-3d hover:-translate-y-0.5 rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm">FINALIZAR</button>
              )}
            </div>
          ) : (`;

viewCode = viewCode.replace(oldFinalizar, newFinalizar);
fs.writeFileSync(viewPath, viewCode);
console.log('Fixed NuevoCertificadoView.tsx');
