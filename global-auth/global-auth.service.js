const faregasAuthService = require('../modules/faregas/services/faregas-auth.service');

exports.detectarEmpresasDisponibles = async (username, password) => {
    const faregasResult = await faregasAuthService.validarFaregas(username, password);

    if (!faregasResult.valido) {
        throw new Error("Credenciales inválidas");
    }

    return [{
        key: 'FAREGAS',
        nombre: 'FAREGAS S.A.C.'
    }];
};
