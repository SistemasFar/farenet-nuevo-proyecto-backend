function getSwaggerOptions(port) {
    return {
        definition: {
            openapi: '3.0.0',
            info: {
                title: 'Farenet API Desacoplada',
                version: '1.0.0',
                description: 'Backend modular Farenet'
            },
            servers: [
                {
                    url: `http://127.0.0.1:${port}/api`,
                    description: 'Servidor Local'
                }
            ],
            paths: {
                // ... los paths se agregarán o inyectarán, pero esta es la base
            }
        },
        apis: [] // Puedes inyectar las rutas reales aquí si usas swagger-jsdoc
    };
}

module.exports = { getSwaggerOptions };
