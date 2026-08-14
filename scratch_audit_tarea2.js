require('dotenv').config({ path: '.env', override: true });
process.env.PORT = '3002';
process.env.AUTH_DISABLED = 'true';
const db = require('./config/database');
const app = require('./app');

async function apiRequest(method, path, body = null, token = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const res = await fetch(`http://localhost:3002${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    
    return {
        status: res.status,
        body: await res.json().catch(() => ({}))
    };
}

async function generateToken() {
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';
    return jwt.sign({ 
        username: 'gibarra', 
        perfil_id: 'SISTEMAS',
        planta_key: '201',
        faregas_flow: 'authenticated'
    }, secret, { expiresIn: '1h' });
}

async function runTest() {
    await new Promise(r => setTimeout(r, 1000));
    let testCertId = null;
    let titular1Id = null;
    let titular2Id = null;
    let clienteId = null;

    try {
        console.log("=== INICIANDO PRUEBAS DE TAREA 2 ===");
        const token = await generateToken();
        const headers = { 'Authorization': `Bearer ${token}` };

        // 1. Snapshot inicial de DB
        const resInspeccion = await db.query("SELECT count(*) as count FROM inspeccion");
        const countInspeccionAntes = parseInt(resInspeccion.rows[0].count);
        
        const resCorrelativo = await db.query("SELECT nro_actual FROM fg_correlativo_certificado LIMIT 1");
        const correlativoAntes = resCorrelativo.rows.length > 0 ? parseInt(resCorrelativo.rows[0].nro_actual) : 0;

        // 2. Crear Borrador Temporal
        const resBorrador = await apiRequest('POST', '/api/faregas/certificados/borradores', { tipoCertificadoClave: 'GLP_ANUAL' }, token);
        
        if (!resBorrador.body.ok) throw new Error("No se pudo crear borrador: " + JSON.stringify(resBorrador.body));
        testCertId = resBorrador.body.data.id;
        console.log(`✅ Borrador temporal creado: ${testCertId}`);

        // 3. Prueba Vehículo (Placa Encontrada simulada) + VIN/CHASIS independientes
        const payloadVehiculo = {
            placa: 'TEST-123',
            categoria: 'M1',
            clase: 'SEDAN',
            marca: 'TOYOTA',
            modelo: 'COROLLA',
            anioFabricacion: '2020',
            anioModelo: '2021',
            vin: 'VIN-TEST-001',
            serieChasis: 'CHASIS-TEST-002',
            numeroMotor: 'MOTOR-003',
            numeroCilindros: '4',
            cilindrada: '1600',
            potencia: '100',
            formulaRodante: '4X2'
        };

        const resVeh = await apiRequest('PUT', `/api/faregas/certificados/borradores/${testCertId}/vehiculo`, payloadVehiculo, token);
        
        if (!resVeh.body.ok) throw new Error("Fallo al guardar vehiculo: " + JSON.stringify(resVeh.body));

        // Verificar BD
        let dbVeh = await db.query("SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1", [testCertId]);
        if (dbVeh.rows.length !== 1) throw new Error("Error: fg_certificado_vehiculo tiene " + dbVeh.rows.length + " filas.");
        if (dbVeh.rows[0].vin !== 'VIN-TEST-001' || dbVeh.rows[0].serie_chasis !== 'CHASIS-TEST-002') {
            throw new Error("VIN o CHASIS no se guardaron independientes!");
        }
        console.log("✅ Snapshot vehículo insertado correctamente (1 fila). VIN y CHASIS son independientes.");

        // 4. Actualizar Snapshot (Mismo Certificado)
        const payloadVehiculoUpdate = { ...payloadVehiculo, color: 'ROJO' };
        await apiRequest('PUT', `/api/faregas/certificados/borradores/${testCertId}/vehiculo`, payloadVehiculoUpdate, token);
        
        dbVeh = await db.query("SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1", [testCertId]);
        if (dbVeh.rows.length !== 1) throw new Error("Error: Se duplicó el registro de vehículo al actualizar.");
        if (dbVeh.rows[0].color !== 'ROJO') throw new Error("No se actualizó el color");
        console.log("✅ Snapshot vehículo actualizado correctamente sin duplicar fila.");

        // 5. Cliente Manual (POST)
        const payloadCliente = {
            tipoDocumento: 'DNI',
            nroDocumento: '00000000',
            nombreRazonSocial: 'CLIENTE PRUEBA MANUAL'
        };
        const resCliente = await apiRequest('POST', '/api/faregas/clientes', payloadCliente, token);
        
        if (!resCliente.body.ok) throw new Error("Error creando cliente");
        clienteId = resCliente.body.data.id;
        console.log(`✅ Cliente FAREGAS manual creado con ID: ${clienteId}`);

        // 6. Titular 1 (POST)
        const resTitular1 = await apiRequest('POST', `/api/faregas/certificados/borradores/${testCertId}/titulares`, {
            orden: 1,
            clienteId: clienteId,
            tipoDocumento: 'DNI',
            nroDocumento: '00000000',
            nombreRazonSocial: 'TITULAR 1',
            direccion: 'DIR 1'
        }, token);
        
        if (!resTitular1.body.ok) throw new Error("Error creando titular 1");
        titular1Id = resTitular1.body.data.id;
        console.log(`✅ Titular 1 creado con ID: ${titular1Id}`);

        // 7. Titular 2 (POST)
        const resTitular2 = await apiRequest('POST', `/api/faregas/certificados/borradores/${testCertId}/titulares`, {
            orden: 2,
            clienteId: null,
            tipoDocumento: 'DNI',
            nroDocumento: '11111111',
            nombreRazonSocial: 'TITULAR 2',
            direccion: 'DIR 2'
        }, token);
        
        if (!resTitular2.body.ok) throw new Error("Error creando titular 2");
        titular2Id = resTitular2.body.data.id;
        console.log(`✅ Titular 2 creado con ID: ${titular2Id}`);

        let dbTitulares = await db.query("SELECT * FROM fg_certificado_titular WHERE certificado_id = $1 ORDER BY orden ASC", [testCertId]);
        if (dbTitulares.rows.length !== 2) throw new Error("Error: Deben haber 2 titulares");
        console.log("✅ Dos titulares insertados correctamente.");

        // 8. Reintento sin duplicar (Simulado PATCH sobre Titular 1)
        const resTitular1Patch = await apiRequest('PATCH', `/api/faregas/certificados/borradores/${testCertId}/titulares/${titular1Id}`, {
            orden: 1,
            tipoDocumento: 'DNI',
            nroDocumento: '00000000',
            nombreRazonSocial: 'TITULAR 1 MODIFICADO',
            direccion: 'DIR 1 MOD'
        }, token);
        
        if (!resTitular1Patch.body.ok) throw new Error("Error actualizando titular 1");
        
        dbTitulares = await db.query("SELECT * FROM fg_certificado_titular WHERE certificado_id = $1 ORDER BY orden ASC", [testCertId]);
        if (dbTitulares.rows.length !== 2) throw new Error("Error: Se duplicó el titular en el PATCH");
        if (dbTitulares.rows[0].nombre_razon_social !== 'TITULAR 1 MODIFICADO') throw new Error("No se actualizó el snapshot");
        
        // Verificar que fg_cliente NO se modificó mágicamente
        const dbCli = await db.query("SELECT nombre_razon_social FROM fg_cliente WHERE id = $1", [clienteId]);
        if (dbCli.rows[0].nombre_razon_social === 'TITULAR 1 MODIFICADO') throw new Error("PELIGRO: fg_cliente se actualizó automáticamente al editar snapshot");
        console.log("✅ Titular 1 editado (PATCH) sin duplicar filas y SIN modificar fg_cliente.");

        // 9. Eliminar Titular Persistido (DELETE)
        const resTitular2Del = await apiRequest('DELETE', `/api/faregas/certificados/borradores/${testCertId}/titulares/${titular2Id}`, null, token);
        
        if (!resTitular2Del.body.ok) throw new Error("Error eliminando titular 2");
        
        dbTitulares = await db.query("SELECT * FROM fg_certificado_titular WHERE certificado_id = $1", [testCertId]);
        if (dbTitulares.rows.length !== 1) throw new Error("Error: Titular 2 no fue eliminado de BD");
        console.log("✅ Titular 2 eliminado exitosamente (DELETE).");

        // 10. Validaciones Globales
        const dbCert = await db.query("SELECT * FROM fg_certificado WHERE id = $1", [testCertId]);
        if (dbCert.rows[0].estado !== 'BORRADOR') throw new Error("El estado no es BORRADOR");
        if (dbCert.rows[0].numero_certificado !== null) throw new Error("numero_certificado no es NULL");
        console.log("✅ Certificado mantiene estado BORRADOR y numero NULL.");

        const resCorrelativoFinal = await db.query("SELECT nro_actual FROM fg_correlativo_certificado LIMIT 1");
        const correlativoFinal = resCorrelativoFinal.rows.length > 0 ? parseInt(resCorrelativoFinal.rows[0].nro_actual) : 0;
        if (correlativoFinal !== correlativoAntes) throw new Error("Se alteró el correlativo");
        console.log("✅ Correlativos sin cambios.");

        const resInspeccionFinal = await db.query("SELECT count(*) as count FROM inspeccion");
        if (parseInt(resInspeccionFinal.rows[0].count) !== countInspeccionAntes) throw new Error("Se insertó en FARENET");
        console.log("✅ 0 inserciones en FARENET (inspeccion).");

    } catch (e) {
        console.error("❌ FALLO LA PRUEBA:", e.message);
    } finally {
        console.log("=== CLEANUP ===");
        if (testCertId) {
            await db.query("DELETE FROM fg_certificado_titular WHERE certificado_id = $1", [testCertId]);
            await db.query("DELETE FROM fg_certificado_vehiculo WHERE certificado_id = $1", [testCertId]);
            await db.query("DELETE FROM fg_certificado WHERE id = $1", [testCertId]);
            console.log(`🧹 Certificado temporal ${testCertId} eliminado.`);
        }
        if (clienteId) {
            await db.query("DELETE FROM fg_cliente WHERE id = $1", [clienteId]);
            console.log(`🧹 Cliente temporal ${clienteId} eliminado.`);
        }
        process.exit(0);
    }
}

// mock app listen workaround
if (require.main === module) {
    runTest();
}
