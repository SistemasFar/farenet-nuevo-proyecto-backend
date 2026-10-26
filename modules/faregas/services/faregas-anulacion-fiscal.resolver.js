/**
 * Resolvedor fiscal de anulaciones FAREGAS.
 *
 * Decide la operación tributaria aplicable a un comprobante a partir de:
 * tipo de comprobante, estado real del proveedor, evidencia de CDR/resumen
 * diario, fecha de emisión, plazo legal, operaciones correctivas previas y
 * estado local. No ejecuta llamadas al proveedor ni modifica registros.
 *
 * La decisión es deliberadamente conservadora: si no existe evidencia
 * suficiente, devuelve PENDIENTE_VERIFICACION o NO_ELEGIBLE en lugar de
 * inventar una baja o una nota de crédito.
 */

const RESULTADOS = Object.freeze({
    BAJA_ELEGIBLE: 'BAJA_ELEGIBLE',
    NOTA_CREDITO_ELEGIBLE: 'NOTA_CREDITO_ELEGIBLE',
    PENDIENTE_VERIFICACION: 'PENDIENTE_VERIFICACION',
    NO_ELEGIBLE: 'NO_ELEGIBLE',
    YA_ANULADO: 'YA_ANULADO'
});

const OPERACIONES = Object.freeze({
    COMUNICACION_BAJA: 'COMUNICACION_BAJA',
    NOTA_CREDITO: 'NOTA_CREDITO',
    CONSULTAR: 'CONSULTAR',
    NINGUNA: 'NINGUNA'
});

const DIAS_PLAZO_BAJA = 7;
const MS_DIA = 24 * 60 * 60 * 1000;

const TIPOS = Object.freeze({
    FACTURA: { api: 1, permiteNotaCredito: true, requiereCdr: true },
    BOLETA: { api: 2, permiteNotaCredito: true, requiereCdr: false },
    NOTA_CREDITO: { api: 3, permiteNotaCredito: false, requiereCdr: true },
    NOTA_DEBITO: { api: 4, permiteNotaCredito: false, requiereCdr: true }
});

const valor = (objeto, ...claves) => {
    for (const clave of claves) {
        if (objeto && objeto[clave] !== undefined && objeto[clave] !== null && String(objeto[clave]).trim() !== '') {
            return objeto[clave];
        }
    }
    return null;
};

const normalizar = (valorEntrada) => String(valorEntrada || '').trim().toUpperCase();

const normalizarTipoComprobante = (tipo) => {
    const raw = normalizar(tipo);
    if (!raw) return null;
    if (raw.includes('NOTA_CREDITO') || raw.includes('NOTA DE CREDITO') || raw === 'CREDITO' || raw === '3' || raw === '03') {
        return 'NOTA_CREDITO';
    }
    if (raw.includes('NOTA_DEBITO') || raw.includes('NOTA DE DEBITO') || raw === 'DEBITO' || raw === '4' || raw === '04') {
        return 'NOTA_DEBITO';
    }
    if (raw.includes('FACTURA') || raw === '1' || raw === '01') return 'FACTURA';
    if (raw.includes('BOLETA') || raw === '2' || raw === '02') return 'BOLETA';
    return null;
};

const aFecha = (fecha) => {
    if (!fecha) return null;
    const fechaNormalizada = fecha instanceof Date ? fecha : new Date(fecha);
    return Number.isNaN(fechaNormalizada.getTime()) ? null : fechaNormalizada;
};

const finDelDia = (fecha) => {
    const copia = new Date(fecha.getTime());
    copia.setHours(23, 59, 59, 999);
    return copia;
};

const calcularPlazo = (fechaBase, ahora, fuente, override = null) => {
    if (override && typeof override.dentro === 'boolean') {
        const baseOverride = aFecha(override.fechaBase) || fechaBase;
        return {
            dias: DIAS_PLAZO_BAJA,
            fechaBase: baseOverride ? baseOverride.toISOString() : null,
            venceEn: baseOverride
                ? finDelDia(new Date(baseOverride.getTime() + DIAS_PLAZO_BAJA * MS_DIA)).toISOString()
                : null,
            vencido: !override.dentro,
            fuente: override.fuente || fuente
        };
    }
    if (!fechaBase) {
        return {
            dias: DIAS_PLAZO_BAJA,
            fechaBase: null,
            venceEn: null,
            vencido: null,
            fuente
        };
    }
    const venceEn = finDelDia(new Date(fechaBase.getTime() + DIAS_PLAZO_BAJA * MS_DIA));
    return {
        dias: DIAS_PLAZO_BAJA,
        fechaBase: fechaBase.toISOString(),
        venceEn: venceEn.toISOString(),
        vencido: ahora.getTime() > venceEn.getTime(),
        fuente
    };
};

