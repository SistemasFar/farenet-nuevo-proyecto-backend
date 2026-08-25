const config = require('../../../config/integrations.config');

const dosDecimales = (value) => Number(value || 0).toFixed(2);

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

const construirPayloadNubefact = ({ facturacion, certificado, vehiculo, reservaDescuento = null }) => {
    const descripcion = `CERTIFICACION VEHICULAR ${certificado.tipo_certificado_clave} - PLACA ${vehiculo.placa}`;
    const tipoComprobante = facturacion.tipo_comprobante === 'FACTURA' ? 1 : 2;
    const tipoDocumento = facturacion.tipo_documento_cliente === 'RUC' ? 6 : 1;

    let descuentoTotal = 0;
    let tarifaOriginal = Number(facturacion.importe_total);
    let baseOriginal = Number(facturacion.base_imponible);
    let baseDescuento = 0;

    if (reservaDescuento && Number(reservaDescuento.importe_descuento) > 0) {
        descuentoTotal = Number(reservaDescuento.importe_descuento);
        tarifaOriginal = Number(reservaDescuento.importe_original);
        baseOriginal = tarifaOriginal / 1.18;
        baseDescuento = descuentoTotal / 1.18;
    }

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
        moneda: 1,
        tipo_de_cambio: '',
        porcentaje_de_igv: 18,
        total_descuento: dosDecimales(descuentoTotal),
        total_anticipo: '0.00',
        total_gravada: dosDecimales(facturacion.base_imponible),
        total_inafecta: '0.00',
        total_exonerada: '0.00',
        total_igv: dosDecimales(facturacion.igv),
        total_gratuita: '0.00',
        total_otros_cargos: '0.00',
        total: dosDecimales(facturacion.importe_total),
        percepcion_tipo: '',
        percepcion_base_imponible: '0.00',
        total_percepcion: '0.00',
        total_incluido_percepcion: '0.00',
        detraccion: false,
        observaciones: `EXPEDIENTE FAREGAS ${certificado.id}`,
        documento_que_se_modifica_tipo: '',
        documento_que_se_modifica_serie: '',
        documento_que_se_modifica_numero: '',
        tipo_de_nota_de_credito: '',
        tipo_de_nota_de_debito: '',
        enviar_automaticamente_a_la_sunat: config.nubefact.enviarSunat,
        enviar_automaticamente_al_cliente: Boolean(config.nubefact.enviarCliente && facturacion.email),
        codigo_unico: `FAREGAS-${certificado.id}-${facturacion.serie}-${facturacion.numero}`,
        condiciones_de_pago: '',
        medio_de_pago: '',
        placa_vehiculo: vehiculo.placa || '',
        orden_compra_servicio: '',
        formato_de_pdf: '',
        items: [{
            unidad_de_medida: 'ZZ',
            codigo: `FAREGAS-${certificado.tipo_certificado_clave}`.slice(0, 30),
            codigo_producto_sunat: '',
            descripcion,
            cantidad: 1,
            valor_unitario: dosDecimales(baseOriginal),
            precio_unitario: dosDecimales(tarifaOriginal),
            descuento: dosDecimales(baseDescuento),
            subtotal: dosDecimales(facturacion.base_imponible),
            tipo_de_igv: 1,
            igv: dosDecimales(facturacion.igv),
            total: dosDecimales(facturacion.importe_total),
            anticipo_regularizacion: false,
            anticipo_documento_serie: '',
            anticipo_documento_numero: ''
        }]
    };
};

module.exports = {
    construirPayloadNubefact,
    fechaPeru,
    limpiarRespuestaProveedor
};
