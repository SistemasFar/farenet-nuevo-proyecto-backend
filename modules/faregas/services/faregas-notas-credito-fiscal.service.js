const {
    normalizarMotivoNotaCredito,
    esMotivoCorreccionDescripcion
} = require('./faregas-notas-credito.constants');

const errorFiscal = (code, statusCode = 409, detalles) => {
    const error = new Error(code);
    error.code = code;
    error.statusCode = statusCode;
    if (detalles !== undefined) error.detalles = detalles;
    return error;
};

const dosDecimales = (valor) => Math.round((Number(valor || 0) + Number.EPSILON) * 100) / 100;

const numeroFiscal = (valor, campo, { permitirCero = true } = {}) => {
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero < 0 || (!permitirCero && numero === 0)) {
        throw errorFiscal('SNAPSHOT_FISCAL_INCOMPLETO', 409, { campo });
    }
    return dosDecimales(numero);
};

const clonar = (valor) => JSON.parse(JSON.stringify(valor));

const validarFechaDocumentoOriginal = (valor) => {
    if (valor instanceof Date) {
        if (Number.isNaN(valor.getTime())) throw errorFiscal('FECHA_EMISION_ORIGINAL_INVALIDA');
        return validarFechaDocumentoOriginal(valor.toISOString().slice(0, 10));
    }
    const texto = String(valor || '').trim();
    const match = texto.match(/^(\d{2})-(\d{2})-(\d{4})$/)
        || texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) throw errorFiscal('FECHA_EMISION_ORIGINAL_INVALIDA');

    const fecha = texto.match(/^\d{4}/)
        ? new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`)
        : new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00Z`);
    if (Number.isNaN(fecha.getTime())) throw errorFiscal('FECHA_EMISION_ORIGINAL_INVALIDA');
    const [anio, mes, dia] = texto.match(/^\d{4}/)
        ? [Number(match[1]), Number(match[2]), Number(match[3])]
        : [Number(match[3]), Number(match[2]), Number(match[1])];
    if (fecha.getUTCFullYear() !== anio
        || fecha.getUTCMonth() + 1 !== mes
        || fecha.getUTCDate() !== dia) {
        throw errorFiscal('FECHA_EMISION_ORIGINAL_INVALIDA');
    }

    const manana = new Date();
    manana.setUTCHours(0, 0, 0, 0);
    manana.setUTCDate(manana.getUTCDate() + 1);
    if (fecha >= manana) throw errorFiscal('FECHA_EMISION_ORIGINAL_INVALIDA');
    return texto;
};

const normalizarItemSnapshot = (item, indice) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw errorFiscal('SNAPSHOT_FISCAL_INCOMPLETO', 409, { campo: `items[${indice}]` });
    }
    const unidad = String(item.unidad_de_medida || '').trim();
    const descripcion = String(item.descripcion || '').trim();
    const cantidad = Number(item.cantidad);
    const tipoIgv = Number(item.tipo_de_igv);
    if (!unidad || !descripcion || !Number.isFinite(cantidad) || cantidad <= 0
        || !Number.isInteger(tipoIgv) || tipoIgv <= 0) {
        throw errorFiscal('SNAPSHOT_FISCAL_INCOMPLETO', 409, { campo: `items[${indice}]` });
    }

    return {
        ...clonar(item),
        unidad_de_medida: unidad,
        codigo: String(item.codigo || '').trim(),
        descripcion,
        cantidad,
        valor_unitario: numeroFiscal(item.valor_unitario, `items[${indice}].valor_unitario`),
        precio_unitario: numeroFiscal(item.precio_unitario, `items[${indice}].precio_unitario`),
        descuento: numeroFiscal(item.descuento || 0, `items[${indice}].descuento`),
        subtotal: numeroFiscal(item.subtotal, `items[${indice}].subtotal`),
        tipo_de_igv: tipoIgv,
        igv: numeroFiscal(item.igv, `items[${indice}].igv`),
        total: numeroFiscal(item.total, `items[${indice}].total`)
    };
};