const normalizarResumenDiario = (resumen) => {
    if (!resumen || typeof resumen !== 'object') return null;
    const estado = normalizar(resumen.estado || resumen.estadoProveedor || resumen.sunat_estado);
    const aceptada = resumen.aceptada === true
        || resumen.aceptadaSunat === true
        || estado === 'ACEPTADO'
        || resumen.sunat_responsecode === '0' && estado === 'ACEPTADO';
    const pendiente = ['PENDIENTE', 'PENDIENTE_SUNAT', 'EN_TRAMITE', 'PROCESANDO'].includes(estado);
    const informada = resumen.informada === true
        || resumen.informado === true
        || aceptada
        || pendiente
        || Boolean(resumen.ticket || resumen.ticketSunat || resumen.sunat_ticket_numero);
    return {
        estado: estado || null,
        aceptada,
        pendiente,
        informada,
        fechaAceptacion: aFecha(valor(resumen, 'fechaAceptacion', 'fecha_aceptacion', 'fecha_cdr'))
    };
};

const esOperacionAceptada = (operacion) => (
    operacion?.aceptada === true
    || normalizar(operacion?.estado) === 'ACEPTADO'
);

const esOperacionActiva = (operacion) => {
    const estado = normalizar(operacion?.estado);
    return ['BORRADOR', 'PENDIENTE', 'PENDIENTE_SUNAT', 'EN_TRAMITE', 'PROCESANDO', 'ENVIADO'].includes(estado)
        || (operacion?.ticket && !esOperacionAceptada(operacion));
};

const esOperacionFallida = (operacion) => {
    const estado = normalizar(operacion?.estado);
    return ['RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO', 'TIMEOUT'].includes(estado);
};

const respuesta = ({ resultado, operacion, motivo, tipo, tipoApi, plazo, evidencia, extra = {} }) => ({
    resultado,
    operacion,
    motivo,
    tipoComprobante: tipo,
    tipoComprobanteApi: tipoApi,
    plazo,
    evidencia,
    requiereIntervencion: resultado === RESULTADOS.NO_ELEGIBLE,
    resuelto: resultado === RESULTADOS.YA_ANULADO,
    ...extra
});

