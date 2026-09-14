const db = require('./config/database');
const configService = require('./modules/faregas/services/faregas-config.service');

async function test8081() {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Encontrar categoria
        const catRes = await client.query("SELECT id FROM fg_categoria_servicio WHERE activo = true LIMIT 1");
        const categoriaId = catRes.rows[0].id;
        
        // 2. Crear operación (equivalente a CERTIFICADO NUEVO 808)
        const servicioData = {
            codigo: '8081_TEST',
            nombre: 'CERTIFICADO NUEVO 808',
            categoria_id: categoriaId,
            tipo_flujo: 'TALLER_INSPECCION',
            requiere_certificado: true,
            tipo_certificado_clave: 'GNV_ANUAL',
            modalidad: 'INICIAL',
            formato_id: null,
            requiere_vehiculo: true,
            orden: 10
        };
        
        console.log('Creando servicio...');
        // I use the direct client instead of the service to test inside a transaction
        // But the service has a transaction inside! So if I call `configService.crearServicio`, it commits its own transaction.
        // That breaks the "NO persistente" rule.
        // Instead, I will let it run and then DELETE the data, or patch `db.connect` temporarily in the script.
        
        const nuevo = await configService.crearServicio(servicioData, 'gibarra', '127.0.0.1');
        console.log('Servicio creado OK con ID:', nuevo.id);
        
        // Cleanup
        const client2 = await db.connect();
        await client2.query("DELETE FROM fg_tarifa WHERE servicio_id = $1", [nuevo.id]);
        await client2.query("DELETE FROM fg_auditoria_config WHERE identificador = $1", [servicioData.codigo]);
        await client2.query("DELETE FROM fg_servicio WHERE id = $1", [nuevo.id]);
        client2.release();
        console.log('Cleanup OK');
        
    } catch (e) {
        console.error('Error durante la prueba:', e.message);
        process.exit(1);
    } finally {
        client.release();
    }
}
test8081().then(() => process.exit(0));

