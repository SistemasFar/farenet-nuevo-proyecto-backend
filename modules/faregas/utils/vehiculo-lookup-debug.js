const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const contextStorage = new AsyncLocalStorage();
const logDirectory = path.resolve(__dirname, '../../../logs');
const logFile = path.join(logDirectory, 'vehiculo-lookup-debug.log');
let requestCounter = 0;

const errorFields = (error) => ({
    errorName: error?.name || null,
    errorMessage: error?.message || String(error),
    errorCode: error?.code ?? null
});

const log = (phase, details = {}) => {
    const context = contextStorage.getStore();
    if (!context) return;
    const record = {
        timestamp: new Date().toISOString(),
        requestId: context.requestId,
        phase,
        ip: context.ip,
        method: context.method,
        originalUrl: context.originalUrl,
        placa: context.placa,
        excludeCertificadoId: context.excludeCertificadoId,
        tipoCertificado: context.tipoCertificado,
        ...details
    };
    try {
        fs.mkdirSync(logDirectory, { recursive: true });
        fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (_) {
        // La instrumentación es best-effort y nunca debe alterar la respuesta.
    }
};

const beginRequest = (req, res, next) => {
    requestCounter += 1;
    const timestamp = Date.now();
    const context = {
        requestId: `VEHICULO-${timestamp}-${requestCounter}`,
        ip: req.ip,
        method: req.method,
        originalUrl: req.originalUrl,
        placa: String(req.params.placa || '').trim().toUpperCase(),
        excludeCertificadoId: req.query.excludeCertificadoId ?? null,
        tipoCertificado: req.query.tipoCertificado ?? null
    };
    contextStorage.run(context, () => {
        log('START');
        res.on('finish', () => log('RESPONSE', { status: res.statusCode }));
        next();
    });
};

module.exports = {
    beginRequest,
    log,
    logError: (phase, error, status = null) => log(phase, { ...errorFields(error), status }),
    getLogFilePath: () => logFile
};
