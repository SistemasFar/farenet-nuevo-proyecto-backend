const db = require('../config/database');
const bcrypt = require('bcryptjs');

const normalizarTexto = (valor) => {
    return String(valor || '').trim();
};

const generarTokenMock = () => {
    return "JWT_ACCESS_TOKEN_GENERADO_MOCK_FARENET_" + Date.now();
};

const obtenerUsuarioPorUsername = async (username) => {
    const cleanUsername = normalizarTexto(username);

    const query = `
        SELECT 
            u.username, 
            u.contrasenha, 
            u.perfil_id, 
            u.persona_nrodocumentoidentidad, 
            u.estado, 
            u.user_type,
            TRIM(COALESCE(p.apellidos, '') || ' ' || COALESCE(p.nombres, '')) AS nombre_completo
        FROM usuario u
        LEFT JOIN persona p ON u.persona_nrodocumentoidentidad = p.nrodocumentoidentidad
        WHERE TRIM(u.username) = $1 
        LIMIT 1
    `;

    const result = await db.query(query, [cleanUsername]);
    return result.rows[0];
};

const obtenerPermisosBasePorPerfil = async (perfilId) => {
    const cleanPerfilId = normalizarTexto(perfilId);

    const query = `
        SELECT DISTINCT TRIM(roles_clave) AS permiso_clave
        FROM perfil_rol
        WHERE TRIM(perfil_clave) = $1
        ORDER BY TRIM(roles_clave)
    `;

    const result = await db.query(query, [cleanPerfilId]);

    return result.rows
        .map((row) => row.permiso_clave)
        .filter(Boolean);
};



const obtenerPermisosPorUsuario = async (username) => {
    const user = await obtenerUsuarioPorUsername(username);

    if (!user) {
        throw new Error("Usuario no encontrado en el sistema.");
    }

    const permisosBase = await obtenerPermisosBasePorPerfil(user.perfil_id);
    return permisosBase.sort();
};

const validarPassword = (passwordPlano, hashBD) => {
    const cleanPassword = normalizarTexto(passwordPlano);
    const cleanHash = normalizarTexto(hashBD);

    if (
        cleanHash.startsWith('$2a$') ||
        cleanHash.startsWith('$2b$') ||
        cleanHash.startsWith('$2y$')
    ) {
        return bcrypt.compareSync(cleanPassword, cleanHash);
    }

    return cleanPassword === cleanHash;
};

const authenticateUser = async (username, password) => {
    const cleanUsername = normalizarTexto(username);
    const cleanPassword = normalizarTexto(password);

    console.log("\n🔍 ========================================================");
    console.log("🕵️‍♂️ [AUDITORÍA DE AUTENTICACIÓN]");
    console.log("-> Usuario recibido:", cleanUsername);
    console.log("-> Password length:", cleanPassword.length);
    console.log("========================================================");

    const user = await obtenerUsuarioPorUsername(cleanUsername);

    if (!user) {
        throw new Error("Usuario no encontrado en el sistema.");
    }

    const isMatch = validarPassword(cleanPassword, user.contrasenha);

    if (!isMatch) {
        throw new Error("La contraseña ingresada no coincide con el registro.");
    }

    if (user.estado === false || user.estado === 'false' || user.estado === 0) {
        throw new Error("El usuario se encuentra inactivo.");
    }

    const permisos = await obtenerPermisosPorUsuario(cleanUsername);

    // Regla de Negocio Temporal: 
    // - Sistemas tiene acceso a FARENET y FAREGAS
    // - Los demás perfiles solo tienen acceso a FARENET
    const perfil = String(user.perfil_id || '').toLowerCase().trim();
    const userType = String(user.user_type || '').toLowerCase().trim();
    
    const esSistemas = (perfil === 'sistemas' || perfil === 'administrador' || userType === 'sistemas');

    const empresas = [
        { key: 'FARENET', nombre: 'FARENET S.A.C.' }
    ];

    if (esSistemas) {
        empresas.push({ key: 'FAREGAS', nombre: 'FAREGAS S.A.C.' });
    }

    return {
        token: generarTokenMock(),
        user: {
            username: normalizarTexto(user.username),
            perfil_id: user.perfil_id,
            persona_nrodocumentoidentidad: user.persona_nrodocumentoidentidad,
            estado: user.estado,
            user_type: user.user_type
        },
        permisos,
        empresas
    };
};

const actualizarContrasena = async (username, currentPassword, newPassword) => {
    const cleanUsername = normalizarTexto(username);
    const user = await obtenerUsuarioPorUsername(cleanUsername);

    if (!user) {
        throw new Error("Usuario no encontrado en el sistema.");
    }

    const isMatch = validarPassword(currentPassword, user.contrasenha);
    if (!isMatch) {
        throw new Error("La contraseña actual es incorrecta.");
    }

    const newHash = bcrypt.hashSync(normalizarTexto(newPassword), 10);
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const resFarenet = await client.query(
            `UPDATE usuario SET contrasenha = $1 WHERE TRIM(username) = $2`,
            [newHash, cleanUsername]
        );

        if (resFarenet.rowCount === 0) {
            throw new Error("Usuario no encontrado en el sistema.");
        }

        await client.query(
            `UPDATE fg_usuario SET contrasenha = $1 WHERE username = $2`,
            [newHash, cleanUsername]
        );

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    authenticateUser,
    obtenerUsuarioPorUsername,
    obtenerPermisosPorUsuario,
    obtenerPermisosBasePorPerfil,
    actualizarContrasena
};