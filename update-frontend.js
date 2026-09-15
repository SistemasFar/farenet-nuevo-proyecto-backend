const fs = require('fs');
const path = 'C:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/Configuracion/components/TabCorrelativos.tsx';
let content = fs.readFileSync(path, 'utf8');

const interfaceReplacement = `interface OperacionAsociada {
  servicioId: number;
  codigo: string;
  nombre: string;
  formatoId: number;
}

interface CorrelativoRango {`;

content = content.replace('interface CorrelativoRango {', interfaceReplacement);

content = content.replace('fechaCierre: string | null;', 'fechaCierre: string | null;\n  operacionesAsociadas?: OperacionAsociada[];\n  sinRango?: boolean;');

const cellReplacement = `<td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-slate-700">{r.tipoNombre}</div>
                        {r.sinRango && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">SIN RANGO</span>}
                      </div>
                      <span className="mt-1 inline-block rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-600">DG-{r.tipoCodigo}</span>
                      
                      {r.operacionesAsociadas && r.operacionesAsociadas.length > 0 && (
                        <details className="mt-2 text-xs group">
                          <summary className="cursor-pointer font-semibold text-[#052A79] hover:underline list-none flex items-center gap-1">
                            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                            {r.sinRango ? 'Requerido por ' : 'Operaciones: '}
                            {r.operacionesAsociadas.length} {r.operacionesAsociadas.length === 1 ? 'operación' : 'operaciones'}
                          </summary>
                          <ul className="mt-1.5 ml-1 space-y-1 text-slate-600 border-l-2 border-slate-200 pl-2">
                            {r.operacionesAsociadas.map(op => (
                              <li key={op.servicioId} title={\`Formato ID: \${op.formatoId}\`}>
                                • <span className="font-mono text-[10px] bg-slate-100 px-1 rounded border border-slate-200">{op.codigo}</span> - {op.nombre}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>`;

content = content.replace(/<td className="p-3">\s*<div className="font-bold text-slate-700">\{r\.tipoNombre\}<\/div>\s*<span className="mt-1 inline-block rounded border border-slate-200 bg-slate-100 px-2 py-0\.5 font-mono text-xs font-bold text-slate-600">DG-\{r\.tipoCodigo\}<\/span>\s*<\/td>/, cellReplacement);

fs.writeFileSync(path, content);
console.log("Success");
