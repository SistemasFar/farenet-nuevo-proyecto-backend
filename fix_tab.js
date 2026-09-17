const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Configuracion\\components\\TabProductos.tsx');
let c = fs.readFileSync(p, 'utf8');

const target = `<div className="border-t pt-4">
          <label className="flex items-center gap-2 text-sm font-semibold mb-3">
            <input type="checkbox" checked={Boolean(actual.requiere_chip)} onChange={(e) => {
              const checked = e.target.checked;
              setActual({
                ...actual,
                requiere_chip: checked,
                producto_chip_id: checked ? actual.producto_chip_id : null,
                precio_chip: checked ? actual.precio_chip : null
              });
            }} />
            Agregar chip
          </label>
          {actual.requiere_chip && (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold">Tipo de chip
                <select required value={actual.producto_chip_id || ''} onChange={(e) => setActual({ ...actual, producto_chip_id: e.target.value ? Number(e.target.value) : null })} className="mt-1 w-full rounded-lg border bg-white p-2">
                  <option value="">Seleccionar tipo de chip...</option>
                  {chipsOpciones.map(chip => <option key={chip.id} value={chip.id}>{chip.codigo} - {chip.nombre}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold">Monto del chip
                <div className="mt-1 flex overflow-hidden rounded-lg border bg-white">
                  <span className="flex items-center bg-slate-50 px-3 text-slate-600">S/</span>
                  <input required type="number" min="0.01" step="0.01" value={actual.precio_chip ?? ''} onChange={(e) => setActual({ ...actual, precio_chip: nullableNumber(e.target.value) })} className="min-w-0 flex-1 p-2 outline-none" placeholder="0.00" />
                </div>
                <span className="mt-1 block text-xs font-normal text-slate-500">Se suma completo al precio del certificado; no recibe descuentos.</span>
              </label>
            </div>
          )}</div>`;

c = c.replace(target, '');
fs.writeFileSync(p, c);
console.log('Removed perfectly');
