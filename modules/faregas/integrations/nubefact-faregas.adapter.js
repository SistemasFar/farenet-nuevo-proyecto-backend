const config = require('../../../config/integrations.config');
const { construirInformacionAdicional } = require('./nubefact-faregas-informacion-adicional');
const { esGratuidadTallerAutorizada, esFlujoTaller } = require('../services/faregas-gratuidad-taller.policy');
const { evaluarDetraccion, CAT_SPOT, CAT_SPOT_BIENES } = require('../services/faregas-detracciones.service');

const dosDecimales = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const formatearFechaReferencia = (valor) => {
    if (!valor) return null;
    let dia, mes, anio;
    if (valor instanceof Date) {
        if (Number.isNaN(valor.getTime())) return null;
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Lima',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).formatToParts(valor);
        const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
        dia = Number(map.day);
        mes = Number(map.month);
        anio = Number(map.year);
    } else {
        const str = String(valor).trim();
        const matchSlash = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (matchSlash) {
            dia = Number(matchSlash[1]);
            mes = Number(matchSlash[2]);
            anio = Number(matchSlash[3]);
        } else {
            const matchDMY = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
            if (matchDMY) {
                dia = Number(matchDMY[1]);
                mes = Number(matchDMY[2]);
                anio = Number(matchDMY[3]);
            } else {
                const matchYMD = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (matchYMD) {
                    anio = Number(matchYMD[1]);
                    mes = Number(matchYMD[2]);
                    dia = Number(matchYMD[3]);
                } else {
                    return null;
                }
            }
        }
    }
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || anio < 2000 || anio > 2100) {
        return null;
    }
    const d = new Date(Date.UTC(anio, mes - 1, dia));
    if (d.getUTCFullYear() !== anio || d.getUTCMonth() + 1 !== mes || d.getUTCDate() !== dia) {
        return null;
    }
    const manana = new Date();
    manana.setUTCHours(0, 0, 0, 0);
    manana.setUTCDate(manana.getUTCDate() + 1);
    if (d >= manana) {
        return null;
    }
    return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
};

const yaContieneReferencia = (texto, serie, numero) => {
    if (!texto || typeof texto !== 'string') return false;
    const clean = texto.toUpperCase();
    if (!clean.includes('DOC. MODIFICA')) return false;
    const num = Number(numero);
    const tokenNum = `${serie}-${num}`.toUpperCase();
    const tokenPad = `${serie}-${String(num).padStart(8, '0')}`.toUpperCase();
    const tokenRaw = `${serie}-${numero}`.toUpperCase();
    return clean.includes(tokenNum) || clean.includes(tokenPad) || clean.includes(tokenRaw);
};

const combinarObservacionesNota = ({ sustento = '', tipoTexto = '', serie = '', numero = '', fechaRef = '' }) => {
    const ref = `DOC. MODIFICA: ${tipoTexto} ${serie}-${numero} DEL ${fechaRef}`.trim();
    const sust = String(sustento || '').trim();

    if (!ref || !fechaRef) {
        return sust.slice(0, 250);
    }

    if (yaContieneReferencia(sust, serie, numero)) {
        return sust.slice(0, 250);
    }

    if (!sust) {
        return ref.slice(0, 250);
    }

    const separador = ' | ';
    const textoCompleto = `${sust}${separador}${ref}`;
    if (textoCompleto.length <= 250) {
        return textoCompleto;
    }

    const espacioDisponibleSustento = 250 - (separador.length + ref.length);
    if (espacioDisponibleSustento > 10) {
        const sustentoRecortado = sust.slice(0, espacioDisponibleSustento).trimEnd();
        return `${sustentoRecortado}${separador}${ref}`;
    }

    return ref.slice(0, 250);
};

const crearCodigoUnico = (facturacionId, prefijo = 'FG') => {
    const id = Number(facturacionId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('FACTURACION_ID_INVALIDO');
    const codigo = `${String(prefijo || 'FG').trim().toUpperCase()}-${id}`;
    if (codigo.length > 20) throw new Error('CODIGO_UNICO_NUBEFACT_INVALIDO');
    return codigo;
};


const fechaDocumento = (value) => {
    if (!value) return '';
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return '';
        return fechaPeru(value);
    }
    const raw = String(value).trim();
    if (!raw) return '';
    const matchIso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (matchIso) {
        return `${matchIso[3]}-${matchIso[2]}-${matchIso[1]}`;
    }
    const matchPe = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (matchPe) {
        return raw;
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return fechaPeru(parsed);
    }
    return '';
};

