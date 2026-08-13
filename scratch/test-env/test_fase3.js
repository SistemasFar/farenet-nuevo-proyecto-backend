const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());
require('dotenv').config({ path: '../../.env' });

const db = require('../../config/database');
const routes = require('../../modules/faregas/routes/faregas-certificados.routes');

app.use('/api/faregas/certificados', routes);

const JWT_SECRET = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';

const tokenSistemas = jwt.sign({ username: 'grodas', perfil_id: 'SISTEMAS', planta_key: 'TEST_P1', faregas_flow: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
const tokenVilla = jwt.sign({ username: 'test_villa', perfil_id: 'JEFE_PLANTA', planta_key: 'TEST_P2', faregas_flow: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });

async function runTests() {
    console.log("Iniciando pruebas Fase 3...");
    
    // Preparar plantas
    await db.query(`INSERT INTO fg_planta (key, nombre) VALUES ('TEST_P1', 'Planta 1') ON CONFLICT (key) DO NOTHING`);
    await db.query(`INSERT INTO fg_planta (key, nombre) VALUES ('TEST_P2', 'Planta 2') ON CONFLICT (key) DO NOTHING`);
    await db.query(`INSERT INTO fg_perfil (clave, nombre) VALUES ('JEFE_PLANTA', 'Jefe de Planta') ON CONFLICT (clave) DO NOTHING`);

    await db.query(`INSERT INTO fg_usuario (username, contrasenha, perfil_id, estado, user_type) VALUES ('test_villa', '123', 'SISTEMAS', true, 'LOCAL') ON CONFLICT (username) DO NOTHING`);
    await db.query(`INSERT INTO fg_usuario (username, contrasenha, perfil_id, estado, user_type) VALUES ('grodas', '123', 'SISTEMAS', true, 'LOCAL') ON CONFLICT (username) DO NOTHING`);

    let createdCertIds = [];
    
    // 1. Crear borrador GLP
    const res1 = await request(app).post('/api/faregas/certificados/borradores')
        .set('Authorization', 'Bearer ' + tokenSistemas)
        .send({ tipoCertificadoClave: 'GLP_ANUAL', observaciones: 'Test fase 3' });
    
    console.log("1. Crear borrador GLP:", res1.statusCode === 201 ? "OK" : "ERROR", res1.body);
    let certId = 0;
    if (res1.statusCode === 201) {
        certId = res1.body.data.id;
        createdCertIds.push(certId);
    }
    
    // Validar NULLs
    const dbCheck = await db.query('SELECT numero_certificado, fecha_emision FROM fg_certificado WHERE id = $1', [certId]);
    console.log("-> numero_certificado NULL:", dbCheck.rows[0].numero_certificado === null ? "OK" : "ERROR");
    console.log("-> fecha_emision NULL:", dbCheck.rows[0].fecha_emision === null ? "OK" : "ERROR");

    // 2. Crear borrador con tipo inexistente -> error
    const res2 = await request(app).post('/api/faregas/certificados/borradores')
        .set('Authorization', 'Bearer ' + tokenSistemas)
        .send({ tipoCertificadoClave: 'NO_EXISTE' });
    console.log("2. Tipo inexistente:", res2.statusCode === 404 ? "OK" : "ERROR");

    // 3. Crear borrador con cliente inexistente -> error
    const res3 = await request(app).post('/api/faregas/certificados/borradores')
        .set('Authorization', 'Bearer ' + tokenSistemas)
        .send({ tipoCertificadoClave: 'GLP_ANUAL', clienteId: 999999 });
    console.log("3. Cliente inexistente:", res3.statusCode === 404 ? "OK" : "ERROR");

    // 4. GET borrador recién creado
    const res4 = await request(app).get('/api/faregas/certificados/borradores/' + certId)
        .set('Authorization', 'Bearer ' + tokenSistemas);
    console.log("4. GET borrador:", res4.statusCode === 200 && res4.body.data.vehiculo === null && res4.body.data.titulares.length === 0 ? "OK" : "ERROR");

    // 5. Guardar snapshot vehicular
    const res5 = await request(app).put('/api/faregas/certificados/borradores/' + certId + '/vehiculo')
        .set('Authorization', 'Bearer ' + tokenSistemas)
        .send({ placa: 'TEST99', version: 'v1.0', vin: 'VIN123', cilindrada: 1000, potencia: '100HP', formulaRodante: '4x2', serieChasis: 'CHASIS123' });
    console.log("5. Guardar snapshot vehicular:", res5.statusCode === 200 ? "OK" : "ERROR");

    // 6. GET borrador para ver snapshot
    const res6 = await request(app).get('/api/faregas/certificados/borradores/' + certId)
        .set('Authorization', 'Bearer ' + tokenSistemas);
    console.log("6. GET borrador vehiculo:", res6.body.data.vehiculo.placa === 'TEST99' ? "OK" : "ERROR");

    // 8. Validar campos adicionales persisten y se separan VIN y chasis
    const veh = res6.body.data.vehiculo;
    console.log("8. Campos adicionales y VIN/Chasis persistencia:", (veh.version === 'v1.0' && veh.vin === 'VIN123' && veh.serie_chasis === 'CHASIS123') ? "OK" : "ERROR");

    // 9. Agregar titular 1
    const res9 = await request(app).post('/api/faregas/certificados/borradores/' + certId + '/titulares')
        .set('Authorization', 'Bearer ' + tokenSistemas)
        .send({ orden: 1, nombreRazonSocial: 'Titular 1' });
    console.log("9. Agregar titular 1:", res9.statusCode === 201 ? "OK" : "ERROR");
    let tit1Id = res9.body.data.id;

    // 10. Agregar titular 2
    const res10 = await request(app).post('/api/faregas/certificados/borradores/' + certId + '/titulares')
        .set('Authorization', 'Bearer ' + tokenSistemas)
        .send({ orden: 2, nombreRazonSocial: 'Titular 2' });
    console.log("10. Agregar titular 2:", res10.statusCode === 201 ? "OK" : "ERROR");
    
    // 11. GET borrador -> 2 titulares
    const res11 = await request(app).get('/api/faregas/certificados/borradores/' + certId)
        .set('Authorization', 'Bearer ' + tokenSistemas);
    console.log("11. GET titulares (2):", res11.body.data.titulares.length === 2 ? "OK" : "ERROR");

    // 12. Repetir orden -> conflicto
    const res12 = await request(app).post('/api/faregas/certificados/borradores/' + certId + '/titulares')
        .set('Authorization', 'Bearer ' + tokenSistemas)
        .send({ orden: 1, nombreRazonSocial: 'Titular Duplicado' });
    console.log("12. Repetir orden titular:", res12.statusCode === 409 ? "OK" : "ERROR");

    // 13. Actualizar titular
    const res13 = await request(app).patch('/api/faregas/certificados/borradores/' + certId + '/titulares/' + tit1Id)
        .set('Authorization', 'Bearer ' + tokenSistemas)
        .send({ nombreRazonSocial: 'Titular 1 Modificado' });
    console.log("13. Actualizar titular:", res13.statusCode === 200 ? "OK" : "ERROR");

    // 14. Quitar titular
    const res14 = await request(app).delete('/api/faregas/certificados/borradores/' + certId + '/titulares/' + tit1Id)
        .set('Authorization', 'Bearer ' + tokenSistemas);
    console.log("14. Quitar titular:", res14.statusCode === 200 ? "OK" : "ERROR");

    // 15. Actualizar cabecera
    const res15 = await request(app).patch('/api/faregas/certificados/borradores/' + certId)
        .set('Authorization', 'Bearer ' + tokenSistemas)
        .send({ observaciones: 'Obs modificada' });
    console.log("15. Actualizar cabecera:", res15.statusCode === 200 ? "OK" : "ERROR");

    // Prueba Seguridad: Intentar acceder desde usuario sin privilegios a planta SURQUILLO
    // test_villa es JEFE_PLANTA y no le dimos acceso a SURQUILLO explícitamente en la bd
    // Para asegurar que falla, le quitamos 'SISTEMAS'
    await db.query("UPDATE fg_usuario SET perfil_id = 'JEFE_PLANTA' WHERE username = 'test_villa'");
    const resSec = await request(app).get('/api/faregas/certificados/borradores/' + certId)
        .set('Authorization', 'Bearer ' + tokenVilla);
    console.log("18. Seguridad cross-planta (debería fallar):", resSec.statusCode === 403 ? "OK" : "ERROR (fue " + resSec.statusCode + ")");

    // Limpiar tests
    if (createdCertIds.length > 0) {
        await db.query("DELETE FROM fg_certificado WHERE id = ANY($1)", [createdCertIds]);
        console.log("Limpieza completada. Registros temporales eliminados:", createdCertIds.length);
    }
    
    process.exit(0);
}
runTests();
