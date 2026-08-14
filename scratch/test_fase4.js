require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT)
});

const jwt = require('jsonwebtoken');
const JWT_SECRET_FAREGAS = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';

const token = jwt.sign(
    { 
        username: 'gibarra', 
        faregas_flow: 'authenticated',
        perfil_id: 'SISTEMAS',
        planta_key: '201' // Ate
    }, 
    JWT_SECRET_FAREGAS, 
    { expiresIn: '1h' }
);

const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
};

const BASE_URL = 'http://localhost:3001/api/faregas/certificados';

async function testSuite() {
    process.env.PORT = '3001';
    const app = require('../app');
    // We will let app.js bind to 3001 automatically
    // Just need to wait a tiny bit to make sure server is up
    await new Promise(r => setTimeout(r, 1000));

    let gnvId, glpId, confId;
    try {
        console.log('--- CREANDO CERTIFICADOS TEMPORALES ---');
        
        // fetch wrapper
        const fetchReq = async (url, options) => {
            const http = require('http');
            return new Promise((resolve, reject) => {
                const req = http.request(url, options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        try {
                            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, json: () => JSON.parse(data) });
                        } catch(e) {
                            resolve({ ok: false, json: () => data });
                        }
                    });
                });
                req.on('error', reject);
                if (options.body) req.write(options.body);
                req.end();
            });
        };

        // Crear GNV
        let r = await fetchReq(`${BASE_URL}/borradores`, { method: 'POST', headers, body: JSON.stringify({ tipoCertificadoClave: 'GNV_ANUAL' }) });
        let res = await r.json();
        if (!res.ok) console.log(res);
        gnvId = res.data.id;
        console.log(`GNV creado: ${gnvId}`);

        // Crear GLP
        r = await fetchReq(`${BASE_URL}/borradores`, { method: 'POST', headers, body: JSON.stringify({ tipoCertificadoClave: 'GLP_ANUAL' }) });
        res = await r.json();
        glpId = res.data.id;
        console.log(`GLP creado: ${glpId}`);

        // Crear CONFORMIDAD
        r = await fetchReq(`${BASE_URL}/borradores`, { method: 'POST', headers, body: JSON.stringify({ tipoCertificadoClave: 'CONFORMIDAD' }) });
        res = await r.json();
        confId = res.data.id;
        console.log(`CONFORMIDAD creado: ${confId}`);

        console.log('\n--- PRUEBAS GNV ---');
        r = await fetchReq(`${BASE_URL}/borradores/${gnvId}/gnv`, { method: 'PUT', headers, body: JSON.stringify({ vigenciaHasta: '2027-01-01' }) });
        console.log('Guardar GNV:', await r.json());

        r = await fetchReq(`${BASE_URL}/borradores/${gnvId}/gnv/verificaciones`, {
            method: 'PUT', headers, body: JSON.stringify({
                verificaciones: [ { codigo: 'V01', orden: 1, descripcion: 'Prueba 1', cumple: true, observacion: 'Ok' } ]
            })
        });
        console.log('Guardar Verificaciones GNV:', await r.json());

        r = await fetchReq(`${BASE_URL}/borradores/${gnvId}/gnv`, { method: 'GET', headers });
        let gnvDataObj = await r.json();
        console.log('Obtener GNV OK:', gnvDataObj.ok);
        // Let's get the core cert data from another endpoint or from DB to prove it:
        const { rows: certGnv } = await pool.query('SELECT estado, numero_certificado, fecha_emision FROM fg_certificado WHERE id = $1', [gnvId]);
        console.log(`Estado: ${certGnv[0].estado}, Num: ${certGnv[0].numero_certificado}, Emision: ${certGnv[0].fecha_emision}`);

        r = await fetchReq(`${BASE_URL}/borradores/${gnvId}/glp`, { method: 'PUT', headers, body: JSON.stringify({ expedienteTecnico: 'EXP-123' }) });
        const crossRes = await r.json();
        console.log('Guardar GLP sobre GNV (Rechazado esperado):', !crossRes.ok && crossRes.message.includes('TIPO_CERTIFICADO_INCORRECTO'));

        console.log('\n--- PRUEBAS GLP ---');
        r = await fetchReq(`${BASE_URL}/borradores/${glpId}/glp`, { method: 'PUT', headers, body: JSON.stringify({ expedienteTecnico: 'EXP-GLP' }) });
        console.log('Guardar GLP:', await r.json());

        r = await fetchReq(`${BASE_URL}/borradores/${glpId}/glp/componentes`, {
            method: 'PUT', headers, body: JSON.stringify({
                componentes: [
                    { orden: 1, componente: 'Tanque', marca: 'BRC', capacidadLitros: 50 },
                    { orden: 2, componente: 'Reductor', marca: 'Tomasetto' }
                ]
            })
        });
        console.log('Guardar Componentes GLP:', await r.json());

        r = await fetchReq(`${BASE_URL}/borradores/${glpId}/glp`, { method: 'GET', headers });
        const glpData = await r.json();
        console.log('Obtener GLP OK:', glpData.ok);
        console.log('Componentes recuperados:', glpData.data.componentes.length);

        console.log('\n--- PRUEBAS CONFORMIDAD ---');
        r = await fetchReq(`${BASE_URL}/borradores/${confId}/conformidad`, { method: 'PUT', headers, body: JSON.stringify({ tipoConformidad: 'MODIFICACION', motivo: 'Prueba' }) });
        console.log('Guardar Conformidad:', await r.json());

        r = await fetchReq(`${BASE_URL}/borradores/${confId}/conformidad`, { method: 'GET', headers });
        console.log('Obtener Conformidad OK:', (await r.json()).ok);

        r = await fetchReq(`${BASE_URL}/borradores/${confId}/glp`, { method: 'PUT', headers, body: JSON.stringify({ expedienteTecnico: 'EXP-123' }) });
        const crossRes2 = await r.json();
        console.log('Guardar GLP sobre CONFORMIDAD (Rechazado esperado):', !crossRes2.ok && crossRes2.message.includes('TIPO_CERTIFICADO_INCORRECTO'));

    } catch (e) {
        console.error(e);
    } finally {
        console.log('\n--- LIMPIEZA ---');
        if (gnvId) await pool.query('DELETE FROM fg_certificado WHERE id = $1', [gnvId]);
        if (glpId) await pool.query('DELETE FROM fg_certificado WHERE id = $1', [glpId]);
        if (confId) await pool.query('DELETE FROM fg_certificado WHERE id = $1', [confId]);
        console.log('Registros temporales limpiados.');
        await pool.end();
        process.exit(0);
    }
}

testSuite();
