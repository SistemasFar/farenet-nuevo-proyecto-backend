const db = require('./config/database');

async function run() {
    try {
        await db.query('BEGIN');

        // 1. Crear fg_venta
        await db.query(`
            CREATE TABLE IF NOT EXISTS fg_venta (
                id BIGSERIAL PRIMARY KEY,
                planta_key VARCHAR(50) NOT NULL,
                cliente_tipo_documento VARCHAR(20) NOT NULL,
                cliente_nro_documento VARCHAR(20) NOT NULL,
                cliente_nombre VARCHAR(255) NOT NULL,
                cliente_direccion VARCHAR(255),
                cliente_email VARCHAR(255),
                base_imponible NUMERIC(10, 2) NOT NULL,
                igv NUMERIC(10, 2) NOT NULL,
                importe_total NUMERIC(10, 2) NOT NULL,
                estado VARCHAR(50) DEFAULT 'COMPLETADO',
                creado_por VARCHAR(100),
                creado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. Crear fg_venta_detalle
        await db.query(`
            CREATE TABLE IF NOT EXISTS fg_venta_detalle (
                id BIGSERIAL PRIMARY KEY,
                venta_id BIGINT NOT NULL REFERENCES fg_venta(id) ON DELETE CASCADE,
                chip_id BIGINT NOT NULL REFERENCES fg_chip(id),
                producto_inventariable_id BIGINT NOT NULL REFERENCES fg_producto_inventariable(id),
                precio_unitario NUMERIC(10, 2) NOT NULL,
                cantidad INT DEFAULT 1,
                total NUMERIC(10, 2) NOT NULL
            )
        `);

        // 3. Modificar fg_facturacion
        // Drop NOT NULL from certificado_id
        await db.query(`ALTER TABLE fg_facturacion ALTER COLUMN certificado_id DROP NOT NULL`);
        
        // Add venta_id column if not exists
        const checkVentaCol = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='fg_facturacion' AND column_name='venta_id'
        `);
        
        if (checkVentaCol.rowCount === 0) {
            await db.query(`ALTER TABLE fg_facturacion ADD COLUMN venta_id BIGINT REFERENCES fg_venta(id)`);
        }

        await db.query('COMMIT');
        console.log('Migración exitosa: tablas creadas y alteradas.');
    } catch (e) {
        await db.query('ROLLBACK');
        console.error('Error en migración:', e);
    } finally {
        process.exit(0);
    }
}

run();
