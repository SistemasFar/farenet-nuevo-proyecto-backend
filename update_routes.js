const fs = require('fs');
const path = require('path');

const controllerPath = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\controllers\\faregas-chips.controller.js');
let controllerContent = fs.readFileSync(controllerPath, 'utf8');

if (!controllerContent.includes('crearVentaDirecta')) {
    controllerContent = controllerContent.replace(
        "const service = require('../services/faregas-chips.service');",
        "const service = require('../services/faregas-chips.service');\nconst ventasService = require('../services/faregas-ventas.service');"
    );
    controllerContent += `\nexports.crearVentaDirecta = async (req, res) => {\n    try {\n        const result = await ventasService.crearVenta({ plantaKey: req.user.planta_key, ...req.body }, req.user);\n        res.json({ success: true, ...result });\n    } catch (e) {\n        respond(res, e);\n    }\n};\n`;
    fs.writeFileSync(controllerPath, controllerContent);
}

const routesPath = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\routes\\faregas-chips.routes.js');
let routesContent = fs.readFileSync(routesPath, 'utf8');

if (!routesContent.includes('/venta-directa')) {
    routesContent = routesContent.replace(
        "router.post('/ventas',permiso('CHIPS_VER'),controller.vender);",
        "router.post('/ventas',permiso('CHIPS_VER'),controller.vender);\nrouter.post('/venta-directa',permiso('CHIPS_VER'),controller.crearVentaDirecta);"
    );
    fs.writeFileSync(routesPath, routesContent);
}

console.log('Rutas y controlador actualizados.');
