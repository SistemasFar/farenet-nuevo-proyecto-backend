const express = require('express');
const cors = require('cors');
require('dotenv').config();

const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');

// Importación de Enrutadores Modulares
const authRoutes = require('./routes/auth.routes');
const usuarioRoutes = require('./routes/usuario.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// 🚀 CONFIGURACIÓN GLOBAL DE RED: Ignora mayúsculas/minúsculas y barras inclinadas extra
app.set('case sensitive routing', false);
app.set('strict routing', false);

// 🔒 CANDADO DE SEGURIDAD CORS MULTI-PUERTO (Desarrollo Seguro)
// Permite que tanto el puerto base como el alternativo de tu entorno local en Vite se comuniquen con el Backend
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true, // <--- Crucial para el intercambio de cookies/tokens en la HU004
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// Configuración de Documentación Swagger interactiva
const swaggerOptions = {
    swaggerDefinition: {
        openapi: '3.0.0',
        info: {
            title: 'Farenet API Desacoplada',
            version: '1.0.0',
            description: 'Estructura profesional, modular y blindada para el nuevo Backend de Farenet'
        },
        servers: [{ url: `http://127.0.0.1:${PORT}`, description: 'Servidor Local' }]
    },
    apis: [] 
};
const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// 🚀 MONTAJE DE RUTAS ESTÁNDAR (Preparadas en minúsculas para JavaScript nativo)
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuarioRoutes);

// Endpoint de diagnóstico rápido para el Área de Sistemas
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'online', database: 'connected_postgres' });
});

// Inicialización del proceso permanentemente en IPv4 local
app.listen(PORT, '127.0.0.1', () => {
    console.log(`================================================================`);
    console.log(`🚀 SERVIDOR BLINDADO CORRIENDO EN: http://127.0.0.1:${PORT}`);
    console.log(`🔒 CORS CONFIGURADO PARA ENTORNOS VITE: 5173 Y 5174`);
    console.log(`📑 SWAGGER VIVO EN: http://127.0.0.1:${PORT}/api-docs`);
    console.log(`================================================================`);
});