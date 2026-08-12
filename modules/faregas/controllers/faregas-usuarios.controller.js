const service = require('../services/faregas-usuarios.service');

exports.obtenerUsuarios = async (req, res) => {
    try {
        const data = await service.obtenerUsuarios();
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.crearUsuario = async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Username y password requeridos' });
        
        const result = await service.crearUsuario(req.body);
        res.status(201).json(result);
    } catch (e) {
        if (e.code === '23505') { // unique_violation
            return res.status(409).json({ message: 'El usuario ya existe' });
        }
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.actualizarUsuario = async (req, res) => {
    try {
        const result = await service.actualizarUsuario(req.params.username, req.body);
        res.json(result);
    } catch (e) {
        if (e.message === 'USERNAME_EXISTS') {
            return res.status(409).json({ message: 'El nuevo username ya está en uso' });
        }
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.cambiarPassword = async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ message: 'Nueva contraseña requerida' });
        await service.cambiarPassword(req.params.username, password);
        res.json({ success: true });
    } catch (e) {
        if (e.message === 'USER_NOT_FOUND') {
            return res.status(404).json({ message: 'El usuario no existe' });
        }
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.eliminarUsuario = async (req, res) => {
    try {
        await service.eliminarUsuario(req.params.username);
        res.json({ success: true });
    } catch (e) {
        if (e.message === 'HAS_SESSIONS') {
            return res.status(409).json({ message: 'No se puede eliminar el usuario porque tiene sesiones registradas.' });
        }
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.obtenerPerfiles = async (req, res) => {
    try {
        const data = await service.obtenerPerfiles();
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.obtenerPermisos = async (req, res) => {
    try {
        const data = await service.obtenerPermisos();
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.crearPerfil = async (req, res) => {
    try {
        const { clave, nombre } = req.body;
        if (!clave || !nombre) return res.status(400).json({ message: 'Clave y nombre requeridos' });
        const result = await service.crearPerfil(req.body);
        res.status(201).json(result);
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ message: 'La clave de perfil ya existe' });
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.actualizarPerfil = async (req, res) => {
    try {
        const result = await service.actualizarPerfil(req.params.clave, req.body);
        res.json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.eliminarPerfil = async (req, res) => {
    try {
        await service.eliminarPerfil(req.params.clave);
        res.json({ success: true });
    } catch (e) {
        if (e.message === 'NO_DELETE_SISTEMAS') {
            return res.status(403).json({ message: 'No se permite eliminar el perfil SISTEMAS' });
        }
        if (e.message === 'IN_USE') {
            return res.status(409).json({ message: 'No se puede eliminar el perfil porque tiene usuarios asignados.' });
        }
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.obtenerPlantas = async (req, res) => {
    try {
        const data = await service.obtenerPlantas();
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};
