const { randomUUID } = require('node:crypto');

module.exports = (req, res, next) => {
    const encabezado = 'X-FAREGAS-Referencia';
    if (!res.getHeader(encabezado)) {
        const referencia = randomUUID();
        res.setHeader(encabezado, referencia);
        res.append('Access-Control-Expose-Headers', encabezado);
        res.once('finish', () => {
            if (res.statusCode >= 500) {
                console.error('[FAREGAS HTTP]', {
                    referencia,
                    metodo: req.method,
                    ruta: req.route?.path || null,
                    estado: res.statusCode
                });
            }
        });
    }
    next();
};
