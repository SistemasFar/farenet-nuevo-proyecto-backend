const fs = require('fs');
const apiFile = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx';
let apiContent = fs.readFileSync(apiFile, 'utf8');

// 1. Add filter state
if (!apiContent.includes('const [filtroEstado, setFiltroEstado]')) {
    apiContent = apiContent.replace(
        'const [buscar, setBuscar] = useState(\'\');',
        'const [buscar, setBuscar] = useState(\'\');\n  const [filtroEstado, setFiltroEstado] = useState(\'TODOS\');'
    );
}

// 2. Modify API call
if (!apiContent.includes('estado: filtroEstado === \'TODOS\' ? undefined : filtroEstado')) {
    apiContent = apiContent.replace(
        'faregasChipsApi.listar({ buscar }),',
        'faregasChipsApi.listar({ buscar, estado: filtroEstado === \'TODOS\' ? undefined : filtroEstado }),'
    );
}

// 3. Update dependencies
if (!apiContent.includes('[buscar, filtroEstado, selectedProductId]')) {
    apiContent = apiContent.replace(
        '[buscar, selectedProductId]);',
        '[buscar, filtroEstado, selectedProductId]);'
    );
    apiContent = apiContent.replace(
        '[buscar, cargar]);',
        '[buscar, filtroEstado, cargar]);'
    );
}

// 4. Update UI layout for filters
const oldSearch = `<label className="relative sm:ml-auto sm:w-72"><span className="mb-1 block text-xs font-bold text-slate-600">Buscar por código de chip</span><Search className="absolute bottom-2.5 left-3 h-4 w-4 text-slate-400" /><input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Ej. CHIP001" className="w-full rounded border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none" /></label>`;
const newSearch = `<div className="flex flex-col sm:flex-row gap-3 sm:ml-auto w-full sm:w-auto">
              <label className="relative w-full sm:w-48"><span className="mb-1 block text-xs font-bold text-slate-600">Estado</span>
                <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} className="w-full rounded border border-slate-300 py-[7px] px-3 text-sm focus:border-blue-500 focus:outline-none">
                  <option value="TODOS">Todos</option>
                  <option value="DISPONIBLE">Disponibles</option>
                  <option value="RESERVADO">Reservados</option>
                  <option value="VENDIDO">Vendidos</option>
                  <option value="BAJA">Bajas</option>
                </select>
              </label>
              <label className="relative w-full sm:w-72"><span className="mb-1 block text-xs font-bold text-slate-600">Buscar por código de chip</span><Search className="absolute bottom-2.5 left-3 h-4 w-4 text-slate-400" /><input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Ej. CHIP001" className="w-full rounded border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none" /></label>
            </div>`;
if (apiContent.includes(oldSearch)) {
    apiContent = apiContent.replace(oldSearch, newSearch);
}

// 5. Update row rendering to include colored badges
const oldRow = `<td className="p-3">{c.estado}</td>`;
const newRow = `<td className="p-3"><span className={\`inline-block rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider \${c.estado === 'DISPONIBLE' ? 'bg-emerald-100 text-emerald-800' : c.estado === 'RESERVADO' ? 'bg-amber-100 text-amber-800' : c.estado === 'VENDIDO' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700'}\`}>{c.estado}</span></td>`;
if (apiContent.includes(oldRow)) {
    apiContent = apiContent.replace(oldRow, newRow);
}

fs.writeFileSync(apiFile, apiContent);
console.log('ChipsView updated successfully');
