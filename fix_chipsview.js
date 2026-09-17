const fs = require('fs');
const path = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ChipsView.tsx';
let content = fs.readFileSync(path, 'utf8');

// Agregar precio en la tarjeta de tipo de chip, despues de "Clasificacion"
const oldCard = `            <p className="mt-3 text-xs text-slate-500">Clasificación: <b>{prod.tipo}</b></p>`;

const newCard = `            <p className="mt-3 text-xs text-slate-500">Clasificación: <b>{prod.tipo}</b></p>
            {(() => {
              const sede = (prod.sedes || []).find((s: any) => s.plantaKey === plantaKey);
              return sede?.precio
                ? <p className="mt-1 text-xs font-bold text-emerald-700">Precio en esta sede: S/ {Number(sede.precio).toFixed(2)}</p>
                : <p className="mt-1 text-xs text-amber-600">Sin precio configurado en esta sede</p>;
            })()}`;

if (content.includes(oldCard)) {
  content = content.replace(oldCard, newCard);
  console.log('Precio agregado a tarjeta - LF');
} else {
  const oldCRLF = oldCard.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) {
    content = content.replace(oldCRLF, newCard);
    console.log('Precio agregado a tarjeta - CRLF');
  } else {
    console.log('ERROR no encontrado. Buscando...');
    const idx = content.indexOf('Clasificaci');
    console.log(content.substring(idx-20, idx+200));
  }
}

fs.writeFileSync(path, content);
console.log('Guardado');
