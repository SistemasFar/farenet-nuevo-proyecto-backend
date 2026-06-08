const db = require('../config/database');
const bcrypt = require('bcryptjs'); // Asegúrate de tener la dependencia para validar el hash

/**
 * Servicio centralizado para autenticar credenciales contra PostgreSQL
 * @param {string} username 
 * @param {string} password 
 */
const authenticateUser = async (username, password) => {
    console.log("\n🔍 ========================================================");
    console.log("🕵️‍♂️ [AUDITORÍA DE AUTENTICACIÓN - ENTRADA EN SERVICIO]");
    console.log("-> Usuario recibido del Front:", username);
    console.log("-> Clave plano recibida del Front:", password ? "•••••••• (Texto enviado)" : "VACÍA");
    console.log("========================================================");

    // 1. Buscamos al usuario en la base de datos con sus columnas reales
    const query = `
        SELECT username, contrasenha, perfil_id, persona_nrodocumentoidentidad, estado, user_type 
        FROM usuario 
        WHERE username = $1 LIMIT 1
    `;
    
    const result = await db.query(query, [username]);
    const user = result.rows[0];

    // Diagnóstico del paso 1: ¿Existe el registro?
    if (!user) {
        console.log("❌ [RESULTADO AUDITORÍA]: El usuario '" + username + "' NO existe en la tabla 'usuario'.");
        console.log("========================================================\n");
        throw new Error("Usuario no encontrado en el sistema.");
    }

    console.log("✅ [USUARIO ENCONTRADO]: Registro recuperado con éxito.");
    console.log("-> Clave almacenada en Postgres:", user.contrasenha);

    // 2. Verificación de seguridad de la contraseña (Bcrypt)
    let isMatch = false;
    try {
        // Validamos si la contraseña de la BD tiene el formato de Hash estructurado de Bcrypt
        if (user.contrasenha.startsWith('$2b$') || user.contrasenha.startsWith('$2a$')) {
            isMatch = bcrypt.compareSync(password, user.contrasenha);
            console.log("-> [MÉTODO]: Validación por Hash de Bcrypt ejecutada.");
            console.log("-> ¿Bcrypt confirmó que coinciden?:", isMatch ? "SÍ ✅" : "NO ❌");
        } else {
            // COMPROBACIÓN DE RESPALDO: Si tu clave está en texto plano temporalmente por pruebas
            isMatch = (password === user.contrasenha);
            console.log("⚠️ [ALERTA DE SEGURIDAD]: La clave en la base de datos está en TEXTO PLANO.");
            console.log("-> ¿Comparación directa de texto coincide?:", isMatch ? "SÍ ✅" : "NO ❌");
        }
    } catch (bcryptError) {
        console.error("❌ Error interno al procesar el hash con Bcrypt:", bcryptError.message);
        isMatch = false;
    }

    console.log("========================================================\n");

    // Si la clave no coincide por ninguno de los dos métodos, disparamos el rechazo estricto
    if (!isMatch) {
        throw new Error("La contraseña ingresada no coincide con el registro.");
    }

    // 3. Simulación/Generación de los permisos y token para retornar al controlador (HU001)
    // En producción, aquí mandas a traer sus roles granulares de la tabla de permisos
    const permisosMock = ["INICIO_VER", "INSPECCIONES_CREAR", "VEHICULOS_BUSCAR", "CAJA_OPERAR"];
    const tokenMock = "JWT_ACCESS_TOKEN_GENERADO_MOCK_FARENET_" + Date.now();

    return {
        token: tokenMock,
        user: {
            username: user.username,
            perfil_id: user.perfil_id,
            persona_nrodocumentoidentidad: user.persona_nrodocumentoidentidad,
            estado: user.estado,
            user_type: user.user_type
        },
        permisos: permisosMock
    };
};

/**
 * Función controladora puente por si tu enrutamiento actual apunta 
 * a este archivo como middleware directo.
 */
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
    return res.status(200).json({ status: "success", message: "Sesión cerrada correctamente" });
};

module.exports = { 
    authenticateUser,
    login, 
    logout 
};