const normalizarSnapshotFiscal = (snapshot, facturacion = {}) => {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw errorFiscal('SNAPSHOT_FISCAL_NO_ENCONTRADO', 409);
    }
    if (!Array.isArray(snapshot.items) || snapshot.items.length === 0) {
        throw errorFiscal('SNAPSHOT_FISCAL_INCOMPLETO', 409, { campo: 'items' });
    }

    const tipoEsperado = String(facturacion.tipo_comprobante || '').toUpperCase() === 'FACTURA' ? 1 : 2;
    const tipoOriginal = Number(snapshot.tipo_de_comprobante);
    const serieOriginal = String(snapshot.serie || '').trim().toUpperCase();
    const numeroOriginal = Number(snapshot.numero);
    const clienteTipoDocumento = Number(snapshot.cliente_tipo_de_documento);
    const clienteNumeroDocumento = String(snapshot.cliente_numero_de_documento || '').trim();
    const clienteDenominacion = String(snapshot.cliente_denominacion || '').trim();
    const moneda = Number(snapshot.moneda);
    if (tipoOriginal !== tipoEsperado
        || !serieOriginal
        || !Number.isSafeInteger(numeroOriginal)
        || numeroOriginal <= 0
        || (facturacion.serie && serieOriginal !== String(facturacion.serie).trim().toUpperCase())
        || (facturacion.numero != null && numeroOriginal !== Number(facturacion.numero))) {
        throw errorFiscal('SNAPSHOT_FISCAL_NO_CORRESPONDE', 409);
    }
    if (!Number.isInteger(clienteTipoDocumento) || clienteTipoDocumento < 0
        || !clienteNumeroDocumento || !clienteDenominacion
        || !Number.isInteger(moneda) || moneda <= 0) {
        throw errorFiscal('SNAPSHOT_FISCAL_INCOMPLETO', 409, { campo: 'cliente_o_moneda' });
    }

    const total = numeroFiscal(snapshot.total, 'total', { permitirCero: false });
    const totalGravada = numeroFiscal(snapshot.total_gravada || 0, 'total_gravada');
    const totalInafecta = numeroFiscal(snapshot.total_inafecta || 0, 'total_inafecta');
    const totalExonerada = numeroFiscal(snapshot.total_exonerada || 0, 'total_exonerada');
    const totalIgv = numeroFiscal(snapshot.total_igv || 0, 'total_igv');
    const totalOtrosCargos = numeroFiscal(snapshot.total_otros_cargos || 0, 'total_otros_cargos');
    const totalDescuento = numeroFiscal(snapshot.total_descuento || 0, 'total_descuento');
    const totalGratuita = numeroFiscal(snapshot.total_gratuita || 0, 'total_gratuita');
    const totalCalculado = dosDecimales(totalGravada + totalInafecta + totalExonerada + totalIgv + totalOtrosCargos);
    if (Math.abs(totalCalculado - total) > 0.02) {
        throw errorFiscal('SNAPSHOT_FISCAL_TOTALES_INCONSISTENTES', 409, {
            total,
            totalCalculado
        });
    }

    return {
        ...clonar(snapshot),
        tipo_de_comprobante: tipoOriginal,
        serie: serieOriginal,
        numero: numeroOriginal,
        cliente_tipo_de_documento: clienteTipoDocumento,
        cliente_numero_de_documento: clienteNumeroDocumento,
        cliente_denominacion: clienteDenominacion,
        moneda,
        fecha_de_emision: validarFechaDocumentoOriginal(
            snapshot.fecha_de_emision || facturacion.fecha_documento
        ),
        total_descuento: totalDescuento,
        total_gravada: totalGravada,
        total_inafecta: totalInafecta,
        total_exonerada: totalExonerada,
        total_igv: totalIgv,
        total_gratuita: totalGratuita,
        total_otros_cargos: totalOtrosCargos,
        total,
        items: snapshot.items.map(normalizarItemSnapshot)
    };
};