const tipoIgvNubefact = (value) => {
    const normalizado = String(value ?? '').trim();
    if (normalizado === '10') return 1;
    if (normalizado === '20') return 8;
    if (normalizado === '30') return 9;
    const numero = Number(normalizado);
    return Number.isInteger(numero) && numero >= 1 && numero <= 20 ? numero : 1;
};

const construirItem = (item) => {
    const codigoProductoSunat = String(
        item.codigo_sunat_snapshot || item.codigo_producto_sunat || ''
    ).trim().slice(0, 8);
    const resultado = {
        unidad_de_medida: String(item.unidad_snapshot || item.unidad_de_medida || 'ZZ').trim().toUpperCase(),
        codigo: String(item.codigo_sku_snapshot || item.codigo || '').trim().slice(0, 250),
        descripcion: String(item.descripcion_snapshot || item.descripcion || '').trim().slice(0, 250),
        cantidad: Number(item.cantidad || 1),
        valor_unitario: dosDecimales(item.valor_unitario),
        precio_unitario: dosDecimales(item.precio_unitario),
        descuento: dosDecimales(item.descuento || 0),
        subtotal: dosDecimales(item.base_imponible ?? item.subtotal),
        tipo_de_igv: tipoIgvNubefact(item.afectacion_igv_snapshot ?? item.tipo_de_igv),
        igv: dosDecimales(item.igv),
        total: dosDecimales(item.importe_total ?? item.total),
        anticipo_regularizacion: false,
        anticipo_documento_serie: '',
        anticipo_documento_numero: ''
    };
    if (codigoProductoSunat) resultado.codigo_producto_sunat = codigoProductoSunat;
    return resultado;
};

// Los descuentos configurados por FAREGAS se aplican al total comercial del
// certificado, no a una línea fiscal concreta. NubeFact distingue ambos casos:
// un descuento por ítem se envía en `items[].descuento`, mientras que el global
// se declara en `descuento_global`. Para este último, la línea debe conservar
// sus importes originales y los totales del documento ya deben reflejar el
// descuento aplicado.
const construirItemAntesDescuentoGlobal = (item) => {
    const resultado = construirItem(item);
    const descuentoLineaSinIgv = dosDecimales(item.descuento || 0);
    if (descuentoLineaSinIgv <= 0) return resultado;

    const cantidad = Number(resultado.cantidad || 1);
    const subtotalOriginal = dosDecimales(resultado.subtotal + descuentoLineaSinIgv);
    const totalOriginal = dosDecimales(resultado.precio_unitario * cantidad);

    return {
        ...resultado,
        descuento: 0,
        subtotal: subtotalOriginal,
        igv: dosDecimales(totalOriginal - subtotalOriginal),
        total: totalOriginal
    };
};

const construirItemGratuito = (item) => {
    const cantidad = Number(item.cantidad || 1);
    const valorReferencialUnitario = dosDecimales(item.precio_unitario);
    const valorReferencialTotal = dosDecimales(valorReferencialUnitario * cantidad);
    return {
        ...construirItem(item),
        valor_unitario: valorReferencialUnitario,
        precio_unitario: valorReferencialUnitario,
        descuento: 0,
        subtotal: valorReferencialTotal,
        tipo_de_igv: 6,
        igv: 0,
        total: valorReferencialTotal
    };
};

const obtenerIndicadorDetraccion = () => {
    const decision = String(config.nubefact.detractionDecision || 'PENDIENTE').trim().toUpperCase();
    return decision === 'APLICA';
};

const fechaPeru = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Lima',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.day}-${values.month}-${values.year}`;
};

const CAMPOS_BINARIOS_PROVEEDOR = new Set([
    'pdf_zip_base64', 'xml_zip_base64', 'cdr_zip_base64',
    'pdf_base64', 'xml_base64', 'cdr_base64'
]);

/**
 * Conserva solamente metadatos útiles de la respuesta del proveedor.
 * La limpieza es recursiva porque algunas operaciones agrupan la emisión y
 * una consulta de recuperación dentro del mismo objeto de auditoría.
 */
const limpiarRespuestaProveedor = (value) => {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) return value.map(limpiarRespuestaProveedor);
    if (typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !CAMPOS_BINARIOS_PROVEEDOR.has(key.toLowerCase()))
            .map(([key, child]) => [key, limpiarRespuestaProveedor(child)])
    );
};

