const fs = require('fs');
const file = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/views/Inicio/NuevaInspeccion/components/NuevaInspeccion/VehiculoStep.tsx';
let content = fs.readFileSync(file, 'utf8');

// The code to replace:
const targetStr = `            pesoSeco: res.data.pesoseco || '',
            pesoBruto: res.data.pesobruto || '',
            cargaUtil: res.data.cargautil || '',
            longitud: res.data.longitud || '',
            altura: res.data.alto || res.data.altura || '',
            ancho: res.data.ancho || '',
          }));`;

const replacementStr = `            pesoSeco: res.data.pesoseco || '',
            pesoBruto: res.data.pesobruto || '',
            cargaUtil: res.data.cargautil || '',
            longitud: res.data.longitud || '',
            altura: res.data.alto || res.data.altura || '',
            ancho: res.data.ancho || '',
            nroSoat: res.data.nrosoat || '',
            tipoPoliza: res.data.tipopoliza_key || '',
            aseguradora: res.data.aseguradora_key || '',
            inicioSoat: res.data.fechiniciotarjetapropiedad ? res.data.fechiniciotarjetapropiedad.split('T')[0] : '',
            finSoat: res.data.fechfintarjetapropiedad ? res.data.fechfintarjetapropiedad.split('T')[0] : ''
          }));`;

content = content.replace(/pesoSeco:\s*res\.data\.pesoseco[^}]+\}\)\);/g, replacementStr);
fs.writeFileSync(file, content);
