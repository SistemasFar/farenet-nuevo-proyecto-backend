const db = require('../config/database');

// 1. Busca las credenciales usando 'perfil_id' mapeado con 'p.clave'
const findByUsername = async (username) => {
    const query = `
        SELECT 
            u.username, 
            u.contrasenha, 
            u.estado, 
            u.perfil_id,
            u.persona_nrodocumentoidentidad,
            u.firmacertificador,
            u.foto,
            u.user_type,
            p.nombre AS perfil_nombre
        FROM usuario u
        LEFT JOIN perfil p ON u.perfil_id = p.clave  -- 🎯 CORREGIDO: En Farenet se usa 'p.clave'
        WHERE u.username = $1;
    `;
    const result = await db.query(query, [username]);
    return result.rows[0]; 
};

// 2. Trae la lista de permisos mapeando la tabla intermedia por 'perfil_clave'
const getPermisosByPerfil = async (perfilId) => {
    // Intentamos primero con perfil_clave que es el estándar del script de C#
    const query = `
        SELECT roles_clave 
        FROM perfil_rol 
        WHERE perfil_clave = $1;
    `;
    try {
        const result = await db.query(query, [perfilId]);
        return result.rows.map(row => row.roles_clave); // Array de strings
    } catch (error) {
        // Backup por si acaso la tabla intermedia use la columna 'perfil_id'
        const queryBackup = `
            SELECT roles_clave 
            FROM perfil_rol 
            WHERE perfil_id = $1;
        `;
        const resultBackup = await db.query(queryBackup, [perfilId]);
        return resultBackup.rows.map(row => row.roles_clave);
    }
};

module.exports = {
    findByUsername,
    getPermisosByPerfil
};