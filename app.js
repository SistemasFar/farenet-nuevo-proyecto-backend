require('./config/env-loader');
const { validateEnvironment } = require('./config/environment-validator');
validateEnvironment();

const express = require('express');
const cors = require('cors');
// Validaci�n Fail-Fast para AUTH_DISABLED
const isAuthDisabled = process.env.AUTH_DISABLED === 'true';
const isProduction = process.env.NODE_ENV === 'production';

if (isAuthDisabled) {
    if (isProduction) {
        console.error("FATAL ERROR: No se puede arrancar el servidor en producci�n con AUTH_DISABLED=true.");
        console.error("Esta configuraci�n compromete la seguridad del sistema y est� bloqueada.");
        process.exit(1);
    } else {
        console.warn("?? [ADVERTENCIA] AUTH_DISABLED est� activo. La autenticaci�n humana est� apagada. SOLO PARA DESARROLLO.");
    }
}

const http = require('http');
const { Server } = require('socket.io');
const pool = require('./config/database');

const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');

const { habilitarRutasFarenet } = require('./config/farenet-legacy');
const rutasFarenetHabilitadas = habilitarRutasFarenet();

const app = express();
const PORT = process.env.PORT || 3000;

// ?? CONFIGURACI�N GLOBAL DE RED
app.set('case sensitive routing', false);
app.set('strict routing', false);

// ?? CORS
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
// La importación administrativa de hasta 10,000 códigos se envía en un único
// lote JSON; 2 MB evita fragmentarla en miles de solicitudes individuales.
app.use(express.json({ limit: '2mb' }));

const { getSwaggerOptions } = require('./config/swagger-config');

// Swagger
const swaggerOptions = getSwaggerOptions(PORT);

