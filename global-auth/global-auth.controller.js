const globalAuthService = require('./global-auth.service');

exports.detectarEmpresas = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            message: "Usuario y contraseña son requeridos."
        });
    }

    try {
        const empresasDisponibles = await globalAuthService.detectarEmpresasDisponibles(username, password);

        return res.status(200).json({
            status: "success",
            empresasDisponibles
        });

    } catch (error) {
        if (error.message === "Credenciales inválidas") {
            return res.status(401).json({
                message: "Credenciales inválidas"
            });
        }
        console.error("Error en detectarEmpresas:", error);
        return res.status(500).json({
            message: "Error interno en validación de empresas."
        });
    }
};
