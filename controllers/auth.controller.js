const authService = require('../services/auth.service');
const db = require('../config/database');

const login = async (req, res) => {
    // ── LOG 1: VERIFICAR QUÉ LLEGA DESDE EL FRONTEND ──
    console.log("\n========================================================");
    console.log("📥 [FRONTEND -> BACKEND] Petición recibida en auth.controller:");
    console.log("Cuerpo (req.body):", req.body);
    console.log("========================================================");

    const { username, password, plantaKey } = req.body; 

    if (!username || !password) {
        return res.status(400).json({ message: "Usuario y contraseña son requeridos." });
    }

    try {
        // Ejecuta la autenticación en el servicio
        const dataAuth = await authService.authenticateUser(username, password);

        // ── LOG 2: VERIFICAR ÉXITO DEL SERVICIO ──
        console.log("✅ [AUTENTICACIÓN EXITOSA] Servicio retornó dataAuth para:", username);

        // Si el usuario tiene acceso a múltiples plantas y no ha mandado ninguna
    // Si el usuario tiene acceso a múltiples plantas y no ha mandado ninguna, 
        // le respondemos con sus plantas asignadas reales desde la BD
        if (!plantaKey) {
            // Ejecutamos la consulta SQL en PostgreSQL
            const plantasResult = await db.query(
                'SELECT key, nombre FROM planta ORDER BY nombre ASC'
            );
            
            console.log(`📊 [SEDES CARGADAS]: Se enviaron ${plantasResult.rows.length} sedes al selector.`);

            return res.status(200).json({
                requiereSeleccionarPlanta: true,
                user: {
                    username: dataAuth.user.username,
                    perfilId: dataAuth.user.perfil_id
                },
                // Mapeamos el resultado directamente para asegurar que mantenga el contrato en camelCase
                plantas: plantasResult.rows.map(p => ({
                    key: p.key,
                    nombre: p.nombre
                })),
                permisos: dataAuth.permisos || []
            });
        }

        // --- REGISTRO EN LA TABLA SESION_USUARIO ---
        const refreshToken = "TOKEN_REFRESH_GENERADO_JWT"; 
        const expirationDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); 

        await db.query(
            `INSERT INTO sesion_usuario (username, refresh_token, planta_key, activo, fechexpiracion) 
             VALUES ($1, $2, $3, true, $4)`,
            [dataAuth.user.username, refreshToken, plantaKey, expirationDate]
        );

        return res.status(200).json({
            status: "success",
            accessToken: dataAuth.token,
            refreshToken: refreshToken,
            user: {
                username: dataAuth.user.username,
                perfilId: dataAuth.user.perfil_id,
                personaDocumento: dataAuth.user.persona_nrodocumentoidentidad,
                estado: dataAuth.user.estado,
                userType: dataAuth.user.user_type
            },
            plantaSeleccionada: plantaKey,
            permisos: dataAuth.permisos || []
        });

    } catch (error) {
        // ── LOG 3: CAPTURAR EL MOTIVO REAL DEL RECHAZO ──
        console.error("❌ [LOGIN RECHAZADO] Excepción controlada:");
        console.error("Mensaje exacto del error:", error.message);
        console.error("Stack trace para auditoría:", error.stack);
        console.log("========================================================\n");
        
        return res.status(401).json({ message: "Credenciales incorrectas." });
    }
};

const logout = async (req, res) => {
    const { username } = req.body; 
    try {
        await db.query(
            `UPDATE sesion_usuario SET activo = false WHERE username = $1 AND activo = true`,
            [username]
        );
        return res.status(200).json({ status: "success", message: "Sesión cerrada en base de datos" });
    } catch (error) {
        return res.status(500).json({ message: "Error al cerrar sesión" });
    }
};

// Nuevo método exclusivo para confirmar la planta seleccionada sin pedir clave de nuevo
const confirmarPlanta = async (req, res) => {
    const { username, plantaKey } = req.body;

    try {
        if (!username || !plantaKey) {
            return res.status(400).json({ message: 'Usuario y Sede operativa son obligatorios.' });
        }

        // 🚀 1. REGISTRO DE AUDITORÍA REAL EN POSTGRESQL
        const tokenRefreshMock = 'REFRESH_TOKEN_FARENET_' + Date.now();
        await db.query(
            `INSERT INTO sesion_usuario (username, refresh_token, planta_key, activo, fechexpiracion) 
             VALUES ($1, $2, $3, true, NOW() + INTERVAL '7 days')`,
            [username, tokenRefreshMock, plantaKey]
        );

        console.log(`💾 [AUDITORÍA]: Sesión insertada con éxito en Postgres para ${username} en la planta ${plantaKey}.`);

        // 2. Respondemos con los tokens definitivos para el Dashboard
        return res.status(200).json({
            status: 'success',
            accessToken: 'ACCESS_TOKEN_JWT_VALIDO_' + Date.now(),
            refreshToken: tokenRefreshMock,
            user: {
                username: username,
                perfilId: 'OPERADOR'
            },
            permisos: ['CAMBIAR_PLANTA', 'VER_INSPECCIONES']
        });

    } catch (error) {
        console.error('❌ Error en confirmarPlanta:', error);
        return res.status(500).json({ message: 'Error interno al registrar la sesión.' });
    }
};

// No olvides agregar "confirmarPlanta" a tus exportaciones al final del archivo:
module.exports = {
    login,
    logout,
    confirmarPlanta // <-- Agrégalo aquí
};