swaggerOptions.definition.paths = {
            '/auth/login': {
                post: {
                    summary: 'Iniciar sesi�n del operador',
                    description: 'Valida credenciales y retorna sedes asignadas.',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        username: {
                                            type: 'string'
                                        },
                                        password: {
                                            type: 'string',
                                            format: 'password'
                                        }
                                    },
                                    required: ['username', 'password']
                                }
                            }
                        }
                    },
                    responses: {
                        200: {
                            description: 'Autenticaci�n exitosa'
                        },
                        401: {
                            description: 'Credenciales inv�lidas'
                        }
                    }
                }
            },

            '/auth/confirmar-planta': {
                post: {
                    summary: 'Confirmar sede operativa',
                    description: 'Registra la sesi�n y genera tokens.',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        username: {
                                            type: 'string',
                                            example: 'mchavez'
                                        },
                                        plantaKey: {
                                            type: 'string',
                                            example: '25'
                                        }
                                    },
                                    required: [
                                        'username',
                                        'plantaKey'
                                    ]
                                }
                            }
                        }
                    },
                    responses: {
                        200: {
                            description: 'Sede confirmada'
                        }
                    }
                }
            },

            '/auth/logout': {
                post: {
                    summary: 'Cerrar sesi�n',
                    description: 'Cierre l�gico de sesi�n.',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        username: {
                                            type: 'string',
                                            example: 'mchavez'
                                        }
                                    },
                                    required: ['username']
                                }
                            }
                        }
                    },
                    responses: {
                        200: {
                            description: 'Logout exitoso'
                        }
                    }
                }
            },

            '/operacion/inspecciones-dia': {
                get: {
                    summary: 'HU010 - Panel principal de operaci�n',
                    description: 'Lista las inspecciones del d�a por sede. No muestra estados CON ni ANULADO.',
                    parameters: [
                        {
                            in: 'query',
                            name: 'plantaKey',
                            required: true,
                            schema: {
                                type: 'string'
                            }
                        },
                        {
                            in: 'query',
                            name: 'fechaInicio',
                            required: false,
                            schema: {
                                type: 'string',
                                example: '2026-06-10'
                            }
                        },
                        {
                            in: 'query',
                            name: 'fechaFin',
                            required: false,
                            schema: {
                                type: 'string',
                                example: '2026-06-10'
                            }
                        },
                        {
                            in: 'query',
                            name: 'placa',
                            required: false,
                            schema: {
                                type: 'string'
                            }
                        },
                        {
                            in: 'query',
                            name: 'estado',
                            required: false,
                            schema: {
                                type: 'string'
                            }
                        },
                        {
                            in: 'query',
                            name: 'numeroInspeccion',
                            required: false,
                            schema: {
                                type: 'string'
                            }
                        },
                        {
                            in: 'query',
                            name: 'page',
                            required: false,
                            schema: {
                                type: 'integer',
                                example: 1
                            }
                        },
                        {
                            in: 'query',
                            name: 'pageSize',
                            required: false,
                            schema: {
                                type: 'integer',
                                example: 10
                            }
                        }
                    ],
                    responses: {
                        200: {
                            description: 'Listado de inspecciones operativas'
                        }
                    }
                }
            },

            '/inspecciones/buscar': {
                get: {
                    summary: 'HU011 - Buscar inspecciones registradas',
                    description: 'Busca inspecciones registradas por sede. Solo muestra estados CON, ANULADO y RETIRADO.',
                    parameters: [
                        {
                            in: 'query',
                            name: 'plantaKey',
                            required: true,
                            schema: {
                                type: 'string',
                                example: '201'
                            }
                        },
                        {
                            in: 'query',
                            name: 'numeroInspeccion',
                            required: false,
                            schema: {
                                type: 'string',
                                example: 'INS-201'
                            }
                        },
                        {
                            in: 'query',
                            name: 'placa',
                            required: false,
                            schema: {
                                type: 'string',
                                example: 'ABC123'
                            }
                        },
                        {
                            in: 'query',
                            name: 'comprobante',
                            required: false,
                            schema: {
                                type: 'string',
                                example: 'BE03'
                            }
                        },
                        {
                            in: 'query',
                            name: 'cliente',
                            required: false,
                            schema: {
                                type: 'string',
                                example: '20604368406'
                            }
                        },
                        {
                            in: 'query',
                            name: 'fechaInicio',
                            required: false,
                            schema: {
                                type: 'string',
                                example: '2026-06-01'
                            }
                        },
                        {
                            in: 'query',
                            name: 'fechaFin',
                            required: false,
                            schema: {
                                type: 'string',
                                example: '2026-06-10'
                            }
                        },
                        {
                            in: 'query',
                            name: 'estado',
                            required: false,
                            schema: {
                                type: 'string',
                                enum: ['CON', 'ANULADO', 'RETIRADO']
                            }
                        },
                        {
                            in: 'query',
                            name: 'page',
                            required: false,
                            schema: {
                                type: 'integer',
                                example: 1
                            }
                        },
                        {
                            in: 'query',
                            name: 'pageSize',
                            required: false,
                            schema: {
                                type: 'integer',
                                example: 10
                            }
                        }
                    ],
                    responses: {
                        200: {
                            description: 'Listado de inspecciones registradas'
                        },
                        400: {
                            description: 'Falta plantaKey'
                        },
                        500: {
                            description: 'Error interno al buscar inspecciones'
                        }
                    }
                }
            }
};

if (!rutasFarenetHabilitadas) {
    for (const route of Object.keys(swaggerOptions.definition.paths)) {
        if (/^\/(auth|operacion|inspecciones)(\/|$)/.test(route)) delete swaggerOptions.definition.paths[route];
    }
}
const swaggerDocs = swaggerJsDoc(swaggerOptions);

app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerDocs)
);

// ==========================
// RUTAS API
// ==========================

// Compatibilidad durante el traspaso al backend independiente.
if (rutasFarenetHabilitadas) {
    app.use('/api/auth', require('./routes/auth.routes'));
    app.use('/api/auditoria', require('./routes/auditoria.routes'));
    app.use('/api/usuarios', require('./routes/usuario.routes'));
    app.use('/api/operacion', require('./routes/operacion.routes'));
    app.use('/api/inspecciones', require('./middlewares/auth.middleware'), require('./routes/inspecciones.routes'));
    const lineaRoutes = require('./routes/linea.routes');
    app.use('/api/linea', lineaRoutes);
    app.use('/linea', lineaRoutes);
    app.use('/api/descuentos', require('./routes/campana.routes'));
}

// El asistente de certificados de FAREGAS también consume estas rutas.
const maestrosRoutes = require('./routes/maestros.routes');
app.use('/api/maestros', maestrosRoutes);

