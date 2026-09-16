const fs = require('fs');
const p = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/NuevoCertificadoView.tsx';
let t = fs.readFileSync(p, 'utf8');

const oldTallerStep = `<TallerStep
            formulario={formatoFormulario}
            valores={formatoValores}
            setValores={setFormatoValores}
            cargando={formatoFormularioLoading}
            error={formatoFormularioError}
          />`;

const newTallerStep = `<TallerStep
            formulario={formatoFormulario}
            valores={formatoValores}
            setValores={setFormatoValores}
            cargando={formatoFormularioLoading}
            error={formatoFormularioError}
            titulares={titulares}
            setTitulares={setTitulares}
            formFacturacion={formFacturacion}
            setFormFacturacion={setFormFacturacion}
            onRemoveTitular={eliminarTitularBorrador}
          />`;

t = t.replace(oldTallerStep, newTallerStep);

const oldGuardarPasoTaller = `  const guardarPasoTaller = async (idBorrador: number) => {
    if (!formatoFormulario) throw new Error(formatoFormularioError || 'No se pudo cargar el formulario del formato.');
    await faregasCertificadosApi.guardarTaller(idBorrador, { valores: formatoValores });
  };`;

const newGuardarPasoTaller = `  const guardarPasoTaller = async (idBorrador: number) => {
    if (!formatoFormulario) throw new Error(formatoFormularioError || 'No se pudo cargar el formulario del formato.');
    await faregasCertificadosApi.guardarTaller(idBorrador, { valores: formatoValores });
    await guardarTitularesBorrador(idBorrador);
  };`;

t = t.replace(oldGuardarPasoTaller, newGuardarPasoTaller);

fs.writeFileSync(p, t);
console.log('NuevoCertificadoView.tsx modified successfully');
