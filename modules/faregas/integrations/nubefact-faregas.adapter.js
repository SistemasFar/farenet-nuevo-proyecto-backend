const config = require('../../../config/integrations.config');

const dosDecimales = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const crearCodigoUnico = (facturacionId, prefijo = 'FG') => {
    const id = Number(facturacionId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('FACTURACION_ID_INVALIDO');
    const codigo = `${String(prefijo || 'FG').trim().toUpperCase()}-${id}`;
    if (codigo.length > 20) throw new Error('CODIGO_UNICO_NUBEFACT_INVALIDO');
    return codigo;
};

const fechaDocumento = (value) => {
    if (!value) return '';
    const raw = String(value).slice(0, 10);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : raw;
};

const tipoIgvNubefact = (value) => {
    const normalizado = String(value ?? '').trim();
    if (normalizado === '10') return 1;
    if (normalizado === '20') return 8;
    if (normalizado === '30') return 9;
    const numero = Number(normalizado);
    return Number.isInteger(numero) && numero >= 1 && numero <= 20 ? numero : 1;
};

const construirItem = (item) => ({
    unidad_de_medida: String(item.unidad_snapshot || item.unidad_de_medida || 'ZZ').trim().toUpperCase(),
    codigo: String(item.codigo_sku_snapshot || item.codigo || '').trim().slice(0, 250),
    codigo_producto_sunat: String(item.codigo_sunat_snapshot || item.codigo_producto_sunat || '').trim().slice(0, 8),
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
});

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

const limpiarRespuestaProveedor = (value) => {
    if (!value || typeof value !== 'object') return value || null;
    const copia = { ...value };
    [
        'pdf_zip_base64', 'xml_zip_base64', 'cdr_zip_base64',
        'pdf_base64', 'xml_base64', 'cdr_base64'
    ].forEach(key => delete copia[key]);
    return copia;
};

const construirPayloadNubefact = ({
    facturacion,
    certificado,
    vehiculo,
    reservaDescuento = null,
    detalles = [],
    cuotas = [],
    resumenTributario = null
}) => {
    const descripcion = `CERTIFICACION VEHICULAR ${certificado.tipo_certificado_clave} - PLACA ${vehiculo.placa}`;
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

    const items = detalles.length > 0
        ? detalles.map(construirItem)
        : [construirItem({
            unidad_snapshot: 'ZZ',
            codigo_sku_snapshot: `FAREGAS-${certificado.tipo_certificado_clave}`,
            descripcion_snapshot: descripcion,
            cantidad: 1,
            valor_unitario: baseOriginal,
            precio_unitario: tarifaOriginal,
            descuento: baseDescuento,
            base_imponible: facturacion.base_imponible,
            afectacion_igv_snapshot: '10',
            igv: facturacion.igv,
            importe_total: facturacion.importe_total
        })];
    const credito = String(facturacion.condicion_pago || 'CONTADO').toUpperCase() === 'CREDITO';

    return {
        operacion: 'generar_comprobante',
        tipo_de_comprobante: tipoComprobante,
        serie: facturacion.serie,
        numero: Number(facturacion.numero),
        sunat_transaction: 1,
        cliente_tipo_de_documento: tipoDocumento,
        cliente_numero_de_documento: facturacion.nro_documento,
        cliente_denominacion: facturacion.nombre_razon_social,
        cliente_direccion: facturacion.direccion,
        cliente_email: facturacion.email || '',
        cliente_email_1: '',
        cliente_email_2: '',
        fecha_de_emision: fechaPeru(),
        fecha_de_vencimiento: fechaDocumento(facturacion.fecha_vencimiento),
        moneda: 1,
        tipo_de_cambio: '',
        porcentaje_de_igv: 18,
        total_descuento: dosDecimales(descuentoTotal),
        total_anticipo: 0,
        total_gravada: dosDecimales(resumenTributario?.totales?.baseImponible ?? facturacion.base_imponible),
        total_inafecta: 0,
        total_exonerada: 0,
        total_igv: dosDecimales(resumenTributario?.totales?.igv ?? facturacion.igv),
        total_gratuita: 0,
        total_otros_cargos: 0,
        total: dosDecimales(resumenTributario?.totales?.total ?? facturacion.importe_total),
        percepcion_tipo: '',
        percepcion_base_imponible: 0,
        total_percepcion: 0,
        total_incluido_percepcion: 0,
        detraccion: false,
        observaciones: `EXPEDIENTE FAREGAS ${certificado.id}`,
        documento_que_se_modifica_tipo: '',
        documento_que_se_modifica_serie: '',
        documento_que_se_modifica_numero: '',
        tipo_de_nota_de_credito: '',
        tipo_de_nota_de_debito: '',
        enviar_automaticamente_a_la_sunat: config.nubefact.enviarSunat,
        enviar_automaticamente_al_cliente: Boolean(config.nubefact.enviarCliente && facturacion.email),
        codigo_unico: facturacion.codigo_unico || crearCodigoUnico(facturacion.id),
        condiciones_de_pago: credito ? 'CREDITO' : 'CONTADO',
        medio_de_pago: facturacion.medio_pago || '',
        cancelado: !credito,
        placa_vehiculo: vehiculo.placa || '',
        orden_compra_servicio: '',
        formato_de_pdf: '',
        items,
        venta_al_credito: credito
            ? cuotas.map(cuota => ({
                cuota: Number(cuota.numero_cuota),
                fecha_de_pago: fechaDocumento(cuota.fecha_pago),
                importe: dosDecimales(cuota.importe)
            }))
            : []
    };
};

const construirPayloadNota = ({ nota, facturacion, tipoNota }) => {
    const esCredito = tipoNota === 'CREDITO';
    const tipoDocumentoModificado = facturacion.tipo_comprobante === 'FACTURA' ? 1 : 2;
    const tipoDocumentoCliente = facturacion.tipo_documento_cliente === 'RUC' ? 6 : 1;
    const descripcion = String(nota.sustento || (esCredito ? 'NOTA DE CREDITO' : 'NOTA DE DEBITO')).trim().slice(0, 250);
    return {
        operacion: 'generar_comprobante',
        tipo_de_comprobante: esCredito ? 3 : 4,
        serie: nota.serie,
        numero: Number(nota.numero),
        sunat_transaction: 1,
        cliente_tipo_de_documento: tipoDocumentoCliente,
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
        documento_que_se_modifica_tipo: tipoDocumentoModificado,
        documento_que_se_modifica_serie: facturacion.serie,
        documento_que_se_modifica_numero: Number(facturacion.numero),
        tipo_de_nota_de_credito: esCredito ? Number(nota.motivo_codigo) : '',
        tipo_de_nota_de_debito: esCredito ? '' : Number(nota.motivo_codigo),
        enviar_automaticamente_a_la_sunat: config.nubefact.enviarSunat,
        enviar_automaticamente_al_cliente: Boolean(config.nubefact.enviarCliente && facturacion.email),
        codigo_unico: nota.codigo_unico,
        condiciones_de_pago: 'CONTADO',
        cancelado: true,
        items: [construirItem({
            unidad_snapshot: 'ZZ',
            codigo_sku_snapshot: esCredito ? 'FAREGAS-NC' : 'FAREGAS-ND',
            descripcion_snapshot: descripcion,
            cantidad: 1,
            valor_unitario: nota.base_imponible,
            precio_unitario: nota.importe_total,
            base_imponible: nota.base_imponible,
            afectacion_igv_snapshot: '10',
            igv: nota.igv,
            importe_total: nota.importe_total
        })]
    };
};

module.exports = {
    construirPayloadNubefact,
    fechaPeru,
    limpiarRespuestaProveedor,
    crearCodigoUnico,
    construirPayloadNota,
    construirItem,
    fechaDocumento
};
