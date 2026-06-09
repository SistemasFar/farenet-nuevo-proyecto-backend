const db = require('../config/database');
const bcrypt = require('bcryptjs');

/**
 * Servicio centralizado para autenticar credenciales contra PostgreSQL
 * @param {string} username
 * @param {string} password
 */
const authenticateUser = async (username, password) => {
    const cleanUsername = String(username || '').trim();
    const cleanPassword = String(password || '').trim();

    console.log("\n🔍 ========================================================");
    console.log("🕵️‍♂️ [AUDITORÍA DE AUTENTICACIÓN - ENTRADA EN SERVICIO]");
    console.log("-> Usuario recibido del Front:", cleanUsername);
    console.log("-> Password length:", cleanPassword.length);
    console.log("-> Clave plano recibida del Front:", cleanPassword ? "•••••••• (Texto enviado)" : "VACÍA");
    console.log("========================================================");

    const query = `
        SELECT 
            username, 
            contrasenha, 
            perfil_id, 
            persona_nrodocumentoidentidad, 
            estado, 
            user_type 
        FROM usuario 
        WHERE TRIM(username) = $1 
        LIMIT 1
    `;

    const result = await db.query(query, [cleanUsername]);
    const user = result.rows[0];

    if (!user) {
        console.log(`❌ [RESULTADO AUDITORÍA]: El usuario '${cleanUsername}' NO existe en la tabla 'usuario'.`);
        console.log("========================================================\n");
        throw new Error("Usuario no encontrado en el sistema.");
    }

    const hashBD = String(user.contrasenha || '').trim();

    console.log("✅ [USUARIO ENCONTRADO]: Registro recuperado con éxito.");
    console.log("-> Usuario BD:", user.username);
    console.log("-> Hash length:", hashBD.length);
    console.log("-> Hash inicia con:", hashBD.substring(0, 4));
    console.log("-> Estado usuario:", user.estado);

    let isMatch = false;

    try {
        if (
            hashBD.startsWith('$2a$') ||
            hashBD.startsWith('$2b$') ||
            hashBD.startsWith('$2y$')
        ) {
            isMatch = bcrypt.compareSync(cleanPassword, hashBD);
            console.log("-> [MÉTODO]: Validación por Hash de Bcrypt ejecutada.");
            console.log("-> ¿Bcrypt confirmó que coinciden?:", isMatch ? "SÍ ✅" : "NO ❌");
        } else {
            isMatch = cleanPassword === hashBD;
            console.log("⚠️ [ALERTA DE SEGURIDAD]: La clave en la base de datos está en TEXTO PLANO.");
            console.log("-> ¿Comparación directa de texto coincide?:", isMatch ? "SÍ ✅" : "NO ❌");
        }
    } catch (bcryptError) {
        console.error("❌ Error interno al procesar el hash con Bcrypt:", bcryptError.message);
        isMatch = false;
    }

    console.log("========================================================\n");

    if (!isMatch) {
        throw new Error("La contraseña ingresada no coincide con el registro.");
    }

    if (user.estado === false || user.estado === 'false' || user.estado === 0) {
        throw new Error("El usuario se encuentra inactivo.");
    }

    const permisosMock = [
        "INICIO_VER",
        "INSPECCIONES_CREAR",
        "VEHICULOS_BUSCAR",
        "CAJA_OPERAR"
    ];

    const tokenMock = "JWT_ACCESS_TOKEN_GENERADO_MOCK_FARENET_" + Date.now();

    return {
        token: tokenMock,
        user: {
            username: String(user.username || '').trim(),
            perfil_id: user.perfil_id,
            persona_nrodocumentoidentidad: user.persona_nrodocumentoidentidad,
            estado: user.estado,
            user_type: user.user_type
        },
        permisos: permisosMock
    };
};

const login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Usuario y contraseña son requeridos." });
    }

    try {
        const dataAuth = await authenticateUser(username, password);

        return res.status(200).json({
            status: "success",
            token: dataAuth.token,
            user: dataAuth.user,
            permisos: dataAuth.permisos || []
        });
    } catch (error) {
        console.error("Error en Login (Service Bridge):", error.message);
        return res.status(401).json({ message: error.message });
    }
};

const logout = async (req, res) => {
    return res.status(200).json({
        status: "success",
        message: "Sesión cerrada correctamente"
    });
};

module.exports = {
    authenticateUser,
    login,
    logout
};