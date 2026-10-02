const db = require('../../../config/database');
const sedeRangos = require('../services/faregas-correlativos-sede.service');
const auditoriaService = require('../services/faregas-auditoria.service');

const auditarConfiguracion = (req, detalle) => auditoriaService.registrarEvento(
    auditoriaService.contextoRequest(req, {
        categoria: 'CONFIGURACION',
        entidad: 'fg_correlativo_certificado_sede',
        ...detalle
    })
);

// ===========================================================================
// CORRELATIVOS POR SEDE
//
// La unidad de asignación es (sede, rango físico). El tipo de certificado, la
// modalidad y el producto no aparecen en ninguna de estas rutas: no forman parte
// de la clave. Un rango recibido por una sede sirve para cualquier certificado
// que esa sede emita, y cuando se agota la emisión continúa con el siguiente
// bloque de la misma sede.
//
// Se dejan aparte a propósito: este archivo NO habla de Nubefact, de series de
// comprobante ni de correlativos tributarios. La numeración física de
// certificados no se mezcla con la numeración de facturas y boletas.
// ===========================================================================

/** Los errores del inventario ya salen traducidos desde el servicio. */
const responderErrorRangoSede = (res, error) => {
    const codigo = error.code || error.message;
    const status = error.statusCode || error.status || 400;
    res.status(status).json({
        ok: false,
        codigo,
        message: (error.detalles && error.detalles.mensaje)
            || sedeRangos.MENSAJES[codigo]
            || error.message,
        detalles: error.detalles || null
    });
};

exports.listarRangosSede = async (req, res) => {
    try {
        const rangos = await sedeRangos.listarRangos(db, {
            plantaKey: req.query.plantaKey || null,
            estado: req.query.estado || null
        });
        res.json({ ok: true, data: rangos });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.resumenRangosSede = async (req, res) => {
    try {
        const plantaKey = req.query.plantaKey || null;
        const [resumen, siguiente] = await Promise.all([
            sedeRangos.obtenerResumenPorSede(db, { plantaKey }),
            plantaKey ? sedeRangos.previsualizarProximo(db, plantaKey) : null
        ]);
        res.json({ ok: true, data: { resumen, siguiente } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
};

exports.auditarRangosSede = async (req, res) => {
    try {
        res.json({ ok: true, data: await sedeRangos.auditar(db) });
    } catch (error) {
        responderErrorRangoSede(res, error);
    }
};

exports.sugerirRangoSede = async (req, res) => {
    try {
        const sugerencia = await sedeRangos.sugerirRango(db, { plantaKey: req.query.plantaKey || null });
        res.json({ ok: true, data: sugerencia });
    } catch (error) {
        responderErrorRangoSede(res, error);
    }
};

/**
 * "Agregar rango a sede". El formulario pide sede, número inicial, número final,
 * fecha de asignación y observación. No pide producto, operación ni tipo.
 */
exports.agregarRangoSede = async (req, res) => {
    const { plantaKey, rangoInicio, rangoFin, fechaAsignacion, observacion } = req.body || {};
    try {
        if (!plantaKey) return res.status(400).json({ ok: false, message: 'La sede es obligatoria.' });
        if (rangoInicio === undefined || rangoInicio === null) {
            return res.status(400).json({ ok: false, message: 'El número inicial (desde) es obligatorio.' });
        }
        if (rangoFin === undefined || rangoFin === null) {
            return res.status(400).json({ ok: false, message: 'El número final (hasta) es obligatorio.' });
        }
        const resultado = await sedeRangos.agregarRango({
            plantaKey,
            rango_inicio: rangoInicio,
            rango_fin: rangoFin,
            fechaAsignacion: fechaAsignacion || null,
            observacion: observacion || null
        });
        await auditarConfiguracion(req, {
            evento: 'CORRELATIVO_SEDE_CREADO',
            entidad: 'fg_correlativo_certificado_sede',
            entidad_id: Number(resultado.id),
            mensaje: `Asignó el rango ${resultado.rango_inicio}-${resultado.rango_fin} `
                + `(${resultado.cantidad} números) a la sede ${plantaKey}.`,
            planta_key: plantaKey,
            datos: { rangoInicio: Number(resultado.rango_inicio), rangoFin: Number(resultado.rango_fin), observacion }
        });
        res.status(201).json({ ok: true, data: resultado });
    } catch (error) {
        responderErrorRangoSede(res, error);
    }
};

exports.editarRangoSede = async (req, res) => {
    const { id } = req.params;
    try {
        const resultado = await sedeRangos.editarRango(Number(id), req.body || {});
        await auditarConfiguracion(req, {
            evento: 'CORRELATIVO_SEDE_ACTUALIZADO',
            entidad: 'fg_correlativo_certificado_sede',
            entidad_id: Number(id),
            mensaje: `Actualizó el rango ${resultado.rango_inicio}-${resultado.rango_fin} `
                + `de la sede ${resultado.planta_key}.`,
            planta_key: resultado.planta_key,
            datos: { rangoInicio: Number(resultado.rango_inicio), rangoFin: Number(resultado.rango_fin) }
        });
        res.json({ ok: true, data: resultado });
    } catch (error) {
        responderErrorRangoSede(res, error);
    }
};

exports.cerrarRangoSede = async (req, res) => {
    const { id } = req.params;
    try {
        const resultado = await sedeRangos.cerrarRango(Number(id));
        await auditarConfiguracion(req, {
            evento: 'CORRELATIVO_SEDE_CERRADO',
            entidad: 'fg_correlativo_certificado_sede',
            entidad_id: Number(id),
            mensaje: `Cerró un rango de correlativos de la sede ${resultado.planta_key}.`
        });
        res.json({ ok: true, message: resultado.mensaje, data: resultado });
    } catch (error) {
        responderErrorRangoSede(res, error);
    }
};