const db = require('../../../config/database');
const ventaDirectaFase1 = require('./faregas-venta-directa-canonica.service');
const facturacionService = require('./faregas-facturacion.service');

const texto = (value) => String(value ?? '').trim();

const obtenerSnapshotOperacion = async (database, operacionId) => {
    const result = await database.query(`
        SELECT id, planta_key, estado,
               tipo_documento_cliente_snapshot, documento_cliente_snapshot,
               nombre_cliente_snapshot, direccion_cliente_snapshot
        FROM fg_operacion_comercial
        WHERE id = $1
    `, [operacionId]);
    if (!result.rowCount) throw new Error('OPERACION_NOT_FOUND');
    return result.rows[0];
};

const construirDatosFacturacionInicial = (payload) => ({
    tipoComprobante: texto(payload?.tipoComprobante).toUpperCase(),
    nroDocumento: payload?.nroDocumento,
    nombreRazonSocial: payload?.nombreRazonSocial,
    direccion: payload?.direccion,
    email: payload?.email || null,
    telefono: payload?.telefono || null,
    condicionPago: texto(payload?.condicionPago || 'CONTADO').toUpperCase(),
    fechaVencimiento: payload?.fechaVencimiento || null,
    medioPago: payload?.medioPago || null,
    cuotas: Array.isArray(payload?.cuotas) ? payload.cuotas : []
});

const construirDatosFacturacion = (snapshot, tipoComprobante) => ({
    tipoComprobante: texto(tipoComprobante).toUpperCase(),
    nroDocumento: snapshot.documento_cliente_snapshot,
    nombreRazonSocial: snapshot.nombre_cliente_snapshot,
    direccion: snapshot.direccion_cliente_snapshot,
    email: null,
    telefono: null,
    condicionPago: 'CONTADO',
    medioPago: null,
    cuotas: []
});

const mensajeExito = (facturacion) => {
    const numero = facturacion?.nroComprobante || 'sin número asignado';
    if (facturacion?.estado === 'ACEPTADO') {
        return `Comprobante ${numero} aceptado por SUNAT.`;
    }
    return `Comprobante ${numero} registrado y pendiente de SUNAT.`;
};

const mensajeError = (error, facturacion) => {
    const detalle = error?.detalles?.facturacion || facturacion;
    const motivo = detalle?.sunatDescription || detalle?.sunat_description || error?.detalles?.motivo || error?.message;
    if (error?.code === 'NUBEFACT_RECHAZADO' || detalle?.estado === 'RECHAZADO') {
        return `Nubefact rechazó el comprobante${motivo ? `: ${motivo}` : '.'}`;
    }
    if (error?.code === 'NUBEFACT_ERROR' || detalle?.estado === 'ERROR') {
        return `Nubefact no pudo confirmar el comprobante${motivo ? `: ${motivo}` : '.'}`;
    }
    if (error?.code === 'DATOS_FACTURACION_INVALIDOS') {
        return 'La venta local quedó registrada, pero los datos fiscales no permiten crear el comprobante.';
    }
    if (error?.code === 'DATOS_NUBEFACT_INVALIDOS') {
        return 'La venta local quedó registrada, pero el producto o los datos tributarios no están listos para Nubefact.';
    }
    if (error?.code === 'SERIE_COMPROBANTE_NO_CONFIGURADA' || error?.code === 'SERIE_PRODUCCION_NO_CONFIRMADA') {
        return `La venta local quedó registrada, pero la serie no está disponible: ${motivo || error.message}.`;
    }
    return motivo || 'La venta local quedó registrada, pero la facturación no pudo completarse.';
};

const crearVentaDirectaYEmitir = async (payload, userContext, dependencies = {}) => {
    const ventaService = dependencies.ventaDirectaService || ventaDirectaFase1;
    const billingService = dependencies.facturacionService || facturacionService;
    const database = dependencies.db || db;

    const evaluacionInicial = billingService.evaluarDatosFacturacion(
        construirDatosFacturacionInicial(payload)
    );
    if (evaluacionInicial.errores.length > 0) {
        const error = new Error('DATOS_FACTURACION_INVALIDOS');
        error.code = 'DATOS_FACTURACION_INVALIDOS';
        error.statusCode = 400;
        error.detalles = evaluacionInicial.errores;
        throw error;
    }

    const venta = await ventaService.crearVentaDirecta(payload, userContext);
    const snapshot = await obtenerSnapshotOperacion(database, venta.operacionId);
    const datosFacturacion = construirDatosFacturacion(snapshot, payload.tipoComprobante);

    let facturacionGuardada = null;
    try {
        facturacionGuardada = await billingService.guardarFacturacionOperacion(
            venta.operacionId,
            datosFacturacion,
            userContext
        );
        const facturacion = await billingService.emitirFacturacionOperacion(
            venta.operacionId,
            userContext
        );

        return {
            ...venta,
            success: true,
            operacionEstado: 'PAGADO',
            facturacion,
            facturacionEstado: facturacion.estado,
            message: mensajeExito(facturacion)
        };
    } catch (error) {
        const facturacion = error?.detalles?.facturacion || facturacionGuardada;
        const estadoFacturacion = facturacion?.estado || 'NO_CREADA';
        const status = Number(error?.statusCode) || (
            estadoFacturacion === 'RECHAZADO' ? 422 :
            estadoFacturacion === 'ERROR' ? 502 : 409
        );

        return {
            ...venta,
            success: false,
            operacionEstado: 'PAGADO',
            facturacion: facturacion || null,
            facturacionEstado: estadoFacturacion,
            httpStatus: status,
            message: mensajeError(error, facturacion),
            detalles: {
                ...(error?.detalles || {}),
                operacionId: venta.operacionId,
                ventaRegistrada: true
            },
            error: {
                codigo: error?.code || error?.message || 'FACTURACION_ERROR',
                detalles: error?.detalles || null
            }
        };
    }
};

module.exports = {
    crearVentaDirectaYEmitir
};
