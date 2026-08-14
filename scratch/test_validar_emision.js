const axios = require('axios');
const pool = require('../config/database');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function runTests() {
    let client = await pool.connect();
    let tempIds = [];
    try {
        const secret = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';
        
        const resUser = await client.query(`
            SELECT u.username, u.perfil_id, up.plantas_key as planta_key
            FROM fg_usuario u
            JOIN fg_usuario_planta up ON u.username = up.usuario_username
            WHERE u.estado = true AND up.estado = true
            LIMIT 1
        `);
        if(resUser.rowCount === 0) throw new Error('No user found');
        const user = resUser.rows[0];

        const token = jwt.sign({
            username: user.username,
            perfil_id: user.perfil_id,
            planta_key: user.planta_key,
            faregas_flow: 'authenticated'
        }, secret, { expiresIn: '1h' });

        const api = axios.create({
            baseURL: 'http://localhost:3000/api/faregas/certificados',
            headers: { Authorization: `Bearer ${token}` }
        });

        // Test 1: GNV Incompleto (sin vehiculo)
        const resGnvIncompleto = await api.post('/borradores', { tipoCertificadoClave: 'GNV_ANUAL' });
        const idGnvInc = resGnvIncompleto.data.id;
        tempIds.push(idGnvInc);
        const val1 = await api.get(`/borradores/${idGnvInc}/validar-emision`);
        console.assert(val1.data.data.valido === false, 'Test 1 falló');
        console.assert(val1.data.data.errores.some(e => e.campo === 'general' && e.seccion === 'vehiculo'), 'Test 1 falló veh');

        // Test 2: GNV Completo
        const resGnvComp = await api.post('/borradores', { tipoCertificadoClave: 'GNV_ANUAL' });
        const idGnvComp = resGnvComp.data.id;
        tempIds.push(idGnvComp);
        
        await client.query(`
            INSERT INTO fg_certificado_vehiculo (
                certificado_id, placa, categoria, marca, modelo, version, anio_fabricacion, 
                numero_motor, numero_cilindros, cilindrada, combustible, numero_ejes, 
                numero_ruedas, numero_asientos, numero_pasajeros, longitud, ancho, alto, 
                color, peso_neto, peso_bruto, vin
            ) VALUES (
                $1, 'ABC-123', 'M1', 'TOYOTA', 'COROLLA', 'LE', '2020',
                'MOT123', 4, 1500, 'GASOLINA', 2,
                4, 5, 4, 4.5, 1.8, 1.5,
                'ROJO', 1200, 1600, 'VIN123456789'
            )
        `, [idGnvComp]);

        await client.query(`
            INSERT INTO fg_certificado_gnv (certificado_id, taller_autorizado_id, vigencia_hasta) 
            VALUES ($1, 1, '2025-12-31')
        `, [idGnvComp]);

        const codigosGNV = ['a','b','c','d','e','f','g','h'];
        for(let i=0; i<8; i++){
            await client.query(`
                INSERT INTO fg_certificado_gnv_verificacion (certificado_id, codigo, orden, cumple)
                VALUES ($1, $2, $3, true)
            `, [idGnvComp, codigosGNV[i], i+1]);
        }

        const val2 = await api.get(`/borradores/${idGnvComp}/validar-emision`);
        console.assert(val2.data.data.valido === true, 'Test 2 falló', val2.data.data.errores);

        // Test 3: GLP Incompleto (sin titulares, sin componentes)
        const resGlpInc = await api.post('/borradores', { tipoCertificadoClave: 'GLP_ANUAL' });
        const idGlpInc = resGlpInc.data.id;
        tempIds.push(idGlpInc);
        const val3 = await api.get(`/borradores/${idGlpInc}/validar-emision`);
        console.assert(val3.data.data.valido === false, 'Test 3 falló');
        console.assert(val3.data.data.errores.some(e => e.seccion === 'titular'), 'Test 3 falló titular');

        console.log('Todos los tests pasaron.');

    } catch (e) {
        console.error('Error durante pruebas:', e.response?.data || e.message);
    } finally {
        if(tempIds.length > 0) {
            await client.query('DELETE FROM fg_certificado WHERE id = ANY($1)', [tempIds]);
            console.log(`Cleanup: eliminados ${tempIds.length} borradores temporales.`);
        }
        client.release();
        pool.end();
    }
}
runTests();