const obtenerSnapshotFiscalOriginal = async (executor, facturacion) => {
    const result = await executor.query(`
        SELECT solicitud, estado, numero_intento, fecha_creacion
        FROM fg_facturacion_intento
        WHERE facturacion_id = $1
          AND solicitud IS NOT NULL
        ORDER BY (estado IN ('ACEPTADO', 'PENDIENTE_SUNAT')) DESC,
                 numero_intento DESC,
                 id DESC
        LIMIT 1
    `, [facturacion.id]);
    if (result.rowCount === 0) throw errorFiscal('SNAPSHOT_FISCAL_NO_ENCONTRADO', 409);
    return normalizarSnapshotFiscal(result.rows[0].solicitud, facturacion);
};

const derivarDatosNotaCredito = ({ snapshot, motivoCodigo, sustento, itemIndice, descripcionCorregida }) => {
    const codigo = normalizarMotivoNotaCredito(motivoCodigo);
    if (!codigo) throw errorFiscal('MOTIVO_NOTA_CREDITO_NO_PERMITIDO_O_INVALIDO', 400);
    const textoSustento = String(sustento || '').trim();
    if (!textoSustento || textoSustento.length > 250) {
        throw errorFiscal('SUSTENTO_NOTA_INVALIDO', 400);
    }

    const fiscal = normalizarSnapshotFiscal(snapshot, {
        tipo_comprobante: Number(snapshot.tipo_de_comprobante) === 1 ? 'FACTURA' : 'BOLETA',
        serie: snapshot.serie,
        numero: snapshot.numero,
        fecha_documento: snapshot.fecha_de_emision
    });
    const items = fiscal.items.map(clonar);
    let descripcionFinal = null;
    let indiceFinal = null;

    if (esMotivoCorreccionDescripcion(codigo)) {
        descripcionFinal = String(descripcionCorregida || textoSustento).trim();
        if (descripcionFinal.length < 5 || descripcionFinal.length > 250
            || descripcionFinal.toUpperCase() === 'CORRECCION DE DESCRIPCION'
            || descripcionFinal.toUpperCase() === 'CORRECCIÓN DE DESCRIPCIÓN') {
            throw errorFiscal('DESCRIPCION_CORREGIDA_INVALIDA', 400);
        }
        if (itemIndice === undefined || itemIndice === null || itemIndice === '') {
            if (items.length !== 1) throw errorFiscal('ITEM_CORRECCION_REQUERIDO', 400);
            indiceFinal = 0;
        } else {
            indiceFinal = Number(itemIndice);
            if (!Number.isInteger(indiceFinal) || indiceFinal < 0 || indiceFinal >= items.length) {
                throw errorFiscal('ITEM_CORRECCION_INVALIDO', 400);
            }
        }
        items[indiceFinal] = { ...items[indiceFinal], descripcion: descripcionFinal };
    }

    return {
        motivoCodigo: codigo,
        // fg_credito no posee una columna separada para la descripción nueva.
        // En motivo 03 se persiste la descripción corregida como sustento fiscal
        // para que el reintento reconstruya exactamente el mismo documento.
        sustento: descripcionFinal || textoSustento,
        descripcionCorregida: descripcionFinal,
        itemIndice: indiceFinal,
        baseImponible: fiscal.total_gravada,
        igv: fiscal.total_igv,
        importeTotal: fiscal.total,
        snapshotFiscal: fiscal,
        items
    };
};

module.exports = {
    obtenerSnapshotFiscalOriginal,
    normalizarSnapshotFiscal,
    derivarDatosNotaCredito,
    validarFechaDocumentoOriginal,
    _private: { numeroFiscal, normalizarItemSnapshot, dosDecimales, errorFiscal }
};
