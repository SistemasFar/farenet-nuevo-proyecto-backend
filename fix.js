const fs = require('fs'); 
const file = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/views/Inicio/NuevaInspeccion/components/NuevaInspeccion/VehiculoStep.tsx'; 
let content = fs.readFileSync(file, 'utf8'); 
content = content.replace(/asientos: res\.data\.nroasientos \|\| '',\s*pasajeros: res\.data\.nropasajeros \|\| '',\s*ruedas: res\.data\.nroruedas \|\| '',\s*ejes: res\.data\.nroejes \|\| '',\s*cilindros: res\.data\.nrocilindros \|\| '',/g, `categoria: res.data.categoria_key || prev.categoria || '',
            categoriaExtra: res.data.categoriaextra || '',
            clase: res.data.vehiculoclase_key || '',
            marca: res.data.marca_key || '',
            modelo: res.data.modelo_key || '',
            color: res.data.color_key || '',
            carroceria: res.data.carroceria_key || '',
            combustible: res.data.combustible_key || '',
            nroCilindros: res.data.nrocilindros || '',
            kilometraje: res.data.kilometraje || '',
            kilometrajeOriginal: res.data.kilometraje || 0,
            nroAsientos: res.data.nroasientos || '',
            nroPasajeros: res.data.nropasajeros || '',
            nroRuedas: res.data.nroruedas || '',
            nroEjes: res.data.nroejes || '',
            nroPuertas: res.data.nropuertas || '',
            nroPisos: res.data.nropisos || '',
            salidasEmergencia: res.data.nrosalidaemergencia || '',`); 
fs.writeFileSync(file, content);
