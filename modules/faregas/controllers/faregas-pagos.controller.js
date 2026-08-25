const pagosService = require('../services/faregas-pagos.service');

const responderError = (res, error) => {
    const errores = {
        CERTIFICADO_NOT_FOUND: [404, 'El certificado indicado no existe.'],
        PLANTA_NO_AUTORIZADA: [403, 'No tiene acceso a la planta de este certificado.'],
        CERTIFICADO_NO_EDITABLE: [409, 'El certificado ya no se encuentra en estado BORRADOR.'],
        IMPORTE_TOTAL_INVALIDO: [400, 'El importe total de la orden no puede ser negativo.'],
        TARIFA_NO_CONFIGURADA: [409, 'No existe una tarifa válida configurada para este certificado.'],
        SERVICIO_NO_CERTIFICACION: [409, 'La tarifa pertenece a un servicio que no genera certificados.'],
        TARIFA_NO_COINCIDE: [409, 'El importe enviado no coincide con la tarifa configurada en el servidor.'],
        IMPORTE_ORDEN_NO_MODIFICABLE: [409, 'El importe total de una orden existente no puede modificarse.'],
        TIPO_PAGO_INVALIDO: [400, 'El medio de pago indicado no es válido.'],
        IMPORTE_PAGO_INVALIDO: [400, 'Todos los pagos deben tener un importe mayor a cero.'],
        PAGO_EXCEDE_TOTAL: [409, 'La suma de pagos excede el total de la orden.'],
        DATOS_TARJETA_INCOMPLETOS: [400, 'Complete tarjeta y número de operación.'],
        TARJETA_NOT_FOUND: [404, 'La tarjeta seleccionada no existe.'],
        DIGITOS_TARJETA_INVALIDOS: [400, 'Ingrese los últimos cuatro dígitos de la tarjeta.'],
        OPERACION_CUPONIDAD_INVALIDA: [400, 'La operación Cuponidad debe tener exactamente 10 caracteres.'],
        OPERACION_BILLETERA_INVALIDA: [400, 'La operación Yape/Plin debe tener entre 4 y 10 dígitos.'],
        DATOS_BANCO_INCOMPLETOS: [400, 'Complete banco, cuenta, operación y fecha de depósito.'],
        CUENTA_BANCARIA_INVALIDA: [400, 'La cuenta no pertenece a la entidad financiera seleccionada.'],
        FECHA_DEPOSITO_INVALIDA: [400, 'La fecha de depósito no es válida.'],
        FECHA_DEPOSITO_FUTURA: [400, 'La fecha de depósito no puede ser posterior a hoy.'],
    };
    const [status, message] = errores[error.message] || [500, ('Error interno al procesar los pagos: ' + (error.message || error.toString()))];
    if (status === 500) console.error('Error FAREGAS pagos:', error);
    return res.status(status).json({ ok: false, message, code: error.message });
};

exports.obtenerPagos = async (req, res) => {
    try {
        const data = await pagosService.obtenerPagos(req.params.id, req.user);
        return res.status(200).json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.guardarPagos = async (req, res) => {
    try {
        if (!Array.isArray(req.body.pagos)) {
            return res.status(400).json({ ok: false, message: 'pagos debe ser un arreglo.', code: 'PAGOS_INVALIDOS' });
        }
        const data = await pagosService.guardarPagos(req.params.id, req.body, req.user);
        return res.status(200).json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};
