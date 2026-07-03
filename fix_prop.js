const fs = require('fs');
const file = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/views/Inicio/NuevaInspeccion/components/NuevaInspeccion/VehiculoStep.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `            inicioSoat: res.data.fechiniciotarjetapropiedad ? res.data.fechiniciotarjetapropiedad.split('T')[0] : '',
            finSoat: res.data.fechfintarjetapropiedad ? res.data.fechfintarjetapropiedad.split('T')[0] : ''
          }));`;

const replacementStr = `            inicioSoat: res.data.fechiniciotarjetapropiedad ? res.data.fechiniciotarjetapropiedad.split('T')[0] : '',
            finSoat: res.data.fechfintarjetapropiedad ? res.data.fechfintarjetapropiedad.split('T')[0] : '',

            // Propietario
            nroDocProp: res.data.prop_nrodoc || '',
            tipoDocProp: res.data.prop_tipodoc || '',
            razonSocialProp: res.data.prop_razon || '',
            nombresProp: res.data.prop_nombres || '',
            apellidosProp: res.data.prop_apellidos || '',
            paisProp: res.data.prop_pais || '114',
            departamentoProp: res.data.prop_dep || '',
            provinciaProp: res.data.prop_prov || '',
            distritoProp: res.data.prop_dist || '',
            direccionProp: res.data.prop_dir || '',
            emailProp: res.data.prop_email || '',
            telefonoProp: res.data.prop_tel || ''
          }));`;

content = content.replace(/inicioSoat:[^}]+finSoat:[^}]+\}\)\);/g, replacementStr);
fs.writeFileSync(file, content);
