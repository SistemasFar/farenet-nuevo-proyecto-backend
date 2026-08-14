const fs = require('fs');

const viewPath = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/NuevoCertificadoView.tsx';
let viewCode = fs.readFileSync(viewPath, 'utf8');

if (!viewCode.includes('isEmitido')) {
    viewCode = viewCode.replace(
        'const [isCreatingDraft, setIsCreatingDraft] = useState(false);',
        'const [isCreatingDraft, setIsCreatingDraft] = useState(false);\n  const [isEmitido, setIsEmitido] = useState(false);'
    );
    
    viewCode = viewCode.replace(
        '<VerificacionStep',
        '<VerificacionStep\n            certificadoId={certificadoId || (id ? parseInt(id) : undefined)}\n            onEmisionExitosa={() => setIsEmitido(true)}'
    );
    
    // Block "Atrás" navigation if emitted
    viewCode = viewCode.replace(
        'onClick={irPasoAnterior}',
        'onClick={() => { if(!isEmitido) irPasoAnterior(); }}'
    );
    // disable the Atrás button visually
    viewCode = viewCode.replace(
        'className="rounded-lg border border-slate-300 bg-white px-5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"',
        'className={`rounded-lg border px-5 py-2 text-xs font-bold transition ${isEmitido ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}\n            disabled={isEmitido}'
    );

    // disable "Finalizar" if emitted? Actually "Finalizar" could just go back to home. Or we hide it?
    // User says "deshabilitar navegación destinada a seguir modificando el borrador". Finalizar goes to home. Let's let them click Finalizar or hide it.
    // "El botón EMITIR CERTIFICADO debe desaparecer o quedar definitivamente deshabilitado."
    // Let's modify Finalizar to say "IR A INICIO" if isEmitido
    viewCode = viewCode.replace(
        '{currentStepIndex === STEPS.length - 1 ? (',
        '{currentStepIndex === STEPS.length - 1 ? (\n            <div className="flex gap-3">\n              {isEmitido ? (\n                <button type="button" onClick={() => navigate(\'/faregas/inicio\')} className="bg-green-600 text-white rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm hover:bg-green-700">VOLVER A INICIO</button>\n              ) : (\n                <button type="button" onClick={irSiguientePaso} className="bg-gold-3d hover:-translate-y-0.5 rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm">FINALIZAR</button>\n              )}\n            </div>\n          ) : ('
    );
    // remove the old one:
    viewCode = viewCode.replace(
        '<div className="flex gap-3">\n              <button\n                type="button"\n                onClick={irSiguientePaso}\n                className="bg-gold-3d hover:-translate-y-0.5 rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm"\n              >\n                FINALIZAR\n              </button>\n            </div>',
        ''
    );

    fs.writeFileSync(viewPath, viewCode);
    console.log('NuevoCertificadoView.tsx updated');
} else {
    console.log('Already updated');
}
