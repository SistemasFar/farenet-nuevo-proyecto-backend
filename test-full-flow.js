const db = require('./config/database');
const configService = require('./modules/faregas/services/faregas-config.service');

async function runTest() {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Obtener categoria
        const catRes = await client.query("SELECT id FROM fg_categoria_servicio WHERE activo = true LIMIT 1");
        const categoriaId = catRes.rows[0].id;

        // 2. Obtener producto fiscal de la categoria (o simular si hay FK suelta)
        // Insertaremos un producto mock
        const prodRes = await client.query(`
            INSERT INTO fg_producto_facturacion 
            (codigo_sku, descripcion, categoria_id, es_para_venta, tipo_afectacion_igv, unidad, activo)
            VALUES ('TEST_8081', 'TEST PRODUCTO', $1, true, '10', 'NIU', true)
            RETURNING id
        `, [categoriaId]);
        const productoId = prodRes.rows[0].id;
        
        // 3. Obtener sede INDEPENDENCIA (o cualquiera)
        const sedeRes = await client.query("SELECT key FROM fg_planta WHERE activo = true LIMIT 1");
        const sedeKey = sedeRes.rows[0].key;

        // 4. Configurar operacion
        const servicioData = {
            codigo: 'TEST_OP_8081',
            nombre: 'CERTIFICADO TEST NUEVO',
            categoria_id: categoriaId,
            tipo_flujo: 'TALLER_INSPECCION',
            requiere_certificado: true,
            tipo_certificado_clave: 'GNV_ANUAL',
            modalidad: 'INICIAL',
            formato_id: null,
            requiere_vehiculo: true,
            orden: 10,
            tarifas: {
                [sedeKey]: {
                    seleccionada: true,
                    productoId: String(productoId),
                    precioReferencial: 80
                }
            }
        };

        // Service runs its own transaction, which will commit. So we cannot just rollback at the end.
        // We will call service and manually delete everything.
        const nuevo = await configService.crearServicio(servicioData, 'gibarra', '127.0.0.1');
        
        // 5. Consultar
        const resServicio = await client.query("SELECT * FROM fg_servicio WHERE id = $1", [nuevo.id]);
        const resTarifa = await client.query("SELECT * FROM fg_tarifa WHERE servicio_id = $1", [nuevo.id]);
        
        const s = resServicio.rows[0];
        const t = resTarifa.rows[0];
        
        console.log('--- TEST RESULTS ---');
        console.log('categoria_id:', s.categoria_id === categoriaId ? 'OK' : 'FAIL');
        console.log('operación:', s.codigo === 'TEST_OP_8081' ? 'OK' : 'FAIL');
        console.log('tipo certificado:', s.tipo_certificado_clave === 'GNV_ANUAL' ? 'OK' : 'FAIL');
        console.log('modalidad:', s.modalidad === 'INICIAL' ? 'OK' : 'FAIL');
        console.log('sede:', t.planta_key === sedeKey ? 'OK' : 'FAIL');
        console.log('producto:', t.producto_facturacion_id === productoId ? 'OK' : 'FAIL');
        console.log('precio:', Number(t.precio) === 80 ? 'OK' : 'FAIL');
        console.log('--------------------');
        
        // Cleanup
        await client.query("DELETE FROM fg_tarifa WHERE servicio_id = $1", [nuevo.id]);
        await client.query("DELETE FROM fg_auditoria_config WHERE identificador = $1", [s.codigo]);
        await client.query("DELETE FROM fg_servicio WHERE id = $1", [nuevo.id]);
        await client.query("DELETE FROM fg_producto_facturacion WHERE id = $1", [productoId]);
        
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('ERROR:', e);
    } finally {
        client.release();
    }
}
runTest().then(() => process.exit(0));


