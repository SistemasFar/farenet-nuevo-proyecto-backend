const db = require('./config/database');

async function run() {
    try {
        await db.query('BEGIN');

        // 1. Drop NOT NULL from certificado_id
        await db.query(`ALTER TABLE fg_orden_pago ALTER COLUMN certificado_id DROP NOT NULL`);

        // 2. Add venta_id column if not exists
        const checkVentaCol = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='fg_orden_pago' AND column_name='venta_id'
        `);
        
        if (checkVentaCol.rowCount === 0) {
            await db.query(`ALTER TABLE fg_orden_pago ADD COLUMN venta_id BIGINT REFERENCES fg_venta(id)`);
        }

        await db.query('COMMIT');
        console.log('Migración exitosa para fg_orden_pago.');
    } catch (e) {
        await db.query('ROLLBACK');
        console.error('Error en migración fg_orden_pago:', e);
    } finally {
        process.exit(0);
    }
}

run();
