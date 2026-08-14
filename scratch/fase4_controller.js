
// ============================================
// FASE 4: DATOS ESPECÍFICOS DE CERTIFICADOS
// ============================================

// GNV
exports.guardarGNV = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await faregasCertificadosService.guardarGNV(req.params.id, req.body, userContext);
        res.json({ ok: true, message: 'Datos GNV guardados correctamente' });
    } catch (error) {
        console.error('Error en guardarGNV:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.guardarGNVVerificaciones = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await faregasCertificadosService.guardarGNVVerificaciones(req.params.id, req.body.verificaciones, userContext);
        res.json({ ok: true, message: 'Verificaciones GNV guardadas' });
    } catch (error) {
        console.error('Error en guardarGNVVerificaciones:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.obtenerGNV = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        const data = await faregasCertificadosService.obtenerGNV(req.params.id, userContext);
        res.json({ ok: true, data });
    } catch (error) {
        console.error('Error en obtenerGNV:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

// GLP
exports.guardarGLP = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await faregasCertificadosService.guardarGLP(req.params.id, req.body, userContext);
        res.json({ ok: true, message: 'Datos GLP guardados' });
    } catch (error) {
        console.error('Error en guardarGLP:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.guardarGLPComponentes = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await faregasCertificadosService.guardarGLPComponentes(req.params.id, req.body.componentes, userContext);
        res.json({ ok: true, message: 'Componentes GLP guardados' });
    } catch (error) {
        console.error('Error en guardarGLPComponentes:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.guardarGLPVerificaciones = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await faregasCertificadosService.guardarGLPVerificaciones(req.params.id, req.body.verificaciones, userContext);
        res.json({ ok: true, message: 'Verificaciones GLP guardadas' });
    } catch (error) {
        console.error('Error en guardarGLPVerificaciones:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.obtenerGLP = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        const data = await faregasCertificadosService.obtenerGLP(req.params.id, userContext);
        res.json({ ok: true, data });
    } catch (error) {
        console.error('Error en obtenerGLP:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

// CONFORMIDAD
exports.guardarConformidad = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        await faregasCertificadosService.guardarConformidad(req.params.id, req.body, userContext);
        res.json({ ok: true, message: 'Datos Conformidad guardados' });
    } catch (error) {
        console.error('Error en guardarConformidad:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

exports.obtenerConformidad = async (req, res) => {
    try {
        const userContext = { username: req.user.username, perfil_id: req.user.perfil_id };
        const data = await faregasCertificadosService.obtenerConformidad(req.params.id, userContext);
        res.json({ ok: true, data });
    } catch (error) {
        console.error('Error en obtenerConformidad:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};

// TALLERES
exports.obtenerTalleresActivos = async (req, res) => {
    try {
        const data = await faregasCertificadosService.obtenerTalleresActivos();
        res.json({ ok: true, data });
    } catch (error) {
        console.error('Error en obtenerTalleresActivos:', error);
        res.status(400).json({ ok: false, message: error.message });
    }
};