if (rutasFarenetHabilitadas) {
    app.use('/api/vehiculo', require('./routes/vehiculo.routes'));
}

const externosRoutes = require('./routes/externos.routes');
app.use('/api/externos', externosRoutes);

const faregasRoutes = require('./modules/faregas/routes/faregas.routes');
app.use('/api/faregas', faregasRoutes);

const faregasAuthRoutes = require('./modules/faregas/routes/faregas-auth.routes');
app.use('/api/faregas/auth', faregasAuthRoutes);

const globalAuthRoutes = require('./global-auth/global-auth.routes');
app.use('/api/global-auth', globalAuthRoutes);

// ==========================
// HEALTH CHECK
// ==========================

app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'online',
        database: 'connected_postgres'
    });
});

// ==========================
// WEBSOCKETS & POSTGRES LISTEN
// ==========================
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ['http://localhost:5173', 'http://localhost:5174', 'http://192.168.14.60:5173', 'http://192.168.14.60:5174'],
        credentials: true,
        methods: ["GET", "POST"]
    }
});


const jwt = require('jsonwebtoken');
const { obtenerAlcanceSocketFaregas, salaNotificacionesFaregas } =
    require('./modules/faregas/services/faregas-socket-session.service');

io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer /i, '');
    const rechazar = (message) => next(Object.assign(new Error(message), {
        data: { codigo: 'SOCKET_NO_AUTORIZADO' }
    }));
    if (typeof token !== 'string' || !token) return rechazar('Token de autenticación requerido');

    try {
        // El contenido sin verificar solo selecciona el verificador. No concede acceso.
        const candidato = jwt.decode(token);
        if (candidato && typeof candidato === 'object' && Object.hasOwn(candidato, 'faregas_flow')) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET_FAREGAS, { algorithms: ['HS256'] });
            const alcance = await obtenerAlcanceSocketFaregas(pool, decoded);
            if (!alcance) return rechazar('Sesión FAREGAS inválida o expirada');
            socket.data.faregas = { token: decoded, alcance };
        } else {
            if (!rutasFarenetHabilitadas) return rechazar('Conexión FARENET deshabilitada');
            const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
            if (!decoded.username || !decoded.sessionJti || !decoded.jti || !Number.isFinite(decoded.exp)) {
                return rechazar('Sesión FARENET inválida o expirada');
            }
            socket.data.farenet = decoded;
        }
        return next();
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
        return;
    }

    socket.join('farenet:inspecciones');
});

// Inyectar la instancia de Socket.IO en el servicio de notificaciones.
const notificacionesService = require('./modules/faregas/services/faregas-notificaciones.service');
notificacionesService.setSocketIO(io);

async function setupPostgresListen() {
    try {
        const client = await pool.connect();
        await client.query('LISTEN inspeccion_cambio');
        
        client.on('notification', (msg) => {
            if (msg.channel === 'inspeccion_cambio') {
                const payload = JSON.parse(msg.payload);
                console.log('?? Evento Postgres "inspeccion_cambio":', payload);
                io.to('farenet:inspecciones').emit('inspeccionActualizada', payload);
            }
        });
        console.log('? Node.js escuchando eventos "inspeccion_cambio" en PostgreSQL');
    } catch (error) {
        console.error('? Error configurando LISTEN en Postgres:', error);
    }
}
if (rutasFarenetHabilitadas) setupPostgresListen();

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
    console.log(`?? SERVIDOR CORRIENDO EN: http://127.0.0.1:${PORT}`);
    console.log(`??? BD AMBIENTE: ${process.env.APP_DATABASE_ENVIRONMENT || 'NO DEFINIDO'}`);
    console.log(`?? NUBEFACT AMBIENTE: ${process.env.NUBEFACT_ENVIRONMENT || 'NO DEFINIDO'}`);
    console.log('?? CORS CONFIGURADO PARA VITE 5173 Y 5174');
    console.log(`?? SWAGGER: http://127.0.0.1:${PORT}/api-docs`);
    if (rutasFarenetHabilitadas) console.log('?? HU011 ACTIVA: GET /api/inspecciones/buscar');
    console.log('================================================================');
});
