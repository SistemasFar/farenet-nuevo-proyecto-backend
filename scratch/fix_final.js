const fs = require('fs');
const viewPath = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/NuevoCertificadoView.tsx';
let code = fs.readFileSync(viewPath, 'utf8');

// fix id variable scope
code = code.replace("export function NuevoCertificadoView() {\n\n  useEffect(() => {", "export function NuevoCertificadoView() {");
if (code.includes("const { id } = useParams();")) {
    code = code.replace("const { id } = useParams();", "");
}
code = code.replace("export function NuevoCertificadoView() {", "export function NuevoCertificadoView() {\n  const { id } = useParams();");

if (!code.includes("const [isEmitido, setIsEmitido] = useState(false);")) {
    code = code.replace("const [isCreatingDraft, setIsCreatingDraft] = useState(false);", "const [isCreatingDraft, setIsCreatingDraft] = useState(false);\n  const [isEmitido, setIsEmitido] = useState(false);");
}

code = code.replace(
    `<VehiculoStep
            tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}
            formVehiculo={formVehiculo}
            setFormVehiculo={setFormVehiculo}
            formPropietario={formPropietario}
            setFormPropietario={setFormPropietario}
            formGlp={formGlp}
            setFormGlp={setFormGlp}
            formGnv={formGnv}
            setFormGnv={setFormGnv}
            formConformidad={formConformidad}
            setFormConformidad={setFormConformidad}
          />`,
    `<VehiculoStep
            tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}
            formVehiculo={formVehiculo}
            setFormVehiculo={setFormVehiculo}
            formPropietario={formPropietario}
            setFormPropietario={setFormPropietario}
            formGlp={formGlp}
            setFormGlp={setFormGlp}
            formGnv={formGnv}
            setFormGnv={setFormGnv}
            formConformidad={formConformidad}
            setFormConformidad={setFormConformidad}
            titulares={titulares}
            setTitulares={setTitulares}
            catalogoVerificaciones={catalogoVerificaciones}
            talleres={talleres}
          />`
);

fs.writeFileSync(viewPath, code);
console.log("Fixed final syntax issues.");
