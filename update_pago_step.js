const fs = require('fs');
const path = require('path');

const pagoStepPath = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\NuevoCertificado\\components\\NuevoCertificado\\PagoStep.tsx');
let pagoStep = fs.readFileSync(pagoStepPath, 'utf8');

// Add the prop to the interface
pagoStep = pagoStep.replace(
  'maestrosPago: MaestrosPagoResponse[\'data\'] | null;',
  'maestrosPago: MaestrosPagoResponse[\'data\'] | null;\n  labelTarifaOriginal?: string;'
);

// Add the prop to the component signature
pagoStep = pagoStep.replace(
  'maestrosPago,',
  'maestrosPago,\n  labelTarifaOriginal = "Certificado:",'
);

// Use the prop in the render
pagoStep = pagoStep.replace(
  '<span className="text-slate-500 font-semibold">Certificado:</span>',
  '<span className="text-slate-500 font-semibold">{labelTarifaOriginal}</span>'
);

fs.writeFileSync(pagoStepPath, pagoStep);
console.log('Updated PagoStep.tsx');

// Now update ModalVentaChips to pass the prop
const modalPath = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Chips\\ModalVentaChips.tsx');
let modal = fs.readFileSync(modalPath, 'utf8');

modal = modal.replace(
  'onCondicionPagoChange={setCondicionPago}',
  'onCondicionPagoChange={setCondicionPago}\n            labelTarifaOriginal="Chips:"'
);

fs.writeFileSync(modalPath, modal);
console.log('Updated ModalVentaChips.tsx');
