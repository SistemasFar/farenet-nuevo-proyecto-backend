import sys
import re

file_path = "C:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/Configuracion/components/TabCorrelativos.tsx"

with open(file_path, "r", encoding="utf8") as f:
    content = f.read()

interface_replacement = """interface OperacionAsociada {
  servicioId: number;
  codigo: string;
  nombre: string;
  formatoId: number;
}

interface CorrelativoRango {"""

content = content.replace("interface CorrelativoRango {", interface_replacement)
content = content.replace("fechaCierre: string | null;", "fechaCierre: string | null;\n  operacionesAsociadas?: OperacionAsociada[];\n  sinRango?: boolean;")

cell_original = """<td className="p-3">
                      <div className="font-bold text-slate-700">{r.tipoNombre}</div>
                      <span className="mt-1 inline-block rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-600">DG-{r.tipoCodigo}</span>
                    </td>"""

cell_replacement = """<td className="p-3">
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
                              <li key={op.servicioId} title={`Formato ID: ${op.formatoId}`}>
                                • <span className="font-mono text-[10px] bg-slate-100 px-1 rounded border border-slate-200">{op.codigo}</span> - {op.nombre}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>"""

if cell_original in content:
    content = content.replace(cell_original, cell_replacement)
    print("Replaced cell")
else:
    print("Could not find cell_original")

with open(file_path, "w", encoding="utf8") as f:
    f.write(content)
