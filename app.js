require('./config/env-loader');
const { validateEnvironment } = require('./config/environment-validator');
validateEnvironment();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const pool = require('./config/database');
const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');
const jwt = require('jsonwebtoken');

const isAuthDisabled = process.env.AUTH_DISABLED === 'true';
const isProduction = process.env.NODE_ENV === 'production';

if (isAuthDisabled) {
    if (isProduction) {
        console.error("FATAL ERROR: No se puede arrancar el servidor en producción con AUTH_DISABLED=true.");
        console.error("Esta configuración compromete la seguridad del sistema y está bloqueada.");
        process.exit(1);
    } else {
        console.warn("⚠️ [ADVERTENCIA] AUTH_DISABLED está activo. La autenticación humana está apagada. SOLO PARA DESARROLLO.");
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de red
app.set('case sensitive routing', false);
app.set('strict routing', false);

// CORS
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://192.168.14.60:5173', 'http://192.168.14.60:5174'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use('/api/faregas', (_req, res, next) => {
    res.set({
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow'
    });
    next();
});
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

// Swagger
const { getSwaggerOptions } = require('./config/swagger-config');
const swaggerOptions = getSwaggerOptions(PORT);
swaggerOptions.definition.info.title = 'FAREGAS API';
swaggerOptions.definition.info.description = 'Backend independiente FAREGAS S.A.C.';
const swaggerDocs = swaggerJsDoc(swaggerOptions);

app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerDocs)
);

// ==========================
// RUTAS API FAREGAS
// ==========================

// Maestros (sedes, series, etc. consumidas por el asistente y módulos)
const maestrosRoutes = require('./routes/maestros.routes');
app.use('/api/maestros', maestrosRoutes);

// Consultas externas (clientes / RUC / DNI)
const externosRoutes = require('./routes/externos.routes');
app.use('/api/externos', externosRoutes);

// Módulo operativo y transaccional FAREGAS
const faregasRoutes = require('./modules/faregas/routes/faregas.routes');
app.use('/api/faregas', faregasRoutes);

// Autenticación de operadores y cajeros FAREGAS
const faregasAuthRoutes = require('./modules/faregas/routes/faregas-auth.routes');
app.use('/api/faregas/auth', faregasAuthRoutes);

// Autenticación unificada de entrada
const globalAuthRoutes = require('./global-auth/global-auth.routes');
app.use('/api/global-auth', globalAuthRoutes);

// ==========================
// HEALTH CHECK
// ==========================

app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'online',
        empresa: 'FAREGAS S.A.C.',
        database: 'connected_postgres'
    });
});

// ==========================
// WEBSOCKETS (FAREGAS)
// ==========================
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ['http://localhost:5173', 'http://localhost:5174', 'http://192.168.14.60:5173', 'http://192.168.14.60:5174'],
        credentials: true,
        methods: ["GET", "POST"]
    }
});

const { obtenerAlcanceSocketFaregas, salaNotificacionesFaregas } =
    require('./modules/faregas/services/faregas-socket-session.service');

io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer /i, '');
    const rechazar = (message) => next(Object.assign(new Error(message), {
        data: { codigo: 'SOCKET_NO_AUTORIZADO' }
    }));
    if (typeof token !== 'string' || !token) return rechazar('Token de autenticación requerido');

    try {
        const candidato = jwt.decode(token);
        if (candidato && typeof candidato === 'object' && Object.hasOwn(candidato, 'faregas_flow')) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET_FAREGAS, { algorithms: ['HS256'] });
            const alcance = await obtenerAlcanceSocketFaregas(pool, decoded);
            if (!alcance) return rechazar('Sesión FAREGAS inválida o expirada');
            socket.data.faregas = { token: decoded, alcance };
            return next();
        } else {
            return rechazar('Sesión no autorizada para el entorno FAREGAS');
        }
    } catch {
        return rechazar('Token inválido o expirado');
    }
});

io.on('connection', (socket) => {
    const alcance = socket.data.faregas?.alcance;
    if (alcance) {
        socket.join(salaNotificacionesFaregas(alcance));
        const timer = setTimeout(() => socket.disconnect(true), alcance.expiraEn - Date.now());
        socket.once('disconnect', () => clearTimeout(timer));
    }
});

// Inyectar la instancia de Socket.IO en el servicio de notificaciones FAREGAS
const notificacionesService = require('./modules/faregas/services/faregas-notificaciones.service');
notificacionesService.setSocketIO(io);

// ==========================
// CRON JOBS
// ==========================
const { startCronJobs } = require('./cron_jobs');
startCronJobs();

// ==========================
// START SERVER
// ==========================

server.listen(PORT, '0.0.0.0', () => {
    console.log('================================================================');
    console.log(`🚀 SERVIDOR FAREGAS CORRIENDO EN: http://127.0.0.1:${PORT}`);
    console.log(`🏢 SISTEMA: FAREGAS S.A.C.`);
    console.log(`🗄️ BD AMBIENTE: ${process.env.APP_DATABASE_ENVIRONMENT || 'NO DEFINIDO'}`);
    console.log(`📄 NUBEFACT AMBIENTE: ${process.env.NUBEFACT_ENVIRONMENT || 'NO DEFINIDO'}`);
    console.log('🌐 CORS CONFIGURADO PARA VITE 5173 Y 5174');
    console.log(`📚 SWAGGER: http://127.0.0.1:${PORT}/api-docs`);
    console.log('================================================================');
});

module.exports = { app, server, io };
