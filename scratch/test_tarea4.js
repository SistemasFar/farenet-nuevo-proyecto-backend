const pool = require('./config/database');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function runTest() {
    try {
        const secret = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';
        
        // 1. Obtener usuario
        const resUser = await pool.query(`
            SELECT u.username, u.perfil_id, up.planta_key 
            FROM fg_usuario u
            JOIN fg_usuario_planta up ON u.username = up.username
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

        console.log('Testing GET /borradores...');
        const apiRes = await axios.get('http://localhost:3000/api/faregas/certificados/borradores?page=1&pageSize=10', {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        console.log('Listado de borradores (OK):');
        console.log(apiRes.data);
    } catch(e) {
        console.error('Error:', e.response?.data || e.message);
    } finally {
        process.exit();
    }
}

runTest();