const esResultadoPendiente = (resultado) => ['PENDING_SUNAT', 'PROCESSING'].includes(resultado?.status);

const mapearAceptacionSunat = (resultado) => {
    if (resultado?.status === 'ACCEPTED') return true;
    if (resultado?.status === 'REJECTED') return false;
    return null;
};

/**
 * Traduce el contrato estable del cliente Nubefact a los estados permitidos
 * por cada agregado. Las tablas históricas de notas y anulaciones usan
 * PENDIENTE, mientras la factura distingue PENDIENTE_SUNAT.
 */
const mapearEstadoProveedor = (resultado, destino = 'FACTURACION') => {
    if (resultado?.status === 'ACCEPTED') return 'ACEPTADO';
    if (resultado?.status === 'REJECTED') return 'RECHAZADO';
    if (esResultadoPendiente(resultado)) {
        if (destino === 'OPERACION') return 'PROCESANDO';
        return destino === 'FACTURACION' ? 'PENDIENTE_SUNAT' : 'PENDIENTE';
    }
    return 'ERROR';
};

const construirPayloadNubefact = ({
    facturacion,
    certificado = null,
    vehiculo = null,
    reservaDescuento = null,
    detalles = [],
    cuotas = [],
    resumenTributario = null,
    opciones = {}
}) => {
    const certificadoData = certificado || {};
    const vehiculoData = vehiculo || {};
    const tipoFlujo = certificadoData.servicio_tipo_flujo || resumenTributario?.servicio?.tipoFlujo || '';
    const tallerNombre = certificadoData.formato_datos_snapshot?.taller?.nombre
        || resumenTributario?.taller?.nombre
        || '';
    const esTaller = esFlujoTaller(tipoFlujo);
    const descripcion = certificadoData.tipo_certificado_clave
        ? (esTaller
            ? `CERTIFICACION DE TALLER ${certificadoData.tipo_certificado_clave} - TALLER ${tallerNombre}`
            : `CERTIFICACION VEHICULAR ${certificadoData.tipo_certificado_clave} - PLACA ${vehiculoData.placa || ''}`)
        : `OPERACION COMERCIAL FAREGAS ${facturacion.operacion_id || facturacion.id}`;
    const tipoComprobante = facturacion.tipo_comprobante === 'FACTURA' ? 1 : 2;
    const tipoDocumento = facturacion.tipo_documento_cliente === 'RUC' ? 6 : 1;

    let descuentoTotal = Number(resumenTributario?.totales?.descuento || 0);
    let tarifaOriginal = Number(resumenTributario?.totales?.precioAntesDescuento ?? facturacion.importe_total);
    let baseOriginal = tarifaOriginal / 1.18;
    let baseDescuento = 0;

    if (!resumenTributario && reservaDescuento && Number(reservaDescuento.importe_descuento) > 0) {
        descuentoTotal = Number(reservaDescuento.importe_descuento);
        tarifaOriginal = Number(reservaDescuento.importe_original);
        baseOriginal = tarifaOriginal / 1.18;
        baseDescuento = descuentoTotal / 1.18;
    } else if (resumenTributario) {
        baseDescuento = descuentoTotal / 1.18;
    }

    const gratuidadAutorizada = esGratuidadTallerAutorizada({
        reserva: reservaDescuento || resumenTributario?.descuento,
        tipoFlujo
    });
    const fallbackGratuito = gratuidadAutorizada && detalles.length === 0 && Number(facturacion.importe_total || 0) === 0;
    // La modalidad persistida autoriza la gratuidad de toda la operación.
    // No se infiere por montos cero ni por un descuento comercial del 100 %.
    const lineasGratuitas = gratuidadAutorizada ? detalles : [];
    const totalGratuita = dosDecimales(
        fallbackGratuito
            ? tarifaOriginal
            : lineasGratuitas.reduce(
                (total, item) => total + Number(item.precio_unitario || 0) * Number(item.cantidad || 1),
                0
            )
    );
    const descuentoOneroso = dosDecimales(Math.max(0, descuentoTotal - totalGratuita));
    // Los descuentos comerciales ordinarios se declaran a nivel de ítem (items[].descuento)
    // para recuperar la representación histórica (FFF1-56), donde NubeFact refleja el
    // beneficio comercial directamente bajo el precio del producto en el detalle.
    // Solo se recurre a descuento_global si se solicita explícitamente vía opciones o facturación.
    const forzarDescuentoGlobal = Boolean(
        opciones?.usarDescuentoGlobal ||
        facturacion?.usar_descuento_global ||
        resumenTributario?.descuento?.usarDescuentoGlobal
    );
    const usaDescuentoGlobal = forzarDescuentoGlobal && detalles.length > 0 && !gratuidadAutorizada && descuentoOneroso > 0;
    const descuentoGlobalSinIgv = usaDescuentoGlobal
        ? dosDecimales(
            detalles.length > 0
                ? detalles.reduce((total, item) => total + Number(item.descuento || 0), 0)
                : baseDescuento
        )
        : 0;
    const items = detalles.length > 0
        ? detalles.map(item => gratuidadAutorizada
            ? construirItemGratuito(item)
            : usaDescuentoGlobal
                ? construirItemAntesDescuentoGlobal(item)
                : construirItem(item))
        : [
            fallbackGratuito
                ? construirItemGratuito({
                    unidad_snapshot: 'ZZ',
                    codigo_sku_snapshot: `FAREGAS-${certificadoData.tipo_certificado_clave || 'OPERACION'}`,
                    descripcion_snapshot: descripcion,
                    cantidad: 1,
                    valor_unitario: baseOriginal,
                    precio_unitario: tarifaOriginal,
                    descuento: baseDescuento,
                    base_imponible: 0,
                    afectacion_igv_snapshot: '10',
                    igv: 0,
                    importe_total: 0
                })
                : (usaDescuentoGlobal ? construirItemAntesDescuentoGlobal : construirItem)({
                    unidad_snapshot: 'ZZ',
                    codigo_sku_snapshot: `FAREGAS-${certificadoData.tipo_certificado_clave || 'OPERACION'}`,
                    descripcion_snapshot: descripcion,
                    cantidad: 1,
                    valor_unitario: baseOriginal,
                    precio_unitario: tarifaOriginal,
                    descuento: baseDescuento,
                    base_imponible: facturacion.base_imponible,
                    afectacion_igv_snapshot: '10',
                    igv: facturacion.igv,
                    importe_total: facturacion.importe_total
                })
        ];
    // Regla Faregas: sólo una FACTURA puede ser a crédito. La validación de
    // negocio rechaza BOLETA + CRÉDITO; esta defensa adicional evita enviar
    // cuotas si llegara un registro histórico inconsistente.
    const credito = String(facturacion.tipo_comprobante || '').toUpperCase() === 'FACTURA'
        && String(facturacion.condicion_pago || 'CONTADO').toUpperCase() === 'CREDITO';
    const informacionAdicional = construirInformacionAdicional({
        facturacion,
        certificado: certificadoData,
        vehiculo: vehiculoData,
        detalles,
        tipoFlujo,
        tallerNombre,
        gratuidadAutorizada
    });
    // El descuento fiscal se declara sin IGV en `descuento_global`. Para que
    // el cliente identifique el beneficio comercial pactado, conservamos en
    // observaciones el importe con IGV que ya fue persistido por FAREGAS. No se
    // reconstruye desde la base ni desde el impuesto, evitando milésimas.
    const leyendaDescuentoComercial = usaDescuentoGlobal && descuentoOneroso > 0
        ? `DESCUENTO COMERCIAL APLICADO: S/ ${descuentoOneroso.toFixed(2)} (INCLUYE IGV)`
        : '';
    const observaciones = [informacionAdicional.texto, leyendaDescuentoComercial]
        .filter(Boolean)
        .join('\n');

    const evaluacionDetraccion = typeof facturacion.sujeto_detraccion === 'boolean'
        ? (() => {
            if (!facturacion.sujeto_detraccion) {
                return { sujeto: false, codigo: null, porcentaje: 0, base: Number(facturacion.importe_total),
                    monto: 0, neto: Number(facturacion.importe_total), requiereRevision: false };
            }
            const codigo = String(facturacion.detraccion_codigo || '').trim().padStart(3, '0');
            const definicion = CAT_SPOT[codigo] || CAT_SPOT_BIENES[codigo];
            const tipo = Number(definicion?.nubefactTipo ?? codigo);
            const porcentaje = Number(facturacion.detraccion_porcentaje);
            const base = Number(facturacion.detraccion_base);
            const monto = Number(facturacion.detraccion_monto);
            const neto = Number(facturacion.detraccion_neto);
            const montoEsperado = Math.round((base * porcentaje) / 100);
            const requiereRevision = !definicion
                || !Number.isInteger(tipo) || tipo <= 0
                || !Number.isFinite(porcentaje) || porcentaje <= 0
                || Number(definicion.porcentaje) !== porcentaje
                || !Number.isFinite(base) || base <= 0
                || !Number.isFinite(monto) || monto < 0 || monto !== montoEsperado
                || !Number.isFinite(neto) || neto < 0 || dosDecimales(base - monto) !== dosDecimales(neto);
            return {
                sujeto: true,
                codigo,
                descripcion: facturacion.detraccion_descripcion || definicion?.descripcion || null,
                porcentaje,
                base,
                monto,
                neto,
                estadoDeposito: facturacion.detraccion_estado_deposito,
                nubefactTipo: tipo,
                requiereRevision
            };
        })()
        : evaluarDetraccion({
            tipoComprobante: facturacion.tipo_comprobante,
            importeTotal: facturacion.importe_total,
            moneda: facturacion.moneda_key,
            items: detalles,
            servicio: certificadoData?.servicio || resumenTributario?.servicio,
            esGratuito: gratuidadAutorizada || totalGratuita > 0
        });
    if (evaluacionDetraccion.requiereRevision) {
        const error = new Error('CLASIFICACION_SPOT_NO_VERIFICADA');
        error.code = 'CLASIFICACION_SPOT_NO_VERIFICADA';
        throw error;
    }

    return {
        operacion: 'generar_comprobante',
        tipo_de_comprobante: tipoComprobante,
        serie: facturacion.serie,
        numero: Number(facturacion.numero),
        sunat_transaction: evaluacionDetraccion.sujeto ? 30 : 1,
        cliente_tipo_de_documento: tipoDocumento,
        cliente_numero_de_documento: facturacion.nro_documento,
        cliente_denominacion: facturacion.nombre_razon_social,
        cliente_direccion: facturacion.direccion,
        cliente_email: facturacion.email || '',
        cliente_email_1: '',
        cliente_email_2: '',
        fecha_de_emision: fechaDocumento(facturacion.fecha_documento) || fechaPeru(),
        fecha_de_vencimiento: fechaDocumento(facturacion.fecha_vencimiento),
        moneda: 1,
        tipo_de_cambio: '',
        porcentaje_de_igv: 18,
        ...(usaDescuentoGlobal && descuentoGlobalSinIgv > 0 ? { descuento_global: descuentoGlobalSinIgv } : {}),
        total_descuento: usaDescuentoGlobal ? descuentoGlobalSinIgv : descuentoOneroso,
        total_anticipo: 0,
        total_gravada: dosDecimales(resumenTributario?.totales?.baseImponible ?? facturacion.base_imponible),
        total_inafecta: 0,
        total_exonerada: 0,
        total_igv: dosDecimales(resumenTributario?.totales?.igv ?? facturacion.igv),
        total_gratuita: totalGratuita,
        total_otros_cargos: 0,
        total: dosDecimales(resumenTributario?.totales?.total ?? facturacion.importe_total),
        percepcion_tipo: '',
        percepcion_base_imponible: 0,
        total_percepcion: 0,
        total_incluido_percepcion: 0,
        detraccion: evaluacionDetraccion.sujeto,
        ...(evaluacionDetraccion.sujeto ? {
            detraccion_tipo: evaluacionDetraccion.nubefactTipo,
            detraccion_porcentaje: evaluacionDetraccion.porcentaje,
            detraccion_total: evaluacionDetraccion.monto,
            medio_de_pago_detraccion: '001'
        } : {}),
        observaciones: observaciones || (certificadoData.id
            ? `EXPEDIENTE FAREGAS ${certificadoData.id}`
            : `OPERACION FAREGAS ${facturacion.operacion_id || facturacion.id}`),
        documento_que_se_modifica_tipo: '',
        documento_que_se_modifica_serie: '',
        documento_que_se_modifica_numero: '',
        tipo_de_nota_de_credito: '',
        tipo_de_nota_de_debito: '',
        enviar_automaticamente_a_la_sunat: config.nubefact.enviarSunat,
        enviar_automaticamente_al_cliente: Boolean(config.nubefact.enviarCliente && facturacion.email),
        codigo_unico: facturacion.codigo_unico || crearCodigoUnico(facturacion.id),
        condiciones_de_pago: credito ? 'CREDITO' : 'CONTADO',
        forma_de_pago: credito ? 'Credito' : 'Contado',
        medio_de_pago: gratuidadAutorizada
            ? ''
            : credito
            ? 'credito'
            : (String(facturacion.medio_pago || '').toLowerCase() === 'credito' ? '' : (facturacion.medio_pago || '')),
        cancelado: !credito,
        placa_vehiculo: esTaller ? '' : (vehiculoData.placa || ''),
        orden_compra_servicio: '',
        formato_de_pdf: '',
        items,
        // JSON V1 genera la leyenda fiscal desde total_gratuita/tipo_de_igv.
        // La identificación comercial va en observaciones; no admite leyendas[].
        venta_al_credito: credito
            ? cuotas.map(cuota => ({
                cuota: Number(cuota.numero_cuota),
                fecha_de_pago: fechaDocumento(cuota.fecha_pago),
                importe: dosDecimales(cuota.importe)
            }))
            : []
    };
};

