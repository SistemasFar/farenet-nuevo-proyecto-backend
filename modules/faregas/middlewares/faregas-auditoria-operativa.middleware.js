const auditoriaService = require('../services/faregas-auditoria.service');

const segmentoFinal = (ruta) => ruta.split('/').filter(Boolean).at(-1) || null;

const describirUsuarios = (metodo, ruta) => {
    const referencia = segmentoFinal(ruta);
    if (ruta.includes('/perfiles')) {
        if (metodo === 'POST') return ['PERFIL_CREADO', 'Creó un nuevo perfil de usuario.', 'fg_perfil', null];
        if (metodo === 'PUT') return ['PERFIL_ACTUALIZADO', `Actualizó el perfil ${referencia}.`, 'fg_perfil', null];
        if (metodo === 'DELETE') return ['PERFIL_DESACTIVADO', `Desactivó el perfil ${referencia}.`, 'fg_perfil', null];
    }
    if (ruta.endsWith('/password')) return ['PASSWORD_ACTUALIZADO', `Cambió la contraseña del usuario ${ruta.split('/').at(-2)}.`, 'fg_usuario', null];
    if (metodo === 'POST') return ['USUARIO_CREADO', 'Creó un nuevo usuario FAREGAS.', 'fg_usuario', null];
    if (metodo === 'PUT') return ['USUARIO_ACTUALIZADO', `Actualizó el usuario ${referencia}.`, 'fg_usuario', null];
    if (metodo === 'DELETE') return ['USUARIO_DESACTIVADO', `Desactivó el usuario ${referencia}.`, 'fg_usuario', null];
    return null;
};

const nombresConfiguracion = {
    sedes: ['SEDE', 'sede', 'fg_planta', 'F'],
    empresas: ['EMPRESA', 'empresa', 'fg_empresa', 'F'],
    servicios: ['SERVICIO', 'servicio', 'fg_servicio', 'M'],
    categorias: ['CATEGORIA', 'categoría', 'fg_categoria_servicio', 'F'],
    productos: ['PRODUCTO', 'producto', 'fg_producto_facturacion', 'M'],
    tarifas: ['TARIFA', 'tarifa', 'fg_tarifa', 'F'],
    series: ['SERIE', 'serie', 'fg_serie_comprobante', 'F']
};

const describirConfiguracion = (metodo, ruta) => {
    const recurso = Object.keys(nombresConfiguracion).find((item) => ruta.startsWith(`/config/${item}`));
    if (!recurso) return null;
    const [prefijo, nombre, entidad, genero] = nombresConfiguracion[recurso];
    const articulo = genero === 'M' ? 'un' : 'una';
    const referencia = segmentoFinal(ruta);
    if (ruta.endsWith('/estado')) return [`${prefijo}_ESTADO_ACTUALIZADO`, `Cambió el estado de ${articulo} ${nombre}.`, entidad, null];
    if (ruta.endsWith('/empresa')) return ['EMPRESA_SEDE_ASIGNADA', 'Cambió la empresa asignada a una sede.', 'fg_planta', null];
    if (metodo === 'POST') return [`${prefijo}_CREADA`, `Creó ${articulo} ${genero === 'M' ? 'nuevo' : 'nueva'} ${nombre}.`, entidad, null];
    if (metodo === 'PUT') return [`${prefijo}_ACTUALIZADA`, `Actualizó ${articulo} ${nombre}.`, entidad, Number(referencia) || null];
    return null;
};

module.exports = (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

    const ruta = req.path;
    let categoria;
    let descripcion;

    if (ruta.startsWith('/usuarios')) {
        categoria = 'USUARIOS';
        descripcion = describirUsuarios(req.method, ruta);
    } else if (ruta.startsWith('/config')) {
        categoria = 'CONFIGURACION';
        descripcion = describirConfiguracion(req.method, ruta);
    }

    if (!descripcion) return next();

    res.on('finish', () => {
        const [evento, mensaje, entidad, entidadId] = descripcion;
        void auditoriaService.registrarEvento(auditoriaService.contextoRequest(req, {
            categoria,
            evento,
            exitoso: res.statusCode < 400,
            mensaje: res.statusCode < 400 ? mensaje : `No se completó la operación: ${mensaje.toLowerCase()}`,
            entidad,
            entidad_id: entidadId,
            datos: { metodo: req.method, ruta }
        }));
    });

    next();
};
