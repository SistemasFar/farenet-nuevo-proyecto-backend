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
const token = jwt.sign({ username: 'grodas', faregas_flow: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });

async function runTests() {
    console.log("Iniciando pruebas...");
    
    let createdIds = [];

    let pRes = await db.query("SELECT key FROM fg_planta LIMIT 1");
    let planta = pRes.rows[0].key;
    
    // 1. GET tipos
    const res1 = await request(app).get('/api/faregas/certificados/tipos').set('Authorization', 'Bearer ' + token);
    console.log("1. GET tipos:", res1.statusCode === 200 && res1.body.data.length === 3 ? "OK" : "ERROR");
    
    // 2. GET correlativos
    const res2 = await request(app).get('/api/faregas/certificados/correlativos').set('Authorization', 'Bearer ' + token);
    console.log("2. GET correlativos:", res2.statusCode === 200 ? "OK" : "ERROR");
    
    // 3. GET rango activo inexistente
    const res3 = await request(app).get('/api/faregas/certificados/correlativos/'+planta+'/GNV_ANUAL').set('Authorization', 'Bearer ' + token);
    console.log("3. GET rango activo (inexistente asume vacio):", res3.statusCode === 404 || res3.statusCode === 200 ? "OK" : "ERROR");
    
    // 4. POST con planta inexistente
    const res4 = await request(app).post('/api/faregas/certificados/correlativos').set('Authorization', 'Bearer ' + token).send({
        plantaKey: '999999', tipoCertificadoClave: 'GNV_ANUAL', nroInicio: 1, nroMaximo: 100
    });
    console.log("4. POST planta inexistente:", res4.statusCode === 404 ? "OK" : "ERROR");
    
    // 5. POST con tipo inexistente
    const res5 = await request(app).post('/api/faregas/certificados/correlativos').set('Authorization', 'Bearer ' + token).send({
        plantaKey: planta, tipoCertificadoClave: 'TIPO_INVENTADO', nroInicio: 1, nroMaximo: 100
    });
    console.log("5. POST tipo inexistente:", res5.statusCode === 404 ? "OK" : "ERROR");
    
    // 6. POST con inicio > maximo
    const res6 = await request(app).post('/api/faregas/certificados/correlativos').set('Authorization', 'Bearer ' + token).send({
        plantaKey: planta, tipoCertificadoClave: 'GNV_ANUAL', nroInicio: 100, nroMaximo: 50
    });
    console.log("6. POST inicio > maximo:", res6.statusCode === 400 ? "OK" : "ERROR");
    
    // 7. POST válido temporal
    const res7 = await request(app).post('/api/faregas/certificados/correlativos').set('Authorization', 'Bearer ' + token).send({
        plantaKey: planta, tipoCertificadoClave: 'GNV_ANUAL', nroInicio: 101, nroMaximo: 200
    });
    console.log("7. POST válido temporal:", res7.statusCode === 201 ? "OK" : "ERROR");
    let rangoId = null;
    if (res7.body.data && res7.body.data.id) {
        rangoId = res7.body.data.id;
        createdIds.push(rangoId);
    }
    
    // 8. Segundo rango activo misma planta/tipo
    const res8 = await request(app).post('/api/faregas/certificados/correlativos').set('Authorization', 'Bearer ' + token).send({
        plantaKey: planta, tipoCertificadoClave: 'GNV_ANUAL', nroInicio: 201, nroMaximo: 300
    });
    console.log("8. Segundo rango activo:", res8.statusCode === 409 ? "OK" : "ERROR");
    if (res8.body.data && res8.body.data.id) createdIds.push(res8.body.data.id);
    
    // 10. Cerrar rango
    let res10 = null;
    if (rangoId) {
        res10 = await request(app).patch('/api/faregas/certificados/correlativos/'+rangoId+'/cerrar').set('Authorization', 'Bearer ' + token);
        console.log("10. Cerrar rango:", res10.statusCode === 200 ? "OK" : "ERROR");
    }
    
    // 9. Rango solapado
    const res9 = await request(app).post('/api/faregas/certificados/correlativos').set('Authorization', 'Bearer ' + token).send({
        plantaKey: planta, tipoCertificadoClave: 'GNV_ANUAL', nroInicio: 150, nroMaximo: 250
    });
    console.log("9. Rango solapado:", res9.statusCode === 409 ? "OK" : "ERROR");
    if (res9.body.data && res9.body.data.id) createdIds.push(res9.body.data.id);
    
    // 11. Histórico
    if (rangoId) {
        const res11 = await request(app).get('/api/faregas/certificados/correlativos').set('Authorization', 'Bearer ' + token);
        const hist = res11.body.data.find(x => x.id === rangoId);
        console.log("11. Histórico existe tras cierre:", res11.statusCode === 200 && hist && hist.activo === false && hist.fechaCierre !== null ? "OK" : "ERROR");
    }
    
    // 12. Limpiar
    if (createdIds.length > 0) {
        await db.query("DELETE FROM fg_correlativo_certificado WHERE id = ANY($1)", [createdIds]);
        console.log("12. Limpieza completada. Registros eliminados: " + createdIds.length);
    } else {
        console.log("12. Limpieza completada. Ningun registro temporal creado.");
    }

    process.exit(0);
}
runTests();
