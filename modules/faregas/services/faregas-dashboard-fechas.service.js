/**
 * Módulo de validación de límites temporales para el Dashboard de FAREGAS.
 * Restricción obligatoria: máximo un mes calendario por consulta.
 * Zona horaria: America/Lima (UTC-5).
 */

const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Retorna la cantidad de días de un mes y año dados en calendario gregoriano.
 * month: 1 a 12.
 */
function obtenerDiasEnMes(year, month) {
    // En JS Date.UTC(year, month, 0) retorna el último día del mes 'month' (1-indexed)
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Calcula la fecha máxima permitida (formato YYYY-MM-DD) para un valor 'desde'.
 * Regla: "la fecha inmediatamente anterior a sumar un mes calendario a la fecha inicial,
 * con el tratamiento adecuado de finales de mes. Las consultas de meses completos deben estar permitidas."
 *
 * Ejemplos:
 * - 2026-09-01 -> 2026-09-30 (mes completo de 30 días)
 * - 2026-10-01 -> 2026-10-31 (mes completo de 31 días)
 * - 2026-09-17 -> 2026-10-16 (un mes exacto día 17 a 16)
 * - 2026-02-01 -> 2026-02-28 (mes no bisiesto)
 * - 2028-02-01 -> 2028-02-29 (mes bisiesto)
 */
function calcularFechaMaximaPermitida(desdeStr) {
    if (!desdeStr || typeof desdeStr !== 'string' || !REGEX_FECHA.test(desdeStr)) {
        return null;
    }

    const [yStr, mStr, dStr] = desdeStr.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const d = parseInt(dStr, 10);

    if (m < 1 || m > 12 || d < 1) return null;

    const diasMesActual = obtenerDiasEnMes(y, m);
    if (d > diasMesActual) return null;

    // Sumar 1 mes calendario
    const nextYear = m === 12 ? y + 1 : y;
    const nextMonth = m === 12 ? 1 : m + 1;
    const diasMesSiguiente = obtenerDiasEnMes(nextYear, nextMonth);

    // Tratamiento de fin de mes: si el día supera los días del mes siguiente, se ajusta al último día
    const targetDay = Math.min(d, diasMesSiguiente);

    // Fecha 1 mes después
    const fechaMasUnMes = new Date(Date.UTC(nextYear, nextMonth - 1, targetDay, 12, 0, 0));

    // Fecha inmediatamente anterior (restar 1 día exacto de 24h)
    const fechaMaxima = new Date(fechaMasUnMes.getTime() - 24 * 60 * 60 * 1000);

    const rY = fechaMaxima.getUTCFullYear();
    const rM = String(fechaMaxima.getUTCMonth() + 1).padStart(2, '0');
    const rD = String(fechaMaxima.getUTCDate()).padStart(2, '0');

    return `${rY}-${rM}-${rD}`;
}

/**
 * Valida un rango [desde, hasta] para el Dashboard de FAREGAS.
 * Retorna { valido: boolean, codigo?: string, mensaje?: string, fechaMaximaPermitida?: string }
 */
function validarRangoFechasDashboard(desdeStr, hastaStr) {
    if (!desdeStr || typeof desdeStr !== 'string' || !REGEX_FECHA.test(desdeStr)) {
        return {
            valido: false,
            codigo: 'FORMATO_FECHAS_INVALIDO',
            mensaje: 'El parámetro "desde" debe tener formato YYYY-MM-DD válido.'
        };
    }

    if (!hastaStr || typeof hastaStr !== 'string' || !REGEX_FECHA.test(hastaStr)) {
        return {
            valido: false,
            codigo: 'FORMATO_FECHAS_INVALIDO',
            mensaje: 'El parámetro "hasta" debe tener formato YYYY-MM-DD válido.'
        };
    }

    const [y1, m1, d1] = desdeStr.split('-').map(Number);
    const [y2, m2, d2] = hastaStr.split('-').map(Number);

    if (m1 < 1 || m1 > 12 || d1 < 1 || d1 > obtenerDiasEnMes(y1, m1)) {
        return {
            valido: false,
            codigo: 'FECHA_INEXISTENTE',
            mensaje: `La fecha inicial "${desdeStr}" no existe en el calendario.`
        };
    }

    if (m2 < 1 || m2 > 12 || d2 < 1 || d2 > obtenerDiasEnMes(y2, m2)) {
        return {
            valido: false,
            codigo: 'FECHA_INEXISTENTE',
            mensaje: `La fecha final "${hastaStr}" no existe en el calendario.`
        };
    }

    // Cronología: la fecha final no puede ser anterior a la inicial
    if (hastaStr < desdeStr) {
        return {
            valido: false,
            codigo: 'RANGO_FECHAS_INVALIDO',
            mensaje: 'La fecha final no puede ser anterior a la fecha inicial.'
        };
    }

    // Límite máximo: máximo un mes calendario
    const fechaMaxima = calcularFechaMaximaPermitida(desdeStr);
    if (!fechaMaxima) {
        return {
            valido: false,
            codigo: 'ERROR_CALCULO_FECHAS',
            mensaje: 'No se pudo calcular el período máximo permitido para la fecha inicial.'
        };
    }

    if (hastaStr > fechaMaxima) {
        return {
            valido: false,
            codigo: 'RANGO_FECHAS_EXCEDIDO',
            mensaje: 'El período máximo permitido es de un mes. Selecciona un rango de fechas más corto.',
            fechaMaximaPermitida: fechaMaxima
        };
    }

    return {
        valido: true,
        fechaMaximaPermitida: fechaMaxima
    };
}

/**
 * Obtiene la fecha actual en la zona horaria de Perú (America/Lima) en formato YYYY-MM-DD.
 */
function obtenerFechaHoyLima() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(new Date());
}

/**
 * Middleware para rutas de Express del Dashboard FAREGAS.
 * Bloquea cualquier petición HTTP que intente consultar o exportar un rango mayor a un mes.
 */
function middlewareValidarRangoFechasDashboard(req, res, next) {
    let { desde, hasta } = req.query;

    // Si no se proporcionaron fechas, se asigna el rango por defecto seguro (hoy a hoy o últimos 30 días)
    if (!desde && !hasta) {
        // En ausencia de parámetros, se permite continuar y el servicio usará su intervalo por defecto
        return next();
    }

    // Si viene solo una de las dos fechas, se empareja para mantener un rango válido de 1 día
    if (desde && !hasta) {
        hasta = desde;
        req.query.hasta = desde;
    } else if (!desde && hasta) {
        desde = hasta;
        req.query.desde = hasta;
    }

    const resultado = validarRangoFechasDashboard(desde, hasta);

    if (!resultado.valido) {
        return res.status(400).json({
            success: false,
            codigo: resultado.codigo,
            message: resultado.mensaje,
            fechaMaximaPermitida: resultado.fechaMaximaPermitida
        });
    }

    next();
}

module.exports = {
    obtenerDiasEnMes,
    calcularFechaMaximaPermitida,
    validarRangoFechasDashboard,
    obtenerFechaHoyLima,
    middlewareValidarRangoFechasDashboard
};
