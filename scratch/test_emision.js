const axios = require('axios');
const pool = require('../config/database');
const { emitirCertificado } = require('../modules/faregas/services/faregas-certificados.service');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function runTests() {
    let client = await pool.connect();
    let tempDrafts = [];
    let tempRanges = [];
    
    try {
        const secret = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';
        
        const resUser = await client.query(`
            SELECT u.username, u.perfil_id, up.plantas_key as planta_key
            FROM fg_usuario u
            JOIN fg_usuario_planta up ON u.username = up.usuario_username
            WHERE u.estado = true
            LIMIT 1
        `);
        const user = resUser.rows[0];
        
        const userContext = {
            username: user.username,
            perfil_id: user.perfil_id,
            planta_key: user.planta_key
        };

        // 1. Crear Rango temporal para GNV (22)
        const resRango = await client.query(`
            INSERT INTO fg_correlativo_certificado 
            (planta_key, tipo_certificado_clave, nro_inicio, nro_actual, nro_maximo, activo)
            VALUES ($1, 'GNV_ANUAL', 1001, 1000, 1002, true)
            RETURNING id
        `, [user.planta_key]);
        tempRanges.push(resRango.rows[0].id);

        const crearDraft = async () => {
            const resDraft = await client.query(`
                INSERT INTO fg_certificado (estado, planta_key, tipo_certificado_clave, usuario_creacion)
                VALUES ('BORRADOR', $1, 'GNV_ANUAL', $2) RETURNING id
            `, [user.planta_key, user.username]);
            const id = resDraft.rows[0].id;
            tempDrafts.push(id);
            await client.query(`
                INSERT INTO fg_certificado_vehiculo (certificado_id, placa, categoria, marca, modelo, version, anio_fabricacion, numero_motor, numero_cilindros, cilindrada, combustible, numero_ejes, numero_ruedas, numero_asientos, numero_pasajeros, longitud, ancho, alto, color, peso_neto, peso_bruto, vin) 
                VALUES ($1, 'ABC-123', 'M1', 'TOYOTA', 'COROLLA', 'LE', '2020', 'MOT123', 4, 1500, 'GASOLINA', 2, 4, 5, 4, 4.5, 1.8, 1.5, 'ROJO', 1200, 1600, 'VIN123456789')
            `, [id]);
            await client.query(`
                INSERT INTO fg_certificado_gnv (certificado_id, taller_autorizado_id, vigencia_hasta) VALUES ($1, 1, '2025-12-31')
            `, [id]);
            const codigos = ['a','b','c','d','e','f','g','h'];
            for(let i=0; i<8; i++){
                await client.query(`
                    INSERT INTO fg_certificado_gnv_verificacion (certificado_id, codigo, orden, cumple) VALUES ($1, $2, $3, true)
                `, [id, codigos[i], i+1]);
            }
            return id;
        };

        const draft1 = await crearDraft();
        const draft2 = await crearDraft();
        const draft3 = await crearDraft();

        // TEST F: Doble request mismo certificado
        console.log('Simulando Doble request...');
        const p1 = emitirCertificado(draft1, userContext);
        const p2 = emitirCertificado(draft1, userContext);
        const resAll = await Promise.allSettled([p1, p2]);
        
        let exitoF = 0, rechazoF = 0;
        resAll.forEach(r => { if(r.status === 'fulfilled') exitoF++; else rechazoF++; });
        console.assert(exitoF === 1 && rechazoF === 1, 'Falla en doble request concurrency');
        
        // Verifica q tiene DG-22-0001001
        const verify1 = await client.query('SELECT numero_certificado, estado FROM fg_certificado WHERE id = $1', [draft1]);
        console.assert(verify1.rows[0].numero_certificado === 'DG-22-0001001', 'Falla en formato 1001');
        console.assert(verify1.rows[0].estado === 'EMITIDO', 'Falla en estado final');

        // TEST B/C: ultimo numero
        console.log('Emitiendo draft 2...');
        const resDraft2 = await emitirCertificado(draft2, userContext);
        console.assert(resDraft2.numero_certificado === 'DG-22-0001002', 'Falla en formato 1002');
        
        // El rango era max 1002. Ahora debe estar agotado.
        console.log('Emitiendo draft 3 (Debe fallar agotado)...');
        try {
            await emitirCertificado(draft3, userContext);
            console.error('Test C falló, debió agotar');
        } catch(e) {
            console.assert(e.message === 'RANGO_AGOTADO', 'Test C: error incorrecto');
        }

        console.log('Todos los tests de emisión pasaron.');

    } catch (e) {
        console.error('Error durante pruebas:', e.message);
    } finally {
        if(tempDrafts.length > 0) {
            await client.query('DELETE FROM fg_certificado_gnv_verificacion WHERE certificado_id = ANY($1)', [tempDrafts]);
            await client.query('DELETE FROM fg_certificado_gnv WHERE certificado_id = ANY($1)', [tempDrafts]);
            await client.query('DELETE FROM fg_certificado_vehiculo WHERE certificado_id = ANY($1)', [tempDrafts]);
            await client.query('DELETE FROM fg_certificado WHERE id = ANY($1)', [tempDrafts]);
            console.log(`Cleanup: eliminados ${tempDrafts.length} borradores temporales.`);
        }
        if(tempRanges.length > 0) {
            await client.query('DELETE FROM fg_correlativo_certificado WHERE id = ANY($1)', [tempRanges]);
            console.log(`Cleanup: eliminados ${tempRanges.length} rangos temporales.`);
        }
        client.release();
        pool.end();
    }
}
runTests();
