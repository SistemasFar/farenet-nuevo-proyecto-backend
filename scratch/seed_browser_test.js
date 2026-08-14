const pool = require('../config/database');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function createTempDraft() {
    let client = await pool.connect();
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
        
        await client.query(`DELETE FROM fg_correlativo_certificado WHERE planta_key = $1 AND tipo_certificado_clave = 'CONFORMIDAD'`, [user.planta_key]);

        // 1. Crear Rango temporal para CONFORMIDAD (39)
        const resRango = await client.query(`
            INSERT INTO fg_correlativo_certificado 
            (planta_key, tipo_certificado_clave, nro_inicio, nro_actual, nro_maximo, activo)
            VALUES ($1, 'CONFORMIDAD', 9001, 9000, 9002, true)
            RETURNING id
        `, [user.planta_key]);
        const rangoId = resRango.rows[0].id;

        // Draft Válido CONFORMIDAD
        const resDraft = await client.query(`
            INSERT INTO fg_certificado (estado, planta_key, tipo_certificado_clave, usuario_creacion)
            VALUES ('BORRADOR', $1, 'CONFORMIDAD', $2) RETURNING id
        `, [user.planta_key, user.username]);
        const idValido = resDraft.rows[0].id;
        
        await client.query(`
            INSERT INTO fg_certificado_vehiculo (certificado_id, placa, categoria, marca, modelo, version, anio_fabricacion, numero_motor, numero_cilindros, cilindrada, combustible, numero_ejes, numero_ruedas, numero_asientos, numero_pasajeros, longitud, ancho, alto, color, peso_neto, peso_bruto, vin) 
            VALUES ($1, 'ABC-123', 'M1', 'TOYOTA', 'COROLLA', 'LE', '2020', 'MOT123', 4, 1500, 'GASOLINA', 2, 4, 5, 4, 4.5, 1.8, 1.5, 'ROJO', 1200, 1600, 'VIN123456789')
        `, [idValido]);
        await client.query(`
            INSERT INTO fg_certificado_titular (certificado_id, orden, tipo_documento, nro_documento, nombre_razon_social, direccion) 
            VALUES ($1, 1, 'DNI', '12345678', 'JUAN PEREZ', 'AV. LIMA 123')
        `, [idValido]);
        await client.query(`
            INSERT INTO fg_certificado_conformidad (certificado_id, tipo_conformidad, motivo)
            VALUES ($1, 'MONTAJE', 'MOTIVO DE PRUEBA')
        `, [idValido]);

        // Draft Inválido
        const resDraftInv = await client.query(`
            INSERT INTO fg_certificado (estado, planta_key, tipo_certificado_clave, usuario_creacion)
            VALUES ('BORRADOR', $1, 'CONFORMIDAD', $2) RETURNING id
        `, [user.planta_key, user.username]);
        const idInvalido = resDraftInv.rows[0].id;
        // Sólo vehículo parcial
        await client.query(`
            INSERT INTO fg_certificado_vehiculo (certificado_id, placa, categoria) 
            VALUES ($1, 'DEF-456', 'M1')
        `, [idInvalido]);

        console.log("SUCCESS:");
        console.log(JSON.stringify({ rangoId, idValido, idInvalido }));

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        client.release();
        pool.end();
    }
}
createTempDraft();
