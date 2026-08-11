const faregasAuthService = require('./faregas-auth.service');

exports.validar = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            valido: false,
            message: "Usuario y contraseña son requeridos."
        });
    }

    try {
        const result = await faregasAuthService.validarFaregas(username, password);

        if (!result.valido) {
            return res.status(401).json({
                valido: false,
                message: "Credenciales inválidas"
            });
        }

        return res.status(200).json({
            valido: true,
            empresa: {
                key: "FAREGAS",
                nombre: "FAREGAS S.A.C."
            },
            user: result.user
        });

    } catch (error) {
        console.error("Error en validar FAREGAS:", error);
        return res.status(500).json({
            valido: false,
            message: "Error interno en validación FAREGAS."
        });
    }
};