const construirPayloadNotaDebitoLegacy = ({ nota, facturacion }) => {
    const descripcion = String(nota.sustento || 'NOTA DE DEBITO').trim().slice(0, 250);
    return {
        operacion: 'generar_comprobante',
        tipo_de_comprobante: 4,
        serie: nota.serie,
        numero: Number(nota.numero),
        sunat_transaction: 1,
        cliente_tipo_de_documento: facturacion.tipo_documento_cliente === 'RUC' ? 6 : 1,
        cliente_numero_de_documento: facturacion.nro_documento,
        cliente_denominacion: facturacion.nombre_razon_social,
        cliente_direccion: facturacion.direccion,
        cliente_email: facturacion.email || '',
        fecha_de_emision: fechaPeru(),
        moneda: 1,
        porcentaje_de_igv: 18,
        total_gravada: dosDecimales(nota.base_imponible),
        total_inafecta: 0,
        total_exonerada: 0,
        total_igv: dosDecimales(nota.igv),
        total_gratuita: 0,
        total_otros_cargos: 0,
        total: dosDecimales(nota.importe_total),
        observaciones: descripcion,
        documento_que_se_modifica_tipo: facturacion.tipo_comprobante === 'FACTURA' ? 1 : 2,
        documento_que_se_modifica_serie: facturacion.serie,
        documento_que_se_modifica_numero: Number(facturacion.numero),
        tipo_de_nota_de_credito: '',
        tipo_de_nota_de_debito: Number(nota.motivo_codigo),
        enviar_automaticamente_a_la_sunat: config.nubefact.enviarSunat,
        enviar_automaticamente_al_cliente: Boolean(config.nubefact.enviarCliente && facturacion.email),
        codigo_unico: nota.codigo_unico,
        condiciones_de_pago: 'CONTADO',
        cancelado: true,
        items: [construirItem({
            unidad_snapshot: 'ZZ',
            codigo_sku_snapshot: 'FAREGAS-ND',
            descripcion_snapshot: descripcion,
            cantidad: 1,
            valor_unitario: dosDecimales(nota.base_imponible),
            precio_unitario: dosDecimales(nota.importe_total),
            base_imponible: dosDecimales(nota.base_imponible),
            igv: dosDecimales(nota.igv),
            importe_total: dosDecimales(nota.importe_total),
            afectacion_igv_snapshot: '10'
        })]
    };
};