const resolverOperacionFiscal = ({
    documento = {},
    estadoProveedor = null,
    fechaEmision = null,
    fechaAceptacion = null,
    resumenDiario = null,
    operacionesPrevias = [],
    totalNotasPrevias = 0,
    plazoBaja = null,
    ahora = new Date()
} = {}) => {
    const tipo = normalizarTipoComprobante(valor(documento, 'tipoComprobante', 'tipo_comprobante', 'tipo'));
    const meta = tipo ? TIPOS[tipo] : null;
    const tipoApi = meta?.api || null;
    const estado = normalizar(estadoProveedor || valor(documento, 'estado', 'estadoProveedor', 'estado_proveedor'));
    const anulado = documento.anulado === true
        || documento.anulado === 'true'
        || documento.respuesta_proveedor?.anulado === true
        || documento.respuestaProveedor?.anulado === true
        || estado === 'ANULADO';
    const aceptadaExplicita = documento.aceptadaSunat === true || documento.aceptada_sunat === true;
    const estadoAceptado = estado === 'ACEPTADO'
        && documento.aceptadaSunat !== false
        && documento.aceptada_sunat !== false;
    const enlaceCdr = valor(documento, 'enlaceCdr', 'enlace_cdr');
    const fechaEmisionDoc = aFecha(fechaEmision || valor(documento, 'fechaEmision', 'fecha_emision', 'fecha_documento', 'fecha_creacion'));
    const fechaAceptacionDoc = aFecha(fechaAceptacion || valor(documento, 'fechaAceptacion', 'fecha_aceptacion', 'fechaCdr', 'fecha_cdr'));
    const cdrAceptado = Boolean(enlaceCdr) || Boolean(fechaAceptacionDoc) || estadoAceptado;
    // Un `aceptada_sunat=true` heredado no debe vencer un estado local
    // PENDIENTE_SUNAT si no existe CDR ni fecha de aceptación. Los registros
    // DEMO pueden conservar ese valor de una sincronización anterior.
    const aceptada = estadoAceptado
        || estado === 'ANULADO'
        || (aceptadaExplicita && cdrAceptado);
    const resumen = normalizarResumenDiario(resumenDiario || valor(documento, 'resumenDiario', 'resumen_diario'));
    const operaciones = Array.isArray(operacionesPrevias) ? operacionesPrevias : [];
    const operacionActiva = operaciones.find(esOperacionActiva) || null;
    const operacionFallida = operaciones.find(esOperacionFallida) || null;
    const bajaAceptada = operaciones.some((operacion) => (
        ['BAJA', 'ANULACION', 'COMUNICACION_BAJA'].includes(normalizar(operacion?.tipo))
        && esOperacionAceptada(operacion)
    ));
    const notaAceptada = operaciones.find((operacion) => (
        ['NOTA_CREDITO', 'CREDITO'].includes(normalizar(operacion?.tipo))
        && esOperacionAceptada(operacion)
    )) || null;
    const totalNotas = Number(totalNotasPrevias || documento.totalNotasPrevias || 0);
    const importeTotal = Number(valor(documento, 'importeTotal', 'importe_total') || 0);
    const notasAgotadas = Boolean(notaAceptada) || (totalNotas > 0 && importeTotal > 0 && totalNotas >= importeTotal - 0.02);
    const tieneIdentidad = Boolean(
        valor(documento, 'nroComprobante', 'nro_comprobante', 'numero')
        && valor(documento, 'serie')
    );

    const evidencia = {
        tipoComprobante: tipo,
        tipoComprobanteApi: tipoApi,
        estadoProveedor: estado || null,
        aceptadaSunat: aceptada,
        cdrAceptado,
        enlaceCdr: enlaceCdr || null,
        fechaEmision: fechaEmisionDoc ? fechaEmisionDoc.toISOString() : null,
        fechaAceptacion: fechaAceptacionDoc ? fechaAceptacionDoc.toISOString() : null,
        resumenDiario: resumen,
        operacionActiva,
        operacionFallida,
        totalNotasPrevias: totalNotas,
        importeTotal
    };

    if (!tipo || !meta) {
        return respuesta({
            resultado: RESULTADOS.NO_ELEGIBLE,
            operacion: OPERACIONES.NINGUNA,
            motivo: 'El tipo de comprobante no es compatible con las operaciones de anulación soportadas por NubeFact.',
            tipo,
            tipoApi,
            plazo: null,
            evidencia
        });
    }

    if (anulado || bajaAceptada || notasAgotadas) {
        return respuesta({
            resultado: RESULTADOS.YA_ANULADO,
            operacion: bajaAceptada ? OPERACIONES.COMUNICACION_BAJA : OPERACIONES.NOTA_CREDITO,
            motivo: bajaAceptada
                ? 'La comunicación de baja ya fue aceptada; el comprobante está anulado.'
                : 'El comprobante ya fue corregido con una nota de crédito total aceptada.',
            tipo,
            tipoApi,
            plazo: null,
            evidencia,
            extra: {
                notaId: notaAceptada ? Number(notaAceptada.id) : null,
                nroComprobante: notaAceptada?.nroComprobante || notaAceptada?.nro_comprobante || null
            }
        });
    }

    if (operacionActiva) {
        return respuesta({
            resultado: RESULTADOS.PENDIENTE_VERIFICACION,
            operacion: OPERACIONES.CONSULTAR,
            motivo: 'Existe una operación fiscal previa en trámite o con ticket pendiente. Debe consultarse el mismo registro antes de enviar otra operación.',
            tipo,
            tipoApi,
            plazo: null,
            evidencia,
            extra: { siguientePaso: 'CONSULTAR_OPERACION_EXISTENTE', operacionId: operacionActiva.id || null }
        });
    }

    if (operacionFallida) {
        return respuesta({
            resultado: RESULTADOS.PENDIENTE_VERIFICACION,
            operacion: OPERACIONES.NINGUNA,
            motivo: 'Existe una operación fiscal previa rechazada o con error. Debe revisarse o reintentarse el mismo registro para evitar duplicados.',
            tipo,
            tipoApi,
            plazo: null,
            evidencia,
            extra: {
                siguientePaso: 'REVISAR_O_REINTENTAR_MISMO_REGISTRO',
                operacionId: operacionFallida.id || null,
                reintentarMismoRegistro: true
            }
        });
    }

    if (['RECHAZADO', 'REJECTED', 'ERROR_DEFINITIVO'].includes(estado)) {
        return respuesta({
            resultado: RESULTADOS.NO_ELEGIBLE,
            operacion: OPERACIONES.NINGUNA,
            motivo: 'El comprobante fue rechazado por SUNAT o el proveedor; no admite baja ni nota de crédito.',
            tipo,
            tipoApi,
            plazo: null,
            evidencia
        });
    }

    if (!tieneIdentidad) {
        return respuesta({
            resultado: RESULTADOS.NO_ELEGIBLE,
            operacion: OPERACIONES.NINGUNA,
            motivo: 'El comprobante no reúne las condiciones tributarias operables (serie, número o identidad incompletos). Requiere intervención de Sistemas.',
            tipo,
            tipoApi,
            plazo: null,
            evidencia
        });
    }

    if (tipo === 'FACTURA') {
        if (!aceptada && !cdrAceptado) {
            return respuesta({
                resultado: RESULTADOS.PENDIENTE_VERIFICACION,
                operacion: OPERACIONES.CONSULTAR,
                motivo: 'La factura no tiene CDR aceptado. La comunicación de baja exige un comprobante previamente aceptado por SUNAT; primero debe confirmarse el CDR.',
                tipo,
                tipoApi,
                plazo: calcularPlazo(fechaEmisionDoc, ahora, 'EMISION', plazoBaja),
                evidencia,
                extra: { siguientePaso: 'ESPERAR_CDR' }
            });
        }
        const plazo = calcularPlazo(fechaAceptacionDoc || fechaEmisionDoc, ahora, fechaAceptacionDoc ? 'CDR' : 'DOCUMENTO', plazoBaja);
        if (plazo.vencido === false) {
            return respuesta({
                resultado: RESULTADOS.BAJA_ELEGIBLE,
                operacion: OPERACIONES.COMUNICACION_BAJA,
                motivo: 'Factura aceptada dentro del plazo legal de comunicación de baja.',
                tipo,
                tipoApi,
                plazo,
                evidencia
            });
        }
        if (plazo.vencido === null) {
            return respuesta({
                resultado: RESULTADOS.PENDIENTE_VERIFICACION,
                operacion: OPERACIONES.CONSULTAR,
                motivo: 'No se pudo determinar la fecha de aceptación/CDR de la factura; no se puede calcular el plazo de baja.',
                tipo,
                tipoApi,
                plazo,
                evidencia,
                extra: { siguientePaso: 'CONSULTAR_FECHA_CDR' }
            });
        }
        return respuesta({
            resultado: RESULTADOS.NOTA_CREDITO_ELEGIBLE,
            operacion: OPERACIONES.NOTA_CREDITO,
            motivo: 'La factura está aceptada pero fuera del plazo de comunicación de baja; corresponde una nota de crédito total.',
            tipo,
            tipoApi,
            plazo,
            evidencia
        });
    }

    if (tipo === 'BOLETA') {
        const informada = resumen?.informada === true;
        const resumenPendiente = resumen?.pendiente === true && !resumen?.aceptada;
        const fechaBaseBoleta = fechaAceptacionDoc || fechaEmisionDoc;
        const fuenteBoleta = fechaAceptacionDoc ? 'CDR' : 'EMISION';
        const plazo = calcularPlazo(fechaBaseBoleta, ahora, fuenteBoleta, plazoBaja);

        if (resumenPendiente) {
            return respuesta({
                resultado: RESULTADOS.PENDIENTE_VERIFICACION,
                operacion: OPERACIONES.CONSULTAR,
                motivo: 'La boleta está incluida en un resumen diario pendiente de aceptación. Debe esperarse el CDR del resumen antes de decidir la baja.',
                tipo,
                tipoApi,
                plazo,
                evidencia,
                extra: { siguientePaso: 'ESPERAR_CDR_RESUMEN' }
            });
        }

        if (aceptada || cdrAceptado) {
            if (plazo.vencido === false) {
                return respuesta({
                    resultado: RESULTADOS.BAJA_ELEGIBLE,
                    operacion: OPERACIONES.COMUNICACION_BAJA,
                    motivo: 'Boleta informada/aceptada dentro del plazo legal de comunicación de baja.',
                    tipo,
                    tipoApi,
                    plazo,
                    evidencia
                });
            }
            if (plazo.vencido === null) {
                return respuesta({
                    resultado: RESULTADOS.PENDIENTE_VERIFICACION,
                    operacion: OPERACIONES.CONSULTAR,
                    motivo: 'No se pudo determinar la fecha de aceptación/CDR de la boleta; no se puede calcular el plazo de baja.',
                    tipo,
                    tipoApi,
                    plazo,
                    evidencia,
                    extra: { siguientePaso: 'CONSULTAR_FECHA_CDR' }
                });
            }
            return respuesta({
                resultado: RESULTADOS.NOTA_CREDITO_ELEGIBLE,
                operacion: OPERACIONES.NOTA_CREDITO,
                motivo: 'La boleta está aceptada/informada pero fuera del plazo de comunicación de baja; corresponde una nota de crédito total.',
                tipo,
                tipoApi,
                plazo,
                evidencia
            });
        }

        // Boleta aún no informada: SUNAT permite comunicar la baja dentro de
        // los 7 días calendario desde la emisión. NubeFact encola la baja hasta
        // que el comprobante sea aceptado. Si el plazo ya venció no hay
        // evidencia suficiente para saber si fue informada o si el CDR extendió
        // el plazo; se exige verificación en lugar de emitir una nota a ciegas.
        if (!informada && plazo.vencido === false) {
            return respuesta({
                resultado: RESULTADOS.BAJA_ELEGIBLE,
                operacion: OPERACIONES.COMUNICACION_BAJA,
                motivo: 'Boleta no informada pendiente de SUNAT dentro del plazo legal; NubeFact puede encolar la comunicación de baja.',
                tipo,
                tipoApi,
                plazo,
                evidencia,
                extra: { requiereSeguimientoTicket: true }
            });
        }

        return respuesta({
            resultado: RESULTADOS.PENDIENTE_VERIFICACION,
            operacion: OPERACIONES.CONSULTAR,
            motivo: 'No se puede determinar con certeza si la boleta fue informada en un resumen diario o si su CDR extendió el plazo. Debe verificarse el resumen/CDR antes de operar.',
            tipo,
            tipoApi,
            plazo,
            evidencia,
            extra: { siguientePaso: 'CONSULTAR_RESUMEN_DIARIO_O_CDR' }
        });
    }

    // Notas de crédito y débito: la API de NubeFact permite baja por tipo 3/4.
    // Exigen CDR aceptado y el mismo plazo legal; fuera de plazo no se puede
    // emitir otra nota de crédito sobre la propia nota.
    if (!aceptada && !cdrAceptado) {
        return respuesta({
            resultado: RESULTADOS.PENDIENTE_VERIFICACION,
            operacion: OPERACIONES.CONSULTAR,
            motivo: `${tipo === 'NOTA_CREDITO' ? 'La nota de crédito' : 'La nota de débito'} no tiene CDR aceptado; primero debe confirmarse su aceptación por SUNAT.`,
            tipo,
            tipoApi,
            plazo: calcularPlazo(fechaEmisionDoc, ahora, 'EMISION', plazoBaja),
            evidencia,
            extra: { siguientePaso: 'ESPERAR_CDR' }
        });
    }

    const plazoNota = calcularPlazo(fechaAceptacionDoc || fechaEmisionDoc, ahora, fechaAceptacionDoc ? 'CDR' : 'DOCUMENTO', plazoBaja);
    if (plazoNota.vencido === false) {
        return respuesta({
            resultado: RESULTADOS.BAJA_ELEGIBLE,
            operacion: OPERACIONES.COMUNICACION_BAJA,
            motivo: `${tipo === 'NOTA_CREDITO' ? 'La nota de crédito' : 'La nota de débito'} está aceptada dentro del plazo legal de baja.`,
            tipo,
            tipoApi,
            plazo: plazoNota,
            evidencia
        });
    }
    if (plazoNota.vencido === null) {
        return respuesta({
            resultado: RESULTADOS.PENDIENTE_VERIFICACION,
            operacion: OPERACIONES.CONSULTAR,
            motivo: 'No se pudo determinar la fecha de aceptación/CDR de la nota; no se puede calcular el plazo de baja.',
            tipo,
            tipoApi,
            plazo: plazoNota,
            evidencia,
            extra: { siguientePaso: 'CONSULTAR_FECHA_CDR' }
        });
    }
    return respuesta({
        resultado: RESULTADOS.NO_ELEGIBLE,
        operacion: OPERACIONES.NINGUNA,
        motivo: 'La nota está fuera del plazo legal de baja y no admite otra nota de crédito sobre sí misma. Requiere intervención fiscal.',
        tipo,
        tipoApi,
        plazo: plazoNota,
        evidencia
    });
};

module.exports = {
    RESULTADOS,
    OPERACIONES,
    DIAS_PLAZO_BAJA,
    resolverOperacionFiscal,
    normalizarTipoComprobante,
    calcularPlazo
};
