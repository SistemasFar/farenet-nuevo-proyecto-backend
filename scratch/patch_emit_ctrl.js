const fs = require('fs');

const routesPath = 'C:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetBackend/modules/faregas/routes/faregas-certificados.routes.js';
let routesCode = fs.readFileSync(routesPath, 'utf8');

if (!routesCode.includes('/borradores/:id/emitir')) {
    const target = "router.get('/borradores/:id/validar-emision', authMiddleware('faregas_flow'), controller.validarEmision);";
    const insert = "router.post('/borradores/:id/emitir', authMiddleware('faregas_flow'), controller.emitir);";
    routesCode = routesCode.replace(target, `${target}\n${insert}`);
    fs.writeFileSync(routesPath, routesCode);
    console.log('Routes updated');
}

const controllerPath = 'C:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetBackend/modules/faregas/controllers/faregas-certificados.controller.js';
let ctrlCode = fs.readFileSync(controllerPath, 'utf8');

if (!ctrlCode.includes('exports.emitir = async')) {
    const ctrlInsert = `
exports.emitir = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await certificadosService.emitirCertificado(id, req.user);
        res.json({ ok: true, data: result });
    } catch (error) {
        if (error.message === 'CERTIFICADO_NOT_FOUND' || error.message === 'PLANTA_NO_AUTORIZADA') {
            return res.status(403).json({ ok: false, message: 'No autorizado o no encontrado' });
        }
        if (['NO_VALIDO_PARA_EMISION', 'NO_EXISTE_RANGO_ACTIVO', 'RANGO_AGOTADO', 'FORMATO_NUMERO_NO_CONFIGURADO'].includes(error.message)) {
            return res.status(400).json({ ok: false, codigo: error.message, message: error.message });
        }
        res.status(500).json({ ok: false, message: error.message });
    }
};
`;
    ctrlCode += ctrlInsert;
    fs.writeFileSync(controllerPath, ctrlCode);
    console.log('Controller updated');
}
