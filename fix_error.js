const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\services\\faregas-ventas.service.js');
let c = fs.readFileSync(p, 'utf8');

c = c.replace("const { errorNegocio } = require('../../../utils/error-handler');\n", "");
c = c.replace(/throw errorNegocio\('CHIPS_REQUERIDOS', 400\);/g, "throw new Error('CHIPS_REQUERIDOS');");
c = c.replace(/throw errorNegocio\('CHIPS_NO_ENCONTRADOS_O_PRECIO_NO_CONFIGURADO', 400\);/g, "throw new Error('CHIPS_NO_ENCONTRADOS_O_PRECIO_NO_CONFIGURADO');");
c = c.replace(/throw errorNegocio\('CHIP_NO_DISPONIBLE', 400, { chip: c.numero_chip, estado: c.estado }\);/g, "const e=new Error('CHIP_NO_DISPONIBLE'); e.detalles={ chip: c.numero_chip, estado: c.estado }; throw e;");
c = c.replace(/throw errorNegocio\('SERIE_NO_CONFIGURADA', 400\);/g, "throw new Error('SERIE_NO_CONFIGURADA');");

fs.writeFileSync(p, c);
console.log('Fixed errorNegocio');
