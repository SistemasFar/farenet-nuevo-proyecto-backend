
// ============================================
// FASE 4: DATOS ESPECÍFICOS DE CERTIFICADOS
// ============================================

// TALLERES
router.get('/talleres', 
    rbacMiddleware.requireAuth, 
    faregasCertificadosController.obtenerTalleresActivos
);

// GNV
router.put('/borradores/:id/gnv', 
    rbacMiddleware.requireAuth, 
    faregasCertificadosController.guardarGNV
);

router.put('/borradores/:id/gnv/verificaciones', 
    rbacMiddleware.requireAuth, 
    faregasCertificadosController.guardarGNVVerificaciones
);

router.get('/borradores/:id/gnv', 
    rbacMiddleware.requireAuth, 
    faregasCertificadosController.obtenerGNV
);

// GLP
router.put('/borradores/:id/glp', 
    rbacMiddleware.requireAuth, 
    faregasCertificadosController.guardarGLP
);

router.put('/borradores/:id/glp/componentes', 
    rbacMiddleware.requireAuth, 
    faregasCertificadosController.guardarGLPComponentes
);

router.put('/borradores/:id/glp/verificaciones', 
    rbacMiddleware.requireAuth, 
    faregasCertificadosController.guardarGLPVerificaciones
);

router.get('/borradores/:id/glp', 
    rbacMiddleware.requireAuth, 
    faregasCertificadosController.obtenerGLP
);

// CONFORMIDAD
router.put('/borradores/:id/conformidad', 
    rbacMiddleware.requireAuth, 
    faregasCertificadosController.guardarConformidad
);

router.get('/borradores/:id/conformidad', 
    rbacMiddleware.requireAuth, 
    faregasCertificadosController.obtenerConformidad
);
