const fs = require('fs');
const path = require('path');
const controllerPath = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\controllers\\faregas-chips.controller.js');
let controllerCode = fs.readFileSync(controllerPath, 'utf8');

controllerCode = controllerCode.replace(
    'exports.crearVentaDirecta = async (req, res) => {',
    `exports.listarVentas = async (req, res) => {
    try {
        const ventas = await ventasService.listarVentas(req.user.planta_key);
        res.json({ success: true, ventas });
    } catch (e) {
        respond(res, e);
    }
};

exports.crearVentaDirecta = async (req, res) => {`
);

fs.writeFileSync(controllerPath, controllerCode);
console.log('Controller updated.');

const routesPath = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\routes\\faregas-chips.routes.js');
let routesCode = fs.readFileSync(routesPath, 'utf8');

routesCode = routesCode.replace(
    "router.post('/venta-directa', requirePlantaKey, controller.crearVentaDirecta);",
    "router.get('/ventas', requirePlantaKey, controller.listarVentas);\nrouter.post('/venta-directa', requirePlantaKey, controller.crearVentaDirecta);"
);

fs.writeFileSync(routesPath, routesCode);
console.log('Routes updated.');
