const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());
require('dotenv').config({ path: '../../.env' });

const db = require('../../config/database');
const routes = require('../../modules/faregas/routes/faregas-clientes.routes');

app.use('/api/faregas/clientes', routes);

const JWT_SECRET = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';
const token = jwt.sign({ username: 'grodas', faregas_flow: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });

async function runTests() {
    console.log("Iniciando pruebas Fase 2...");
    
    let createdIds = [];
    
    // Obtener un documento que exista en FARENET para la prueba 4
    const pRes = await db.query("SELECT tipodocumentoidentidad_key, nrodocumentoidentidad FROM persona LIMIT 1");
    const docF = pRes.rows[0];

    // Obtener una placa que exista en FARENET y su motor para la prueba 10 y 13
    const vRes = await db.query("SELECT nroplacaantigua, nromotor FROM vehiculo WHERE nroplacaantigua IS NOT NULL AND TRIM(nroplacaantigua) <> '' AND nromotor IS NOT NULL LIMIT 1");
    const vehF = vRes.rows[0];

    // 1. Cliente FAREGAS inexistente (y 5. Documento inexistente)
    const res2 = await request(app).get('/api/faregas/clientes/documento/DNI/99999999999').set('Authorization', 'Bearer ' + token);
    console.log("2. Cliente FAREGAS inexistente:", res2.statusCode === 404 ? "OK" : "ERROR", res2.body);

    const res5 = await request(app).get('/api/faregas/clientes/autocompletar/DNI/99999999999').set('Authorization', 'Bearer ' + token);
    console.log("5. Documento inexistente autocompletar:", res5.statusCode === 404 ? "OK" : "ERROR", res5.body);

    // 6. Crear cliente
    const testDoc = 'TEST_DOC_123';
    const res6 = await request(app).post('/api/faregas/clientes').set('Authorization', 'Bearer ' + token).send({
        tipoDocumento: 'DNI',
        nroDocumento: testDoc,
        nombreRazonSocial: 'Juan Prueba',
        direccion: 'Av. Test',
        telefono: '123456',
        correo: 'test@test.com'
    });
    console.log("6. Crear cliente:", res6.statusCode === 201 ? "OK" : "ERROR", res6.body);
    if (res6.body.data && res6.body.data.id) {
        createdIds.push(res6.body.data.id);
    }
    const cId = res6.body.data ? res6.body.data.id : 0;

    // 1. Cliente FAREGAS existente
    const res1 = await request(app).get('/api/faregas/clientes/documento/DNI/'+testDoc).set('Authorization', 'Bearer ' + token);
    console.log("1. Cliente FAREGAS existente:", res1.statusCode === 200 ? "OK" : "ERROR");

    // 3. Autocompletar desde FAREGAS
    const res3 = await request(app).get('/api/faregas/clientes/autocompletar/DNI/'+testDoc).set('Authorization', 'Bearer ' + token);
    console.log("3. Autocompletar desde FAREGAS:", res3.statusCode === 200 && res3.body.data.origen === 'FAREGAS' ? "OK" : "ERROR");

    // 4. Autocompletar desde FARENET
    const res4 = await request(app).get('/api/faregas/clientes/autocompletar/'+docF.tipodocumentoidentidad_key+'/'+docF.nrodocumentoidentidad).set('Authorization', 'Bearer ' + token);
    console.log("4. Autocompletar desde FARENET:", res4.statusCode === 200 && res4.body.data.origen === 'FARENET' ? "OK" : "ERROR");

    // 7. Cliente duplicado -> 409
    const res7 = await request(app).post('/api/faregas/clientes').set('Authorization', 'Bearer ' + token).send({
        tipoDocumento: 'DNI', nroDocumento: testDoc, nombreRazonSocial: 'Duplicado'
    });
    console.log("7. Cliente duplicado -> 409:", res7.statusCode === 409 ? "OK" : "ERROR", res7.body);

    // 8. Actualizar cliente
    if (cId) {
        const res8 = await request(app).patch('/api/faregas/clientes/'+cId).set('Authorization', 'Bearer ' + token).send({
            nombreRazonSocial: 'Juan Modificado'
        });
        console.log("8. Actualizar cliente:", res8.statusCode === 200 ? "OK" : "ERROR", res8.body);
    }

    // 9. Cliente inexistente -> 404
    const res9 = await request(app).patch('/api/faregas/clientes/9999999').set('Authorization', 'Bearer ' + token).send({
        nombreRazonSocial: 'No existe'
    });
    console.log("9. Actualizar inexistente -> 404:", res9.statusCode === 404 ? "OK" : "ERROR", res9.body);

    // 10. Vehículo existente por PLACA
    // 12. Validar mapping vehicular (que tenga los nulls que indicamos y valores correctos)
    const placaReal = vehF.nroplacaantigua;
    const res10 = await request(app).get('/api/faregas/clientes/vehiculo/'+encodeURIComponent(placaReal)).set('Authorization', 'Bearer ' + token);
    const d10 = res10.body.data;
    console.log("10. Vehículo existente por placa:", res10.statusCode, res10.body);
    console.log("12. Mapping Vehicular:", (d10 && d10.vin === null && d10.serieChasis !== undefined && d10.placa.toLowerCase() === placaReal.toLowerCase()) ? "OK" : "ERROR");

    // 11. Vehículo inexistente -> 404
    const res11 = await request(app).get('/api/faregas/clientes/vehiculo/TEST999').set('Authorization', 'Bearer ' + token);
    console.log("11. Vehículo inexistente -> 404:", res11.statusCode === 404 ? "OK" : "ERROR", res11.body);

    // 13. Solo numero de motor -> 404 (probando que no busca por motor)
    const motorReal = vehF.nromotor;
    const res13 = await request(app).get('/api/faregas/clientes/vehiculo/'+encodeURIComponent(motorReal)).set('Authorization', 'Bearer ' + token);
    // Asumiendo que motorReal != placaReal
    if (motorReal !== placaReal) {
        console.log("13. Buscar por motor en vez de placa -> 404:", res13.statusCode === 404 ? "OK" : "ERROR (fue " + res13.statusCode + ")", res13.body);
    } else {
        console.log("13. Omitido porque motor == placa accidentalmente");
    }

    // Limpiar tests
    if (createdIds.length > 0) {
        await db.query("DELETE FROM fg_cliente WHERE id = ANY($1)", [createdIds]);
        console.log("Limpieza completada. Registros eliminados:", createdIds.length);
    }
    
    process.exit(0);
}
runTests();
