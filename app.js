const express = require('express');
const cors = require('cors');
require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const pool = require('./config/database');

const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');

// Importación de Enrutadores Modulares
const authRoutes = require('./routes/auth.routes');
const usuarioRoutes = require('./routes/usuario.routes');
const operacionRoutes = require('./routes/operacion.routes');
const inspeccionesRoutes = require('./routes/inspecciones.routes');
const lineaRoutes = require('./routes/linea.routes');
const campanaRoutes = require('./routes/campana.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// 🚀 CONFIGURACIÓN GLOBAL DE RED
app.set('case sensitive routing', false);
app.set('strict routing', false);

// 🔒 CORS
const corsOptions = {
    origin: [
        'http://localhost:5173',
        'http://localhost:5174'
    ],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Swagger
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Farenet API Desacoplada',
            version: '1.0.0',
            description: 'Backend modular Farenet'
        },
        servers: [
            {
                url: 'http://127.0.0.1:3000/api',
                description: 'Servidor Local'
            }
        ],
        paths: {
            '/auth/login': {
                post: {
                    summary: 'Iniciar sesión del operador',
                    description: 'Valida credenciales y retorna sedes asignadas.',
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
                                        password: {
                                            type: 'string',
                                            example: '76052066'
                                        }
                                    },
                                    required: ['username', 'password']
                                }
                            }
                        }
                    },
                    responses: {
                        200: {
                            description: 'Autenticación exitosa'
                        },
                        401: {
                            description: 'Credenciales inválidas'
                        }
                    }
                }
            },

            '/auth/confirmar-planta': {
                post: {
                    summary: 'Confirmar sede operativa',
                    description: 'Registra la sesión y genera tokens.',
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
                    summary: 'Cerrar sesión',
                    description: 'Cierre lógico de sesión.',
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
                    summary: 'HU010 - Panel principal de operación',
                    description: 'Lista las inspecciones del día por sede. No muestra estados CON ni ANULADO.',
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
        }
    },
    apis: []
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);

app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerDocs)
);

// ==========================
// RUTAS API
// ==========================

app.use('/api/auth', authRoutes);
const auditoriaRoutes = require('./routes/auditoria.routes');
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/operacion', operacionRoutes);
app.use('/api/inspecciones', inspeccionesRoutes);
app.use('/api/linea', lineaRoutes);
app.use('/api/descuentos', campanaRoutes);
const maestrosRoutes = require('./routes/maestros.routes');
app.use('/api/maestros', maestrosRoutes);

const vehiculoRoutes = require('./routes/vehiculo.routes');
app.use('/api/vehiculo', vehiculoRoutes);

const externosRoutes = require('./routes/externos.routes');
app.use('/api/externos', externosRoutes);

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
        origin: ['http://localhost:5173', 'http://localhost:5174'],
        credentials: true,
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('🔗 Cliente conectado a Socket.io:', socket.id);
    socket.on('disconnect', () => {
        console.log('❌ Cliente desconectado:', socket.id);
    });
});

async function setupPostgresListen() {
    try {
        const client = await pool.connect();
        await client.query('LISTEN inspeccion_cambio');
        
        client.on('notification', (msg) => {
            if (msg.channel === 'inspeccion_cambio') {
                const payload = JSON.parse(msg.payload);
                console.log('🔔 Evento Postgres "inspeccion_cambio":', payload);
                io.emit('inspeccionActualizada', payload);
            }
        });
        console.log('✅ Node.js escuchando eventos "inspeccion_cambio" en PostgreSQL');
    } catch (error) {
        console.error('❌ Error configurando LISTEN en Postgres:', error);
    }
}
setupPostgresListen();

// ==========================
// CRON JOBS
// ==========================
const { startCronJobs } = require('./cron_jobs');
startCronJobs();

// ==========================
// START SERVER
// ==========================

server.listen(PORT, '127.0.0.1', () => {
    console.log('================================================================');
    console.log(`🚀 SERVIDOR CORRIENDO EN: http://127.0.0.1:${PORT}`);
    console.log('🔒 CORS CONFIGURADO PARA VITE 5173 Y 5174');
    console.log(`📑 SWAGGER: http://127.0.0.1:${PORT}/api-docs`);
    console.log('📌 HU011 ACTIVA: GET /api/inspecciones/buscar');
    console.log('================================================================');
});