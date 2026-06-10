const authService = require('../services/auth.service');
const auditoriaService = require('../services/auditoria.service');
const db = require('../config/database');

const crearRefreshToken = (prefijo = 'REFRESH_TOKEN_FARENET') => {
    return `${prefijo}_${Date.now()}`;
};

const crearAccessTokenTemporal = () => {
    return `ACCESS_TOKEN_JWT_VALIDO_${Date.now()}`;
};

const normalizarTexto = (valor) => {
    return String(valor || '').trim();
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
        [normalizarTexto(username)]
    );

    return plantasResult.rows.map((p) => ({
        key: p.key,
        nombre: p.nombre
    }));
};

const obtenerPlantaPorKey = async (plantaKey) => {
    const result = await db.query(
        `
        SELECT key, nombre
        FROM planta
        WHERE key = $1
        LIMIT 1
        `,
        [normalizarTexto(plantaKey)]
    );

    return result.rows[0] || null;
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
        [normalizarTexto(username), normalizarTexto(plantaKey)]
    );

    return validacion.rowCount > 0;
};

const cerrarSesionesActivas = async (username) => {
    await db.query(
        `
        UPDATE sesion_usuario
        SET activo = false
        WHERE TRIM(username) = $1
          AND activo = true
        `,
        [normalizarTexto(username)]
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
            NOW() + INTERVAL '12 hours'
        )
        `,
        [
            normalizarTexto(username),
            refreshToken,
            normalizarTexto(plantaKey)
        ]
    );
};

const login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            message: "Usuario y contraseña son requeridos."
        });
    }

    try {
        const dataAuth = await authService.authenticateUser(username, password);
        const plantas = await obtenerPlantasAsignadas(dataAuth.user.username);

        if (plantas.length === 0) {
            return res.status(403).json({
                message: "El usuario no tiene sedes asignadas."
            });
        }

        if (plantas.length === 1) {
            const planta = plantas[0];
            const refreshToken = crearRefreshToken();

            await cerrarSesionesActivas(dataAuth.user.username);
            await registrarSesion(dataAuth.user.username, planta.key, refreshToken);
            await auditoriaService.registrarAuditoriaAcceso({
                req,
                username: dataAuth.user.username,
                evento: 'LOGIN',
                exitoso: true,
                mensaje: 'Login exitoso',
                plantaKey: planta.key
            });

            const permisos = await authService.obtenerPermisosPorUsuario(
                dataAuth.user.username,
                planta.key
            );

            return res.status(200).json({
                status: "success",
                requiereSeleccionarPlanta: false,
                accessToken: dataAuth.token,
                refreshToken,
                user: construirUsuarioResponse(dataAuth.user),
                plantaSeleccionada: planta,
                plantas,
                permisos
            });
        }

        await auditoriaService.registrarAuditoriaAcceso({
            req,
            username: dataAuth.user.username,
            evento: 'LOGIN',
            exitoso: true,
            mensaje: 'Login exitoso pendiente de selección de sede'
        });

        return res.status(200).json({
            status: "success",
            requiereSeleccionarPlanta: true,
            user: construirUsuarioResponse(dataAuth.user),
            plantas,
            permisos: dataAuth.permisos || []
        });
    } catch (error) {
        console.error("❌ [LOGIN RECHAZADO]:", error.message);

        await auditoriaService.registrarAuditoriaAcceso({
            req,
            username,
            evento: 'LOGIN',
            exitoso: false,
            mensaje: error.message
        });

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
                message: 'Usuario y sede operativa son obligatorios.'
            });
        }

        const tieneAcceso = await validarAccesoPlanta(username, plantaKey);

        if (!tieneAcceso) {
            return res.status(403).json({
                message: 'No tiene acceso a la sede seleccionada.'
            });
        }

        const user = await authService.obtenerUsuarioPorUsername(username);

        if (!user) {
            return res.status(404).json({
                message: 'Usuario no encontrado.'
            });
        }

        const planta = await obtenerPlantaPorKey(plantaKey);

        if (!planta) {
            return res.status(404).json({
                message: 'Sede no encontrada.'
            });
        }

        await cerrarSesionesActivas(username);

        const refreshToken = crearRefreshToken();

        await registrarSesion(username, plantaKey, refreshToken);
        await auditoriaService.registrarAuditoriaAcceso({
            req,
            username,
            evento: 'CONFIRMAR_PLANTA',
            exitoso: true,
            mensaje: 'Sede operativa confirmada correctamente',
            plantaKey
        });

        const permisos = await authService.obtenerPermisosPorUsuario(username, plantaKey);

        return res.status(200).json({
            status: 'success',
            accessToken: crearAccessTokenTemporal(),
            refreshToken,
            user: construirUsuarioResponse(user),
            plantaSeleccionada: planta,
            permisos
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

        const planta = await obtenerPlantaPorKey(plantaKey);

        if (!planta) {
            return res.status(404).json({
                message: 'Sede no encontrada.'
            });
        }

        await cerrarSesionesActivas(username);

        const refreshToken = crearRefreshToken('REFRESH_TOKEN_CAMBIO');

        await registrarSesion(username, plantaKey, refreshToken);
        await auditoriaService.registrarAuditoriaAcceso({
            req,
            username,
            evento: 'CAMBIO_PLANTA',
            exitoso: true,
            mensaje: 'Cambio de sede realizado correctamente',
            plantaKey
        });

        const permisos = await authService.obtenerPermisosPorUsuario(username, plantaKey);

        return res.status(200).json({
            status: 'success',
            refreshToken,
            plantaSeleccionada: planta,
            permisos
        });

    } catch (error) {
        console.error('❌ Error cambiando sede:', error);

        return res.status(500).json({
            message: 'Error al cambiar de sede.'
        });
    }
};

const obtenerPermisos = async (req, res) => {
    const { username } = req.params;
    const { plantaKey } = req.query;

    try {
        if (!username) {
            return res.status(400).json({
                message: 'Usuario es obligatorio.'
            });
        }

        const permisos = await authService.obtenerPermisosPorUsuario(username, plantaKey || null);

        return res.status(200).json({
            status: 'success',
            username,
            plantaKey: plantaKey || null,
            permisos
        });

    } catch (error) {
        console.error('❌ Error obteniendo permisos:', error);

        return res.status(500).json({
            message: 'Error al obtener permisos del usuario.'
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
        await auditoriaService.registrarAuditoriaAcceso({
            req,
            username,
            evento: 'LOGOUT',
            exitoso: true,
            mensaje: 'Sesión cerrada correctamente'
        });

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
    cambiarPlanta,
    obtenerPermisos
};