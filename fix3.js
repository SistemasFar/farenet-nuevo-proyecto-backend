const fs = require('fs');
const file = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/views/Inicio/NuevaInspeccion/components/NuevaInspeccion/CajaStep.tsx';
let content = fs.readFileSync(file, 'utf8');

// The code to replace:
const targetStr = `              // AUTO-FILL de todos los campos según la reinspección anterior
              setFormCaja((prev: any) => ({
                ...prev,
                nrodocumentoreinspeccion: rData.nrodocumentoreinspeccion,
                tipoAutorizacion: rData.tipoautorizacion_key || prev.tipoAutorizacion,
                tipoCertificado: rData.tipocertificado_key || prev.tipoCertificado,
                tipoInspeccion: rData.tipoinspeccion_key || prev.tipoInspeccion,
                categoria: rData.categoria_key || prev.categoria,
                tipoPlaca: oldTipoPlaca
              }));`;

const replacementStr = `              // AUTO-FILL de todos los campos segun la reinspeccion anterior
              setFormCaja((prev: any) => ({
                ...prev,
                nrodocumentoreinspeccion: rData.nrodocumentoreinspeccion,
                tipoAutorizacion: rData.tipoautorizacion_key || prev.tipoAutorizacion,
                tipoCertificado: rData.tipocertificado_key || prev.tipoCertificado,
                tipoInspeccion: rData.tipoinspeccion_key || prev.tipoInspeccion,
                categoria: rData.categoria_key || prev.categoria,
                tipoPlaca: oldTipoPlaca
              }));

              // Y RESTAURAMOS TODOS LOS DATOS DEL VEHICULO Y SOAT (Si existen)
              if (rData.ui_metadata && rData.ui_metadata.formVehiculo && setFormVehiculo) {
                setFormVehiculo(rData.ui_metadata.formVehiculo);
              }`;

// Since the file uses special characters like `según`, regex replacement might be tricky, so let's do a substring replacement manually.
content = content.replace(/setFormCaja\(\(prev: any\) => \(\{\s*\.\.\.prev,\s*nrodocumentoreinspeccion:[^}]+\}\)\);/g, replacementStr);
fs.writeFileSync(file, content);
