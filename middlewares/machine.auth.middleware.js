const machineAuthMiddleware = (req, res, next) => {
    // 2. Validar que exista la configuración
    const validKey = process.env.MACHINE_API_KEY;
    if (!validKey) {
        return res.status(500).json({
            ok: false,
            message: "Machine auth no configurado"
        });
    }

    // 1. Leer el header
    const apiKey = req.headers['x-machine-api-key'];

    // 3. Si el request no trae header
    if (!apiKey) {
        return res.status(401).json({
            ok: false,
            message: "Machine API key requerida"
        });
    }

    // 4. Si el header no coincide
    if (apiKey !== validKey) {
        return res.status(401).json({
            ok: false,
            message: "Machine API key inválida"
        });
    }

    // 5. Si es correcta, inyectar
    req.machine = {
        authenticated: true,
        type: 'machine',
        source: 'linea-appresultado'
    };

    req.user = {
        username: 'sistema',
        isMachine: true
    };

    next();
};

module.exports = machineAuthMiddleware;
