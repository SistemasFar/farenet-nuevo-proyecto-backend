const db = require('../config/database');

const validarAccesoPlantaInspeccion = async (req, res, next) => {
    try {
        const { nroInspeccion } = req.params;
        console.log(`[DEBUG] validarAccesoPlantaInspeccion - nroInspeccion: ${nroInspeccion}, user:`, req.user?.username, 'plantaActiva:', req.user?.plantaKey);
        
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
        const perfilesGlobales = ['administrador', 'gerencia_general', 'auditoria', 'operaciones'];
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

module.exports = validarAccesoPlantaInspeccion;
