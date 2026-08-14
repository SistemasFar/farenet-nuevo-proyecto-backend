const pool = require('../config/database');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function runTests() {
    let ids = [];
    try {
        const secret = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';
        
        // Find a user and their profile/planta to generate a valid token
        const resUser = await pool.query(`
            SELECT u.username, u.perfil_id, up.plantas_key as planta_key 
            FROM fg_usuario u
            JOIN fg_usuario_planta up ON u.username = up.usuario_username
            WHERE u.estado = true
            LIMIT 1
        `);
        if (resUser.rowCount === 0) throw new Error("No hay usuarios activos con planta");
        const user = resUser.rows[0];
        
        const token = jwt.sign(
            { 
                username: user.username,
                perfil_id: user.perfil_id,
                planta_key: user.planta_key,
                faregas_flow: 'authenticated'
            },
            secret,
            { expiresIn: '1h' }
        );
        const headers = { Authorization: `Bearer ${token}` };
        const apiUrl = 'http://localhost:3000/api/faregas/certificados';

        console.log("--- TEST NULL, TRUE, FALSE (GNV) ---");
        let res = await axios.post(`${apiUrl}/borradores`, { tipoCertificadoClave: 'GNV_ANUAL' }, { headers });
        const gnvId = res.data.data.id;
        ids.push(gnvId);
        
        let catRes = await axios.get(`${apiUrl}/catalogos/verificaciones`, { headers });
        let vGnv = catRes.data.GNV_ANUAL.map((v, i) => ({ 
            ...v, 
            cumple: i === 0 ? null : (i === 1 ? true : false),
            observacion: i === 1 ? '' : 'Obs Test'
        }));
        
        await axios.put(`${apiUrl}/borradores/${gnvId}/gnv`, { vigenciaHasta: '2026-10-10' }, { headers });
        await axios.put(`${apiUrl}/borradores/${gnvId}/gnv/verificaciones`, { verificaciones: vGnv }, { headers });
        
        let rGnv1 = (await pool.query('SELECT cumple, observacion FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1 ORDER BY orden', [gnvId])).rows;
        console.log(`CASO A (NULL): BD=${rGnv1[0].cumple === null ? 'NULL' : 'ERROR'}`);
        console.log(`CASO B (TRUE): BD=${rGnv1[1].cumple === true ? 'TRUE' : 'ERROR'}`);
        console.log(`CASO C (FALSE): BD=${rGnv1[2].cumple === false ? 'FALSE' : 'ERROR'}`);

        console.log("\n--- TEST GLP ---");
        res = await axios.post(`${apiUrl}/borradores`, { tipoCertificadoClave: 'GLP_ANUAL' }, { headers });
        const glpId = res.data.data.id;
        ids.push(glpId);
        
        let vGlp = catRes.data.GLP_ANUAL.map(v => ({ ...v, cumple: null, observacion: '' }));
        let cGlp = [
            { componente: 'CILINDRO', marca: 'M1', modelo: 'MD1', anioFabricacion: '2020', numeroSerie: '111', orden: 1 },
            { componente: 'REGULADOR', marca: 'M2', modelo: 'MD2', anioFabricacion: '2021', numeroSerie: '222', orden: 2 }
        ];
        await axios.put(`${apiUrl}/borradores/${glpId}/glp`, { expedienteTecnico: 'EXP-123' }, { headers });
        await axios.put(`${apiUrl}/borradores/${glpId}/glp/componentes`, { componentes: cGlp }, { headers });
        await axios.put(`${apiUrl}/borradores/${glpId}/glp/verificaciones`, { verificaciones: vGlp }, { headers });
        
        let rGlp1 = (await pool.query('SELECT * FROM fg_certificado_glp_verificacion WHERE certificado_id = $1', [glpId])).rows;
        let rGlpC1 = (await pool.query('SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = $1', [glpId])).rows;
        
        console.log(`GLP Componentes: ${rGlpC1.length === 2 ? 'OK' : 'ERROR'}`);
        console.log(`GLP Verificaciones NULLs: ${rGlp1.every(v => v.cumple === null) ? 'OK' : 'ERROR'}`);
        
        console.log("\n--- CONFORMIDAD ---");
        res = await axios.post(`${apiUrl}/borradores`, { tipoCertificadoClave: 'CONFORMIDAD' }, { headers });
        const confId = res.data.data.id;
        ids.push(confId);
        await axios.put(`${apiUrl}/borradores/${confId}/conformidad`, {
            tipoConformidad: 'MODIFICACION',
            tipoTramite: 'T1',
            caracteristicaRegistrable: 'EJES',
            motivo: 'RECTIFICACION',
            descripcion: 'DESC',
            usoOriginalVehiculo: 'PARTICULAR'
        }, { headers });
        
        let rConf = (await pool.query('SELECT * FROM fg_certificado_conformidad WHERE certificado_id = $1', [confId])).rows;
        console.log(`Conformidad: ${rConf.length === 1 ? 'OK' : 'ERROR'}`);

        console.log("\n--- 11. CRUCE DE TIPOS ---");
        let cruceOk = true;
        try { await axios.put(`${apiUrl}/borradores/${gnvId}/glp`, {}, { headers }); cruceOk = false; } catch(e){}
        console.log(`Cruce bloqueado: ${cruceOk ? 'OK' : 'ERROR'}`);
        
        let rCert = (await pool.query('SELECT estado, numero_certificado, fecha_emision FROM fg_certificado WHERE id = $1', [gnvId])).rows;
        console.log(`Estado Cert: ${rCert[0].estado}, Num: ${rCert[0].numero_certificado === null ? 'NULL' : rCert[0].numero_certificado}`);

    } catch (e) {
        console.error("Test Falló:", e.response ? e.response.data : e.message);
    } finally {
        for (const id of ids) {
            await pool.query('DELETE FROM fg_certificado WHERE id = $1', [id]);
        }
        process.exit();
    }
}

runTests();
