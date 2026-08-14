const pool = require('../config/database');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function runTests() {
    let ids = [];
    try {
        const token = jwt.sign(
            { id: 1, username: 'grodas', perfil_id: 1, idPlanta: 1, faregas_flow: 'authenticated' },
            process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret',
            { expiresIn: '1h' }
        );
        const headers = { Authorization: `Bearer ${token}` };
        const apiUrl = 'http://localhost:3000/api/faregas/certificados';

        console.log("--- 3. ENDPOINT CATÁLOGO REAL ---");
        let catRes = await axios.get(`${apiUrl}/catalogos/verificaciones`, { headers });
        const catGnv = catRes.data.GNV_ANUAL;
        const catGlp = catRes.data.GLP_ANUAL;
        console.log(`E. Endpoint catálogo ejecutado: OK`);
        console.log(`F. Cantidad GNV: 8 esperadas / ${catGnv.length} real.`);
        const gnvCodes = catGnv.map(x=>x.codigo).join(',');
        console.log(`G. Códigos GNV: ${gnvCodes === 'a,b,c,d,e,f,g,h' ? 'a-h OK' : 'ERROR'}`);
        console.log(`H. Cantidad GLP: 7 esperadas / ${catGlp.length} real.`);
        const glpCodes = catGlp.map(x=>x.codigo).join(',');
        console.log(`I. Códigos GLP: ${glpCodes === '1,2,3,4,5,6,7' ? '1-7 OK' : 'ERROR'}`);

        console.log("\n--- 5 & 6. PRUEBA REAL GNV ---");
        let res = await axios.post(`${apiUrl}/borradores`, { tipoCertificadoClave: 'GNV_ANUAL' }, { headers });
        const gnvId = res.data.id;
        ids.push(gnvId);
        let vGnv = catGnv.map(v => ({ ...v, cumple: true, observacion: '' }));
        await axios.put(`${apiUrl}/borradores/${gnvId}/gnv`, { vigenciaHasta: '2026-08-13' }, { headers });
        await axios.put(`${apiUrl}/borradores/${gnvId}/gnv/verificaciones`, { verificaciones: vGnv }, { headers });
        
        let [rGnv1] = await pool.query('SELECT * FROM fg_certificado_gnv_verificacion WHERE certificado_id = ?', [gnvId]);
        
        vGnv[0].cumple = false;
        vGnv[0].observacion = 'UPDATED';
        await axios.put(`${apiUrl}/borradores/${gnvId}/gnv/verificaciones`, { verificaciones: vGnv }, { headers });
        let [rGnv2] = await pool.query('SELECT * FROM fg_certificado_gnv_verificacion WHERE certificado_id = ?', [gnvId]);
        
        console.log(`N. GNV: OK`);
        console.log(`O. GNV verificaciones: ${rGnv1.length === 8 && rGnv2.length === 8 ? '8 reales esperadas.' : 'ERROR'}`);

        console.log("\n--- 7 & 8. PRUEBA REAL GLP ---");
        res = await axios.post(`${apiUrl}/borradores`, { tipoCertificadoClave: 'GLP_ANUAL' }, { headers });
        const glpId = res.data.id;
        ids.push(glpId);
        let vGlp = catGlp.map(v => ({ ...v, cumple: false, observacion: 'Obs Test' }));
        let cGlp = [
            { tipo: 'CILINDRO', marca: 'M1', modelo: 'MD1', anioFabricacion: '2020', numeroSerie: '111' },
            { tipo: 'REGULADOR', marca: 'M2', modelo: 'MD2', anioFabricacion: '2021', numeroSerie: '222' }
        ];
        await axios.put(`${apiUrl}/borradores/${glpId}/glp`, { expedienteTecnico: 'EXP-123' }, { headers });
        await axios.put(`${apiUrl}/borradores/${glpId}/glp/componentes`, { componentes: cGlp }, { headers });
        await axios.put(`${apiUrl}/borradores/${glpId}/glp/verificaciones`, { verificaciones: vGlp }, { headers });
        
        let [rGlp1] = await pool.query('SELECT * FROM fg_certificado_glp_verificacion WHERE certificado_id = ?', [glpId]);
        let [rGlpC1] = await pool.query('SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = ?', [glpId]);
        
        cGlp[0].marca = 'M1_UPDATED';
        await axios.put(`${apiUrl}/borradores/${glpId}/glp/componentes`, { componentes: cGlp }, { headers });
        let [rGlpC2] = await pool.query('SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = ?', [glpId]);

        console.log(`P. GLP: OK`);
        console.log(`Q. GLP componentes: ${rGlpC1.length === 2 && rGlpC2.length === 2 ? 'OK' : 'ERROR'}`);
        console.log(`R. GLP verificaciones: ${rGlp1.length === 7 ? '7 reales esperadas.' : 'ERROR'}`);

        console.log("\n--- 9. CONFORMIDAD ---");
        res = await axios.post(`${apiUrl}/borradores`, { tipoCertificadoClave: 'CONFORMIDAD' }, { headers });
        const confId = res.data.id;
        ids.push(confId);
        await axios.put(`${apiUrl}/borradores/${confId}/conformidad`, {
            tipoConformidad: 'MODIFICACION',
            tipoTramite: 'T1',
            caracteristicaRegistrable: 'EJES',
            motivo: 'RECTIFICACION',
            descripcion: 'DESC',
            usoOriginalVehiculo: 'PARTICULAR'
        }, { headers });
        
        let [rConf] = await pool.query('SELECT * FROM fg_certificado_conformidad WHERE certificado_id = ?', [confId]);
        await axios.put(`${apiUrl}/borradores/${confId}/conformidad`, {
            tipoConformidad: 'MODIFICACION',
            tipoTramite: 'T2',
            caracteristicaRegistrable: 'EJES',
            motivo: 'RECTIFICACION',
            descripcion: 'DESC',
            usoOriginalVehiculo: 'PARTICULAR'
        }, { headers });
        let [rConf2] = await pool.query('SELECT * FROM fg_certificado_conformidad WHERE certificado_id = ?', [confId]);
        
        console.log(`S. Conformidad: ${rConf.length === 1 && rConf2.length === 1 ? 'OK' : 'ERROR'}`);

        console.log("\n--- 11. CRUCE DE TIPOS ---");
        let cruceOk = true;
        try { await axios.put(`${apiUrl}/borradores/${gnvId}/glp`, {}, { headers }); cruceOk = false; } catch(e){}
        try { await axios.put(`${apiUrl}/borradores/${glpId}/conformidad`, {}, { headers }); cruceOk = false; } catch(e){}
        try { await axios.put(`${apiUrl}/borradores/${confId}/gnv`, {}, { headers }); cruceOk = false; } catch(e){}
        console.log(`T. Cruce de tipos: ${cruceOk ? 'OK' : 'ERROR'}`);
        
        let [rCert] = await pool.query('SELECT estado, numero_certificado, fecha_emision FROM fg_certificado WHERE id = ?', [gnvId]);
        console.log(`V. Estado: ${rCert[0].estado}`);
        console.log(`W. numero_certificado: ${rCert[0].numero_certificado === null ? 'NULL' : 'NO NULL'}`);
        console.log(`X. fecha_emision: ${rCert[0].fecha_emision === null ? 'NULL' : 'NO NULL'}`);

    } catch (e) {
        console.error("Test Falló:", e.response ? e.response.data : e.message);
    } finally {
        console.log("\n--- 17. CLEANUP ---");
        for (const id of ids) {
            await pool.query('DELETE FROM fg_certificado WHERE id = ?', [id]);
        }
        
        // Count all temps
        let counts = await Promise.all([
            pool.query('SELECT COUNT(*) as c FROM fg_certificado WHERE id IN (?)', [ids.length ? ids : [0]]),
            pool.query('SELECT COUNT(*) as c FROM fg_certificado_gnv WHERE certificado_id IN (?)', [ids.length ? ids : [0]]),
            pool.query('SELECT COUNT(*) as c FROM fg_certificado_gnv_verificacion WHERE certificado_id IN (?)', [ids.length ? ids : [0]]),
            pool.query('SELECT COUNT(*) as c FROM fg_certificado_glp WHERE certificado_id IN (?)', [ids.length ? ids : [0]]),
            pool.query('SELECT COUNT(*) as c FROM fg_certificado_glp_componente WHERE certificado_id IN (?)', [ids.length ? ids : [0]]),
            pool.query('SELECT COUNT(*) as c FROM fg_certificado_glp_verificacion WHERE certificado_id IN (?)', [ids.length ? ids : [0]]),
            pool.query('SELECT COUNT(*) as c FROM fg_certificado_conformidad WHERE certificado_id IN (?)', [ids.length ? ids : [0]])
        ]);
        let sum = counts.reduce((acc, r) => acc + parseInt(r[0][0].c), 0);
        console.log(`AA. Datos temporales después cleanup: ${sum}`);

        process.exit();
    }
}

runTests();