const construirPayloadNota = ({ nota, facturacion, tipoNota, snapshotFiscal, datosFiscales }) => {
    if (tipoNota !== 'CREDITO') {
        return construirPayloadNotaDebitoLegacy({ nota, facturacion });
    }
    if (!snapshotFiscal || !datosFiscales || !Array.isArray(datosFiscales.items)) {
        const error = new Error('SNAPSHOT_FISCAL_INCOMPLETO');
        error.code = 'SNAPSHOT_FISCAL_INCOMPLETO';
        error.statusCode = 409;
        throw error;
    }

    const fechaOriginalRaw = facturacion?.fecha_documento_fiscal_dia
        || facturacion?.fecha_documento
        || snapshotFiscal?.fecha_documento
        || snapshotFiscal?.fecha_de_emision;

    if (!fechaOriginalRaw) {
        const error = new Error('COMPROBANTE_ORIGINAL_SIN_FECHA_EMISION');
        error.code = 'COMPROBANTE_ORIGINAL_SIN_FECHA_EMISION';
        error.statusCode = 409;
        throw error;
    }

    const fechaRef = formatearFechaReferencia(fechaOriginalRaw);
    if (!fechaRef) {
        const error = new Error('FECHA_EMISION_ORIGINAL_INVALIDA');
        error.code = 'FECHA_EMISION_ORIGINAL_INVALIDA';
        error.statusCode = 409;
        throw error;
    }

    const tipoModificaNum = Number(snapshotFiscal.tipo_de_comprobante || (facturacion?.tipo_comprobante === 'FACTURA' ? 1 : 2));
    const tipoTexto = tipoModificaNum === 1 ? 'FACTURA' : 'BOLETA';
    const serieModifica = snapshotFiscal.serie || facturacion?.serie || '';
    const numeroModifica = Number(snapshotFiscal.numero || facturacion?.numero || 0);

    const observacionesFinal = combinarObservacionesNota({
        sustento: nota.sustento,
        tipoTexto,
        serie: serieModifica,
        numero: numeroModifica,
        fechaRef
    });
    return {
        operacion: 'generar_comprobante',
        tipo_de_comprobante: 3,
        serie: nota.serie,
        numero: Number(nota.numero),
        sunat_transaction: 1,
        cliente_tipo_de_documento: Number(snapshotFiscal.cliente_tipo_de_documento),
        cliente_numero_de_documento: snapshotFiscal.cliente_numero_de_documento,
        cliente_denominacion: snapshotFiscal.cliente_denominacion,
        cliente_direccion: snapshotFiscal.cliente_direccion || '',
        cliente_email: snapshotFiscal.cliente_email || '',
        cliente_email_1: snapshotFiscal.cliente_email_1 || '',
        cliente_email_2: snapshotFiscal.cliente_email_2 || '',
        fecha_de_emision: fechaPeru(),
        moneda: Number(snapshotFiscal.moneda || 1),
        tipo_de_cambio: snapshotFiscal.tipo_de_cambio || '',
        porcentaje_de_igv: Number(snapshotFiscal.porcentaje_de_igv || 18),
        total_descuento: dosDecimales(snapshotFiscal.total_descuento || 0),
        total_anticipo: dosDecimales(snapshotFiscal.total_anticipo || 0),
        total_gravada: dosDecimales(snapshotFiscal.total_gravada || 0),
        total_inafecta: dosDecimales(snapshotFiscal.total_inafecta || 0),
        total_exonerada: dosDecimales(snapshotFiscal.total_exonerada || 0),
        total_igv: dosDecimales(snapshotFiscal.total_igv || 0),
        total_gratuita: dosDecimales(snapshotFiscal.total_gratuita || 0),
        total_otros_cargos: dosDecimales(snapshotFiscal.total_otros_cargos || 0),
        total: dosDecimales(snapshotFiscal.total),
        observaciones: observacionesFinal,
        documento_que_se_modifica_tipo: Number(snapshotFiscal.tipo_de_comprobante),
        documento_que_se_modifica_serie: snapshotFiscal.serie,
        documento_que_se_modifica_numero: Number(snapshotFiscal.numero),
        tipo_de_nota_de_credito: Number(nota.motivo_codigo),
        tipo_de_nota_de_debito: '',
        enviar_automaticamente_a_la_sunat: config.nubefact.enviarSunat,
        enviar_automaticamente_al_cliente: Boolean(
            config.nubefact.enviarCliente && snapshotFiscal.cliente_email
        ),
        codigo_unico: nota.codigo_unico,
        condiciones_de_pago: 'CONTADO',
        forma_de_pago: 'Contado',
        medio_de_pago: '',
        cancelado: true,
        items: datosFiscales.items.map(item => ({ ...item })),
        leyendas: Array.isArray(snapshotFiscal.leyendas)
            ? snapshotFiscal.leyendas.map(leyenda => ({ ...leyenda }))
            : []
    };
};

module.exports = {
    construirPayloadNubefact,
    fechaPeru,
    limpiarRespuestaProveedor,
    esResultadoPendiente,
    mapearAceptacionSunat,
    mapearEstadoProveedor,
    crearCodigoUnico,
    construirPayloadNota,
    construirItem,
    obtenerIndicadorDetraccion,
    fechaDocumento,
    formatearFechaReferencia,
    yaContieneReferencia,
    combinarObservacionesNota
};
