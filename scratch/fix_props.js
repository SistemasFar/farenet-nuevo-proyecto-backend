const fs = require('fs');
const viewPath = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/NuevoCertificadoView.tsx';
let code = fs.readFileSync(viewPath, 'utf8');

// Undo the wrong replacement from VehiculoStep
const badBlock = `<VehiculoStep
            certificadoId={certificadoId || (id ? parseInt(id) : undefined)}
            onEmisionExitosa={() => setIsEmitido(true)}
            tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}`;

const fixedBadBlock = `<VehiculoStep
            tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}`;

code = code.replace(badBlock, fixedBadBlock);

// Apply correctly to VerificacionStep
const verifBlock = `<VerificacionStep
            tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}`;

const fixedVerifBlock = `<VerificacionStep
            certificadoId={certificadoId || (id ? parseInt(id) : undefined)}
            onEmisionExitosa={() => setIsEmitido(true)}
            tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}`;

code = code.replace(verifBlock, fixedVerifBlock);

fs.writeFileSync(viewPath, code);
console.log('Fixed props placement');
