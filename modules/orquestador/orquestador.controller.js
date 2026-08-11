const orquestadorService = require('./orquestador.service');
const faregasAuthService = require('../faregas/auth/faregas-auth.service');

exports.detectarEmpresas = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            message: "Usuario y contraseña son requeridos."
        });
    }

    try {
        const farenetResult = await orquestadorService.validarFarenetReadOnly(username, password);
        const faregasResult = await faregasAuthService.validarFaregas(username, password);

        if (!farenetResult.valido && !faregasResult.valido) {
            return res.status(401).json({
                message: "Credenciales inválidas"
            });
        }

        const empresasDisponibles = [];
        if (farenetResult.valido) {
            empresasDisponibles.push({
                key: 'FARENET',
                nombre: 'FARENET S.A.C.'
            });
        }
        if (faregasResult.valido) {
            empresasDisponibles.push({
                key: 'FAREGAS',
                nombre: 'FAREGAS S.A.C.'
            });
        }

        return res.status(200).json({
            status: "success",
            empresasDisponibles
        });

    } catch (error) {
        console.error("Error en detectarEmpresas:", error);
        return res.status(500).json({
            message: "Error interno en validación de empresas."
        });
    }
};
