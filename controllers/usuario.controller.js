const usuarioModel = require('../models/usuario.model');

const getUsuarioByUsername = async (req, res) => {
    // Soportamos que el frontend envíe el parámetro en el body (POST) o query string (GET)
    const username = req.body.username || req.query.username || req.body.Username;

    if (!username) {
        return res.status(400).json({ message: "El campo username es obligatorio." });
    }

    try {
        const user = await usuarioModel.findByUsername(username);
        if (!user) {
            return res.status(404).json({ message: "Usuario no encontrado en la base de datos." });
        }

        // Estructura híbrida definitiva: Clonamos el formato exacto de las entidades de C#
        return res.status(200).json({
            Username: user.username,
            Contrasenha: user.contrasenha,
            PerfilId: user.perfil_id,
            PersonaNroDocumentoIdentidad: user.persona_nrodocumentoidentidad,
            Firmacertificador: user.firmacertificador,
            Estado: user.estado,
            Foto: user.foto,
            UserType: user.user_type,

            // Duplicado en minúsculas por si el frontend usa desestructuración nativa de JS
            username: user.username,
            perfilId: user.perfil_id,
            personaNroDocumentoIdentidad: user.persona_nrodocumentoidentidad,
            estado: user.estado,
            userType: user.user_type
        });
    } catch (error) {
        console.error("Error crítico en getUsuarioByUsername:", error);
        return res.status(500).json({ message: "Error interno del servidor al consultar usuario." });
    }
};

const getPlantasByUsuario = async (req, res) => {
    try {
        // Formato de respuesta mockeado idéntico a lo que exige el flujo visual de Farenet
        const plantasMock = [
            { id: 1, nombre: "Planta Principal Farenet", codigo: "PL-01", estado: true }
        ];
        return res.status(200).json(plantasMock);
    } catch (error) {
        return res.status(500).json({ message: "Error al obtener plantas asignadas." });
    }
};

module.exports = {
    getUsuarioByUsername,
    getPlantasByUsuario
};