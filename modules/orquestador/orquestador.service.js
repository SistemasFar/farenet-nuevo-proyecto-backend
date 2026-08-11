const db = require('../../config/database');
const bcrypt = require('bcryptjs');

const normalizarTexto = (valor) => {
    return String(valor || '').trim();
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

exports.validarFarenetReadOnly = async (username, password) => {
    const cleanUsername = normalizarTexto(username);
    const cleanPassword = normalizarTexto(password);

    const query = `
        SELECT 
            username, 
            contrasenha, 
            perfil_id, 
            estado, 
            user_type
        FROM usuario
        WHERE TRIM(username) = $1 
        LIMIT 1
    `;
    const result = await db.query(query, [cleanUsername]);
    const user = result.rows[0];

    if (!user) {
        return { valido: false };
    }

    if (user.estado !== true) {
        return { valido: false };
    }

    const isMatch = validarPassword(cleanPassword, user.contrasenha);
    
    if (isMatch) {
        return {
            valido: true,
            user: {
                username: user.username,
                perfil_id: user.perfil_id,
                estado: user.estado,
                user_type: user.user_type
            }
        };
    }
    
    return { valido: false };
};
