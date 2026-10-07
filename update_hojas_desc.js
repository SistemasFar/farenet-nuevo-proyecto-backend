const db = require('./config/database');

async function main() {
    // Update product facturacion
    await db.query(`UPDATE fg_producto_facturacion SET descripcion = 'CERTIFICADO GLP - HOJAS' WHERE codigo_sku = '0130'`);
    await db.query(`UPDATE fg_producto_facturacion SET descripcion = 'CERTIFICADO CONFORMIDAD - HOJAS' WHERE codigo_sku = '0132'`);

    // Update snapshots in operations details
    await db.query(`UPDATE fg_operacion_detalle SET descripcion_snapshot = 'CERTIFICADO GLP - HOJAS' WHERE codigo_sku_snapshot = '0130'`);
    await db.query(`UPDATE fg_operacion_detalle SET descripcion_snapshot = 'CERTIFICADO CONFORMIDAD - HOJAS' WHERE codigo_sku_snapshot = '0132'`);

    console.log('Database updated successfully.');
    process.exit(0);
}

main().catch(console.error);
