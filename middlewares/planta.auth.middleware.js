const db = require('../config/database');

const validarAccesoPlantaInspeccion = async (req, res, next) => {
    try {
        const nroInspeccion = req.params.nroInspeccion || req.params.nrodocumentoinspeccion || req.params.nro;
        
        // Si no hay nroInspeccion (rutas específicas siempre lo tienen)
        if (!nroInspeccion) {
            return res.status(400).json({ ok: false, message: 'Número de inspección requerido para validar acceso por planta' });
        }

        const usuario = req.user;
        if (!usuario) {
            return res.status(401).json({ ok: false, message: 'Usuario no autenticado' });
        }

        // 1. Obtener planta real de la inspección
        const query = `
            SELECT l.planta_key
            FROM inspeccion i
            JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
            JOIN linea l ON l.key = c.linea_key
            WHERE i.nrodocumentoinspeccion = $1
            ORDER BY c.fechcreacion DESC NULLS LAST
            LIMIT 1;
        `;
        const result = await db.query(query, [nroInspeccion]);

        if (result.rowCount === 0) {
            console.log(`[DEBUG] No se encontró planta para ${nroInspeccion}`);
            // No se pudo determinar la planta, bloqueamos por seguridad
            return res.status(403).json({
                ok: false,
                message: 'No tiene permisos para acceder a inspecciones de esta planta'
            });
        }

        const plantaReal = result.rows[0].planta_key;
        console.log(`[DEBUG] plantaReal para ${nroInspeccion} es ${plantaReal}`);

        // 2. Si la planta real coincide con la activa de la sesión, permitir
        if (plantaReal === usuario.plantaKey) {
            console.log(`[DEBUG] Acceso concedido (Misma planta)`);
            return next();
        }

        // 3. Si el perfil es global, permitir
        const perfilesGlobales = ['administrador', 'gerencia_general', 'auditoria'];
        if (perfilesGlobales.includes(usuario.perfilId)) {
            return next();
        }

        // 4. Si no es global, verificar en usuario_planta
        const queryAcceso = `
            SELECT 1 
            FROM usuario_planta 
            WHERE usuario_username = $1 AND plantas_key = $2 
            LIMIT 1;
        `;
        const resultAcceso = await db.query(queryAcceso, [usuario.username, plantaReal]);

        if (resultAcceso.rowCount > 0) {
            return next();
        }

        // 5. Bloqueo final si nada de lo anterior se cumple
        return res.status(403).json({
            ok: false,
            message: 'No tiene permisos para acceder a inspecciones de esta planta'
        });

    } catch (error) {
        console.error("Error en validarAccesoPlantaInspeccion:", error);
        return res.status(500).json({ ok: false, message: 'Error interno de validación' });
    }
};


const validarAccesoAdicional = async (username, plantaReq) => {
    const queryAcceso = 'SELECT 1 FROM usuario_planta WHERE usuario_username = $1 AND plantas_key = $2 LIMIT 1;';
    const resultAcceso = await db.query(queryAcceso, [username, plantaReq]);
    return resultAcceso.rowCount > 0;
};

const validarPlantaEnBody = async (req, res, next) => {
    try {
        const plantaReq = req.body.plantaKey;
        if (!plantaReq) return next();
        if (!req.user) return res.status(401).json({ok: false, message: 'No autenticado'});

        const globales = ['administrador', 'gerencia_general', 'auditoria', 'operaciones'];
        if (globales.includes(req.user.perfilId)) return next();

        if (plantaReq === req.user.plantaKey) return next();

        const tieneAcceso = await validarAccesoAdicional(req.user.username, plantaReq);
        if (tieneAcceso) return next();

        return res.status(403).json({ok: false, message: 'No tiene permisos para operar en la planta solicitada'});
    } catch (e) { return res.status(500).json({ok:false}); }
};

const validarPlantaEnParams = async (req, res, next) => {
    try {
        const plantaReq = req.params.plantaKey || req.params.planta;
        if (!plantaReq) return next();
        if (!req.user) return res.status(401).json({ok: false, message: 'No autenticado'});

        const globales = ['administrador', 'gerencia_general', 'auditoria'];
        if (globales.includes(req.user.perfilId)) return next();

        if (plantaReq === req.user.plantaKey) return next();

        const tieneAcceso = await validarAccesoAdicional(req.user.username, plantaReq);
        if (tieneAcceso) return next();

        return res.status(403).json({ok: false, message: 'No tiene permisos para operar en la planta solicitada'});
    } catch (e) { return res.status(500).json({ok:false}); }
};

const validarPlantaEnQuery = async (req, res, next) => {
    try {
        const plantaReq = req.query.plantaKey;
        if (!plantaReq) return next();
        if (!req.user) return res.status(401).json({ok: false, message: 'No autenticado'});

        const globales = ['administrador', 'gerencia_general', 'auditoria'];
        if (globales.includes(req.user.perfilId)) return next();

        if (plantaReq === req.user.plantaKey) return next();

        const tieneAcceso = await validarAccesoAdicional(req.user.username, plantaReq);
        if (tieneAcceso) return next();

        return res.status(403).json({ok: false, message: 'No tiene permisos para operar en la planta solicitada'});
    } catch (e) { return res.status(500).json({ok:false}); }
};

const validarPlantaPorInspeccionBody = async (req, res, next) => {
    try {
        const nroInspeccion = req.body.nrodocumentoinspeccion;
        if (!nroInspeccion) {
            return res.status(400).json({ ok: false, message: 'nrodocumentoinspeccion requerido en el body' });
        }
        if (!req.user) {
            return res.status(401).json({ ok: false, message: 'Usuario no autenticado' });
        }

        const query = `
            SELECT l.planta_key
            FROM inspeccion i
            JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
            JOIN linea l ON l.key = c.linea_key
            WHERE i.nrodocumentoinspeccion = $1
            ORDER BY c.fechcreacion DESC NULLS LAST
            LIMIT 1;
        `;
        const result = await db.query(query, [nroInspeccion]);

        if (result.rowCount === 0) {
            return res.status(403).json({ ok: false, message: 'No tiene permisos para acceder a esta inspección' });
        }

        const plantaReal = result.rows[0].planta_key;
        if (plantaReal === req.user.plantaKey) return next();

        const perfilesGlobales = ['administrador', 'gerencia_general', 'auditoria'];
        if (perfilesGlobales.includes(req.user.perfilId)) return next();

        const tieneAcceso = await validarAccesoAdicional(req.user.username, plantaReal);
        if (tieneAcceso) return next();

        return res.status(403).json({ ok: false, message: 'No tiene permisos para acceder a esta inspección' });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error validando planta' });
    }
};

module.exports = {
    validarAccesoPlantaInspeccion,
    validarPlantaEnBody,
    validarPlantaEnParams,
    validarPlantaPorInspeccionBody,
    validarPlantaEnQuery
};

