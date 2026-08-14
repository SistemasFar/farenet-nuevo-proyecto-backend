const fs = require('fs');
const viewPath = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/NuevoCertificadoView.tsx';
let viewCode = fs.readFileSync(viewPath, 'utf8');

const regex = /\{\/\* FOOTER ACTIONS \*\/\}.*?(?=\n    <\/div>\n  \);\n\})/s;

const newFooter = `{/* FOOTER ACTIONS */}
      <div className="bg-slate-50 border-t border-slate-200 p-4 flex justify-between items-center">
        {currentStepIndex > 0 ? (
          <button
            type="button"
            onClick={() => { if(!isEmitido) irPasoAnterior(); }}
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
              disabled={isCreatingDraft || isSavingStep2 || (currentStepIndex === 0 && (!formCaja.tipoCertificado || !formCaja.placa || (!formCaja.categoria && !vehiculoEncontrado)))}
              className={\`flex items-center gap-2 rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm
                \${(isCreatingDraft || isSavingStep2 || (currentStepIndex === 0 && (!formCaja.tipoCertificado || !formCaja.placa || (!formCaja.categoria && !vehiculoEncontrado))))
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                  : 'bg-gold-3d hover:-translate-y-0.5'
                }\`}
            >
              {isCreatingDraft || isSavingStep2 ? 'Procesando...' : 'Siguiente Paso'}
            </button>
          )}
        </div>
      </div>`;

viewCode = viewCode.replace(regex, newFooter);
fs.writeFileSync(viewPath, viewCode);
console.log('Fixed Footer');
