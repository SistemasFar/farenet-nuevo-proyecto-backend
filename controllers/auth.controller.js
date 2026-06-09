const authService = require('../services/auth.service');
const db = require('../config/database');

const crearRefreshToken = (prefijo = 'REFRESH_TOKEN_FARENET') => {
    return `${prefijo}_${Date.now()}`;
};

const crearAccessTokenTemporal = () => {
    return `ACCESS_TOKEN_JWT_VALIDO_${Date.now()}`;
};

const construirUsuarioResponse = (user) => {
    return {
        username: user.username,
        perfilId: user.perfil_id,
        personaDocumento: user.persona_nrodocumentoidentidad,
        estado: user.estado,
        userType: user.user_type
    };
};

const obtenerPlantasAsignadas = async (username) => {
    const plantasResult = await db.query(
        `
        SELECT
            p.key,
            p.nombre
        FROM usuario_planta up
        INNER JOIN planta p
            ON p.key = up.plantas_key
        WHERE TRIM(up.usuario_username) = $1
        ORDER BY p.nombre
        `,
        [username.trim()]
    );

    return plantasResult.rows.map((p) => ({
        key: p.key,
        nombre: p.nombre
    }));
};

const validarAccesoPlanta = async (username, plantaKey) => {
    const validacion = await db.query(
        `
        SELECT 1
        FROM usuario_planta up
        WHERE TRIM(up.usuario_username) = $1
          AND up.plantas_key = $2
        LIMIT 1
        `,
        [username.trim(), plantaKey]
    );

    return validacion.rowCount > 0;
};

const cerrarSesionesActivas = async (username) => {
    await db.query(
        `
        UPDATE sesion_usuario
        SET activo = false
        WHERE username = $1
          AND activo = true
        `,
        [username.trim()]
    );
};

const registrarSesion = async (username, plantaKey, refreshToken) => {
    await db.query(
        `
        INSERT INTO sesion_usuario
        (
            username,
            refresh_token,
            planta_key,
            activo,
            fechexpiracion
        )
        VALUES
        (
            $1,
            $2,
            $3,
            true,
            NOW() + INTERVAL '7 days'
        )
        `,
        [
            username.trim(),
            refreshToken,
            plantaKey
        ]
    );
};

const login = async (req, res) => {
    console.log("\n========================================================");
    console.log("📥 [FRONTEND -> BACKEND] Petición recibida en auth.controller:");
    console.log("Cuerpo (req.body):", req.body);
    console.log("========================================================");

    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            message: "Usuario y contraseña son requeridos."
        });
    }

    try {
        const dataAuth = await authService.authenticateUser(username, password);

        console.log("✅ [AUTENTICACIÓN EXITOSA] Servicio retornó dataAuth para:", username);

        const plantas = await obtenerPlantasAsignadas(dataAuth.user.username);

        console.log(`📊 [SEDES CARGADAS]: ${plantas.length}`);

        if (plantas.length === 0) {
            return res.status(403).json({
                message: "El usuario no tiene sedes asignadas."
            });
        }

        if (plantas.length === 1) {
            const planta = plantas[0];
            const refreshToken = crearRefreshToken();

            await cerrarSesionesActivas(dataAuth.user.username);
            await registrarSesion(
                dataAuth.user.username,
                planta.key,
                refreshToken
            );

            return res.status(200).json({
                status: "success",
                requiereSeleccionarPlanta: false,
                accessToken: dataAuth.token,
                refreshToken,
                user: construirUsuarioResponse(dataAuth.user),
                plantaSeleccionada: planta.key,
                plantas,
                permisos: dataAuth.permisos || []
            });
        }

        return res.status(200).json({
            status: "success",
            requiereSeleccionarPlanta: true,
            user: {
                username: dataAuth.user.username,
                perfilId: dataAuth.user.perfil_id
            },
            plantas,
            permisos: dataAuth.permisos || []
        });

    } catch (error) {
        console.error("❌ [LOGIN RECHAZADO] Excepción controlada:");
        console.error("Mensaje exacto del error:", error.message);
        console.error("Stack trace para auditoría:", error.stack);
        console.log("========================================================\n");

        return res.status(401).json({
            message: error.message
        });
    }
};

const confirmarPlanta = async (req, res) => {
    const { username, plantaKey } = req.body;

    try {
        if (!username || !plantaKey) {
            return res.status(400).json({
                message: 'Usuario y Sede operativa son obligatorios.'
            });
        }

        const tieneAcceso = await validarAccesoPlanta(username, plantaKey);

        if (!tieneAcceso) {
            return res.status(403).json({
                message: 'No tiene acceso a la sede seleccionada.'
            });
        }

        await cerrarSesionesActivas(username);

        const refreshToken = crearRefreshToken();

        await registrarSesion(
            username,
            plantaKey,
            refreshToken
        );

        console.log(`💾 [AUDITORÍA]: ${username} ingresó a la sede ${plantaKey}`);

        return res.status(200).json({
            status: 'success',
            accessToken: crearAccessTokenTemporal(),
            refreshToken,
            plantaSeleccionada: plantaKey
        });

    } catch (error) {
        console.error('❌ Error en confirmarPlanta:', error);

        return res.status(500).json({
            message: 'Error interno al registrar la sesión.'
        });
    }
};

const cambiarPlanta = async (req, res) => {
    const { username, plantaKey } = req.body;

    try {
        if (!username || !plantaKey) {
            return res.status(400).json({
                message: 'Usuario y sede son obligatorios.'
            });
        }

        const tieneAcceso = await validarAccesoPlanta(username, plantaKey);

        if (!tieneAcceso) {
            return res.status(403).json({
                message: 'No tiene acceso a la sede seleccionada.'
            });
        }

        await cerrarSesionesActivas(username);

        const refreshToken = crearRefreshToken('REFRESH_TOKEN_CAMBIO');

        await registrarSesion(
            username,
            plantaKey,
            refreshToken
        );

        console.log(`🔁 [CAMBIO SEDE]: ${username} cambió a la sede ${plantaKey}`);

        return res.status(200).json({
            status: 'success',
            plantaSeleccionada: plantaKey
        });

    } catch (error) {
        console.error('❌ Error cambiando sede:', error);

        return res.status(500).json({
            message: 'Error al cambiar de sede.'
        });
    }
};

const logout = async (req, res) => {
    const { username } = req.body;

    try {
        if (!username) {
            return res.status(400).json({
                message: 'Usuario es obligatorio.'
            });
        }

        await cerrarSesionesActivas(username);

        return res.status(200).json({
            status: "success",
            message: "Sesión cerrada en base de datos"
        });

    } catch (error) {
        console.error('❌ Error al cerrar sesión:', error);

        return res.status(500).json({
            message: "Error al cerrar sesión"
        });
    }
};

module.exports = {
    login,
    logout,
    confirmarPlanta,
    cambiarPlanta
};