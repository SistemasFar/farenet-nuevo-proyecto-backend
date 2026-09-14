const { Pool } = require('pg');
require('dotenv').config();
const configService = require('./modules/faregas/services/faregas-config.service.js');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || '192.168.14.19',
  database: process.env.DB_NAME || 'inspeccion',
  password: process.env.DB_PASSWORD || 'farenet2026**',
  port: process.env.DB_PORT || 5432,
});

async function main() {
    // Monkey-patch db connect for the test
    const db = require('./modules/faregas/database/db.js');
    db.connect = async () => pool.connect();
    
    try {
        const payload = {
            codigo: '8081',
            nombre: 'CERTIFICADO NUEVO 808',
            categoria_id: 31, // Based on previous query
            tipo_flujo: 'TALLER_INSPECCION',
            requiere_certificado: true,
            tipo_certificado_clave: null, // What does Taller send?
            modalidad: null,
            formato_id: 1, // Suppose 1
            requiere_vehiculo: true,
            orden: 0
        };

        const result = await configService.crearServicio(payload, 'test_user', '127.0.0.1');
        console.log("Success:", result);
    } catch (err) {
        console.error("EXPECTED ERROR:", err.message);
        console.error(err);
    } finally {
        pool.end();
    }
}
main();
