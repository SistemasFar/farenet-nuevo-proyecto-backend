const { Pool } = require('pg');
require('dotenv').config();
const configService = require('./modules/faregas/services/faregas-config.service.js');
const tarifaService = require('./modules/faregas/services/faregas-tarifas-admin.service.js');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || '192.168.14.19',
  database: process.env.DB_NAME || 'inspeccion',
  password: process.env.DB_PASSWORD || 'farenet2026**',
  port: process.env.DB_PORT || 5432,
});

async function main() {
    const db = require('./config/database.js');
    db.connect = async () => pool.connect();
    
    try {
        const payload = {
            codigo: '8081',
            nombre: 'CERTIFICADO NUEVO 808',
            categoria_id: 31,
            tipo_flujo: 'TALLER_INSPECCION',
            requiere_certificado: true,
            tipo_certificado_clave: 'TALLER_INSPECCION', // Invalid key sent by frontend
            modalidad: null,
            formato_id: 1, // Will assume 1 for test
            requiere_vehiculo: true,
            orden: 0
        };

        const nuevoServicio = await configService.crearServicio(payload, 'test_user', '127.0.0.1');
        console.log("Servicio Guardado:", nuevoServicio);

        const tarifaPayload = {
            planta_key: '201',
            servicio_id: nuevoServicio.id,
            producto_facturacion_id: 2203, // Product ID for 8081 based on previous query
            precio: 80,
            activo: true
        };

        const nuevaTarifa = await tarifaService.crear(tarifaPayload, 'test_user', '127.0.0.1');
        console.log("Tarifa Guardada:", nuevaTarifa);

        // Verification query
        const check = await pool.query(`
            SELECT s.codigo, s.nombre, s.tipo_flujo, s.formato_id, t.planta_key, t.precio, p.codigo_sku
            FROM fg_servicio s
            JOIN fg_tarifa t ON t.servicio_id = s.id
            JOIN fg_producto_facturacion p ON p.id = t.producto_facturacion_id
            WHERE s.id = $1
        `, [nuevoServicio.id]);
        
        console.log("Verificación Final:", check.rows[0]);

        // Cleanup rollback
        await pool.query('DELETE FROM fg_tarifa WHERE servicio_id = $1', [nuevoServicio.id]);
        await pool.query('DELETE FROM fg_servicio WHERE id = $1', [nuevoServicio.id]);

    } catch (err) {
        console.error("ERROR:", err.message);
    } finally {
        pool.end();
    }
}
main();
