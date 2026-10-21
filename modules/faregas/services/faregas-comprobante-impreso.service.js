const fs = require('fs');
const path = require('path');
const db = require('../../../config/database');
const { renderBoletaHtml } = require('../templates/comprobante-boleta.template');
const { renderFacturaHtml } = require('../templates/comprobante-factura.template');
const { generarPdfDesdeHtml } = require('./faregas-pdf-generator.service');
const { esDocumentoBaseOperable } = require('./faregas-documento-tributario-policy');
const { obtenerIdentidadCorporativaFaregas } = require('./faregas-representacion-corporativa.service');
const {
    resolverNombreMedioPago,
    agruparDesglosePagos,
    derivarMedioPago
} = require('./faregas-facturacion.rules');

const COMPROBANTES_STORAGE_PATH = process.env.FAREGAS_COMPROBANTES_STORAGE_PATH
    || path.join(__dirname, '../../../uploads/comprobantes');
const LOGO_CERTIFICADOR_PATH = path.join(__dirname, '../templates/assets/certificador-vehicular.png');
const LOGO_CERTIFICADOR_DATA_URI = fs.existsSync(LOGO_CERTIFICADOR_PATH)
    ? `data:image/png;base64,${fs.readFileSync(LOGO_CERTIFICADOR_PATH).toString('base64')}`
    : '';

function formatearFechaPeruana(dateVal) {
    if (!dateVal) return '';
    if (typeof dateVal === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dateVal)) return dateVal;
    if (typeof dateVal === 'string') {
        const iso = dateVal.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    }
    const d = new Date(dateVal);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function normalizarMedioItem(item, opciones = {}) {
    if (!item) return '';

    if (typeof item === 'string') {
        const raw = item.trim().toUpperCase();
        if (!raw) return '';
        if (raw === 'YAPE') return 'YAPE';
        if (raw === 'PLIN') return 'PLIN';
        if (raw.includes('VISA')) return 'TARJETA VISA';
        if (raw.includes('MASTER')) return 'TARJETA MASTERCARD';
        if (raw === 'CUPONIDAD') return 'CUPONIDAD';
        if (raw === 'PAGO WEB' || raw === 'PAGO_WEB') return 'PAGO WEB';
        if (raw === 'EFECTIVO') return 'EFECTIVO';
        if (raw.includes('TRANSFER')) return 'TRANSFERENCIA BANCARIA';
        if (raw.includes('DEPOSI')) return 'DEPÓSITO BANCARIO';
        if (raw === 'BANCO') {
            const subtipo = String(opciones.tipoBanco || opciones.tipo_banco || opciones.subtipo || '').toUpperCase();
            if (subtipo.includes('DEPOSI')) return 'DEPÓSITO BANCARIO';
            return 'TRANSFERENCIA BANCARIA';
        }
        if (raw === 'TARJETA_DEBITO' || raw === 'DEBITO' || raw === 'TARJETA DEBITO' || raw === 'TARJETA DÉBITO') return 'TARJETA DÉBITO';
        if (raw === 'TARJETA_CREDITO' || raw === 'CREDITO_TARJETA' || raw === 'TARJETA CREDITO' || raw === 'TARJETA CRÉDITO') return 'TARJETA CRÉDITO';
        if (raw === 'TARJETA') {
            const subtipo = String(opciones.tipoTarjeta || opciones.tipo_tarjeta || opciones.subtipo || '').toUpperCase();
            if (subtipo.includes('CREDIT') || subtipo.includes('CRÉDIT')) return 'TARJETA CRÉDITO';
            if (subtipo.includes('DEBIT') || subtipo.includes('DÉBIT')) return 'TARJETA DÉBITO';
            return 'TARJETA';
        }
        if (raw === 'BILLETERA DIGITAL' || raw === 'BILLETERA_DIGITAL') return 'Billetera Digital';
        return raw;
    }

    const res = resolverNombreMedioPago(item);
    if (res) return res;

    return 'EFECTIVO';
}

function parseDetallePagosDesdeTexto(texto) {
    if (!texto || typeof texto !== 'string') return [];
    const limpio = texto.replace(/^MIXTO:\s*/i, '').trim();
    if (!limpio) return [];

    const partes = limpio.split(/[,·]+/).map(p => p.trim()).filter(Boolean);
    const detalle = [];
    for (const parte of partes) {
        const match = parte.match(/^(.+?)\s+S\/\s*([0-9.]+)$/i);
        if (match) {
            detalle.push({
                medio: match[1].trim().toUpperCase(),
                importe: Number(match[2])
            });
        } else {
            detalle.push({
                medio: parte.trim().toUpperCase(),
                importe: 0
            });
        }
    }
    return detalle;
}

function resolverFormaPagoYDetalle(f, qPagosRows = []) {
    const esCredito = String(f?.condicion_pago || '').toUpperCase().startsWith('CREDITO');

    if (esCredito) {
        return {
            formaPago: 'Crédito',
            detallePagos: []
        };
    }

    if (Array.isArray(qPagosRows) && qPagosRows.length > 0) {
        const desglose = agruparDesglosePagos(qPagosRows);
        if (desglose.length > 1) {
            return {
                formaPago: 'MIXTO',
                detallePagos: desglose.map(d => ({ medio: d.medio, importe: d.importe }))
            };
        }
        if (desglose.length === 1) {
            return {
                formaPago: desglose[0].medio,
                detallePagos: []
            };
        }
    }

    const mp = String(f?.medio_pago || '').trim();
    if (mp.toUpperCase().startsWith('MIXTO:')) {
        return {
            formaPago: 'MIXTO',
            detallePagos: parseDetallePagosDesdeTexto(mp)
        };
    }

    if (mp) {
        return {
            formaPago: normalizarMedioItem(mp),
            detallePagos: []
        };
    }

    return {
        formaPago: 'EFECTIVO',
        detallePagos: []
    };
}

function mapearFormaPago(condicionPago, medioPago, pagosOpciones = null) {
    const cp = String(condicionPago || '').toUpperCase();
    if (cp === 'CREDITO' || cp.startsWith('CREDITO')) {
        return 'Crédito';
    }

    let opciones = {};
    let pagosArray = [];
    if (typeof pagosOpciones === 'string') {
        opciones = { tipoTarjeta: pagosOpciones };
    } else if (Array.isArray(pagosOpciones)) {
        pagosArray = pagosOpciones;
    } else if (pagosOpciones && typeof pagosOpciones === 'object') {
        if (Array.isArray(pagosOpciones.pagos)) pagosArray = pagosOpciones.pagos;
        opciones = pagosOpciones;
    }

    if (Array.isArray(medioPago)) {
        pagosArray = medioPago;
    } else if (medioPago && typeof medioPago === 'object') {
        return normalizarMedioItem(medioPago, opciones) || 'EFECTIVO';
    }

    if (pagosArray.length > 0) {
        const desglose = agruparDesglosePagos(pagosArray);
        if (desglose.length > 1) {
            return 'MIXTO';
        }
        if (desglose.length === 1) {
            return desglose[0].medio;
        }
        const metodos = [];
        for (const p of pagosArray) {
            const m = normalizarMedioItem(p, opciones);
            if (m && !metodos.includes(m)) metodos.push(m);
        }
        if (metodos.length > 1) return 'MIXTO';
        if (metodos.length === 1) return metodos[0];
    }

    const mp = String(medioPago || '').trim();
    if (!mp) return 'EFECTIVO';

    if (mp.toUpperCase().startsWith('MIXTO:')) {
        return 'MIXTO';
    }

    if (mp.includes(',') || mp.includes('/')) {
        return 'MIXTO';
    }

    return normalizarMedioItem(mp, opciones) || 'EFECTIVO';
}

const moneda = valor => Number(valor || 0).toFixed(2);

function validarConsistenciaFiscal(facturacion, viewModel) {
    if (String(viewModel.comprobante.serie) !== String(facturacion.serie)) {
        throw new Error('INCONSISTENCIA_FISCAL: La serie impresa no coincide con la facturación persistida.');
    }
    if (Number(viewModel.comprobante.numero) !== Number(facturacion.numero)) {
        throw new Error('INCONSISTENCIA_FISCAL: El número impreso no coincide con la facturación persistida.');
    }
    if (String(viewModel.comprobante.tipo).toUpperCase() !== String(facturacion.tipo_comprobante).toUpperCase()) {
        throw new Error('INCONSISTENCIA_FISCAL: El tipo de comprobante impreso no coincide.');
    }
    if (String(viewModel.cliente.nroDoc).trim() !== String(facturacion.nro_documento).trim()) {
        throw new Error('INCONSISTENCIA_FISCAL: El documento del cliente impreso no coincide.');
    }
    if (viewModel.comprobante.fechaDocumento !== formatearFechaPeruana(facturacion.fecha_documento)) {
        throw new Error('INCONSISTENCIA_FISCAL: La fecha impresa no coincide con la fecha fiscal persistida.');
    }

    const comparaciones = [
        ['total', facturacion.importe_total, viewModel.totales.total],
        ['IGV', facturacion.igv, viewModel.totales.igv],
        ['base gravada', facturacion.base_imponible, viewModel.totales.gravada]
    ];
    for (const [etiqueta, persistido, impreso] of comparaciones) {
        if (moneda(persistido) !== moneda(impreso)) {
            throw new Error(`INCONSISTENCIA_FISCAL: El ${etiqueta} impreso no coincide con el comprobante fiscal.`);
        }
    }

    if (facturacion.descuento_fiscal_snapshot !== undefined
        && moneda(facturacion.descuento_fiscal_snapshot) !== moneda(viewModel.totales.descuento)) {
        throw new Error('INCONSISTENCIA_FISCAL: El descuento impreso no coincide con el payload fiscal persistido.');
    }
}

function payloadComoObjeto(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function mapearItemPayload(item) {
    const cantidad = Number(item.cantidad || 1);
    const total = Number(item.total || 0);
    const subtotal = Number(item.subtotal || 0);
    return {
        cantidad,
        unidad: item.unidad_de_medida || 'NIU',
        descripcion: item.descripcion || '',
        valorReferencial: Number(item.precio_unitario || 0),
        precioUnitario: cantidad > 0 ? total / cantidad : 0,
        valorUnitario: cantidad > 0 ? subtotal / cantidad : 0,
        total
    };
}

function mapearItemOperacion(item) {
    return {
        cantidad: Number(item.cantidad || 1),
        unidad: item.unidad_snapshot || 'NIU',
        descripcion: item.descripcion_snapshot || '',
        valorReferencial: Number(item.precio_unitario || 0),
        precioUnitario: Number(item.precio_unitario || 0),
        valorUnitario: Number(item.valor_unitario || 0),
        total: Number(item.importe_total || 0)
    };
}

function validarSnapshotObligatorio(facturacion, payloadFiscal) {
    if (!esDocumentoBaseOperable(facturacion)) throw new Error('COMPROBANTE_NO_OPERABLE');
    if (facturacion.certificado_id && (String(facturacion.certificado_estado || '').toUpperCase() !== 'EMITIDO'
        || !String(facturacion.numero_certificado || '').trim())) {
        throw new Error('CERTIFICADO_NO_EMITIDO: La representación impresa se genera después de asignar el DG definitivo.');
    }
    const faltantes = [
        ['fecha_documento', facturacion.fecha_documento],
        ['ruc_emisor', facturacion.ruc_emisor],
        ['razon_social_emisor', facturacion.razon_social_emisor],
        ['direccion_emisor', facturacion.direccion_emisor],
        ['sede_nombre_snapshot', facturacion.sede_nombre_snapshot],
        ['payload fiscal', payloadFiscal]
    ].filter(([, value]) => value === null || value === undefined || String(value).trim() === '');
    if (faltantes.length) {
        throw new Error(`SNAPSHOT_COMPROBANTE_INCOMPLETO: ${faltantes.map(([campo]) => campo).join(', ')}.`);
    }
}

async function obtenerDatosComprobanteImpreso(facturacionId) {
    const qFact = await db.query(
        `SELECT f.*,
                c.numero_certificado, c.estado AS certificado_estado,
                v.placa AS veh_placa, v.marca AS veh_marca, v.modelo AS veh_modelo,
                v.clase AS veh_clase, v.numero_motor AS veh_motor,
                opc.placa AS operacion_placa
         FROM fg_facturacion f
         LEFT JOIN fg_certificado c ON c.id = f.certificado_id
         LEFT JOIN fg_certificado_vehiculo v ON v.certificado_id = f.certificado_id
         LEFT JOIN fg_operacion_comercial opc ON opc.id = f.operacion_id
         WHERE f.id = $1`,
        [facturacionId]
    );
    if (qFact.rowCount === 0) throw new Error(`FACTURACION_NO_ENCONTRADA: ${facturacionId}.`);
    const f = qFact.rows[0];

    const qIntento = await db.query(
        `SELECT solicitud
         FROM fg_facturacion_intento
         WHERE facturacion_id = $1 AND solicitud IS NOT NULL
         ORDER BY numero_intento DESC
         LIMIT 1`,
        [facturacionId]
    );
    const payloadFiscal = payloadComoObjeto(qIntento.rows[0]?.solicitud);
    validarSnapshotObligatorio(f, payloadFiscal);

    let items = Array.isArray(payloadFiscal.items) ? payloadFiscal.items.map(mapearItemPayload) : [];
    if (items.length === 0) {
        const qOperacion = await db.query(
            `SELECT cantidad, unidad_snapshot, descripcion_snapshot, valor_unitario,
                    precio_unitario, base_imponible, igv, importe_total
             FROM fg_operacion_detalle
             WHERE ($1::bigint IS NOT NULL AND operacion_id = $1)
                OR certificado_id = $2
             ORDER BY orden ASC, id ASC`,
            [f.operacion_id || null, f.certificado_id]
        );
        items = qOperacion.rows.map(mapearItemOperacion);
    }
    if (items.length === 0) throw new Error('DETALLE_FACTURACION_NO_DISPONIBLE');

    const qDescuento = await db.query(
        `SELECT dc.importe_descuento,
                dcl.codigo AS codigo_real,
                d.nombre AS nombre_real
         FROM fg_descuentocomprobante dc
         JOIN fg_descuentocliente dcl ON dcl.id = dc.descuento_cliente_id
         JOIN fg_descuento d ON d.id = dcl.descuento_id
         WHERE dc.facturacion_id = $1 AND dc.estado = 'APLICADO'
         ORDER BY dc.id DESC
         LIMIT 1`,
        [facturacionId]
    );
    const descuentoFiscal = Number(payloadFiscal.total_descuento || 0);
    f.descuento_fiscal_snapshot = descuentoFiscal;
    const codigoDescuento = String(qDescuento.rows[0]?.codigo_real || f.codigo_descuento_snapshot || '').trim();
    const nombreDescuento = String(qDescuento.rows[0]?.nombre_real || '').trim();
    const descuentoData = codigoDescuento ? {
        codigo: codigoDescuento,
        descripcion: nombreDescuento,
        monto: Number(qDescuento.rows[0]?.importe_descuento || descuentoFiscal)
    } : null;

    const qPagos = await db.query(
        `SELECT p.tipocontado_key, p.tarjeta_key, p.modalidad_tarjeta AS tipo_tarjeta,
                p.importe,
                p.digitotarjeta, p.nrooperaciontarjeta,
                p.entidadfinanciera_key, p.fechdeposito, p.nrooperacionbanco,
                t.nombre AS tarjeta_nombre,
                ef.nombre AS entidad_nombre
         FROM fg_orden_pago op
         JOIN fg_pago p ON p.orden_pago_id = op.id AND p.estado = 'CAN'
         LEFT JOIN tarjeta t ON t.key = p.tarjeta_key
         LEFT JOIN entidadfinanciera ef ON ef.key = p.entidadfinanciera_key
         WHERE ($1::bigint IS NOT NULL AND op.certificado_id = $1)
            OR ($2::bigint IS NOT NULL AND op.operacion_id = $2)
         ORDER BY p.id ASC`,
        [f.certificado_id || null, f.operacion_id || null]
    );

    const qCuotas = await db.query(
        `SELECT numero_cuota, fecha_pago, importe
         FROM fg_facturacion_cuota
         WHERE facturacion_id = $1
         ORDER BY numero_cuota ASC`,
        [facturacionId]
    );

    const resolucionPago = resolverFormaPagoYDetalle(f, qPagos.rows);
    const formaPagoImpresa = resolucionPago.formaPago;
    const detallePagos = resolucionPago.detallePagos;
    const identidadCorporativa = await obtenerIdentidadCorporativaFaregas(db);

    const viewModel = {
        emisor: {
            ruc: identidadCorporativa.ruc,
            razonSocial: identidadCorporativa.razonSocial,
            direccion: identidadCorporativa.direccion,
            puntoVenta: f.sede_nombre_snapshot,
            telefono: f.sede_telefono_snapshot || '',
            correo: f.sede_correo_snapshot || ''
        },
        comprobante: {
            tipo: f.tipo_comprobante,
            serie: f.serie,
            numero: f.numero,
            fechaDocumento: formatearFechaPeruana(f.fecha_documento),
            fechaVencimiento: formatearFechaPeruana(f.fecha_vencimiento || f.fecha_documento),
            formaPago: formaPagoImpresa,
            detallePagos: detallePagos,
            moneda: 'Soles'
        },
        cliente: {
            nombre: f.nombre_razon_social,
            tipoDoc: f.tipo_documento_cliente,
            nroDoc: f.nro_documento,
            direccion: f.direccion || '',
            telefono: f.telefono || ''
        },
        vehiculo: {
            placa: f.veh_placa || f.operacion_placa || '',
            marca: f.veh_marca || '',
            modelo: f.veh_modelo || '',
            tipo: f.veh_clase || '',
            motor: f.veh_motor || ''
        },
        items,
        totales: {
            gravada: f.base_imponible,
            inafecta: Number(payloadFiscal.total_inafecta || 0),
            exonerada: Number(payloadFiscal.total_exonerada || 0),
            gratuita: Number(payloadFiscal.total_gratuita || 0),
            descuento: descuentoFiscal,
            igv: f.igv,
            total: f.importe_total
        },
        descuento: descuentoData,
        cuotas: esCredito ? qCuotas.rows.map(cuota => ({
            numero: String(cuota.numero_cuota).padStart(3, '0'),
            fecha: formatearFechaPeruana(cuota.fecha_pago),
            importe: Number(cuota.importe || 0)
        })) : [],
        numeroCertificado: f.numero_certificado,
        ordenTrabajo: f.veh_placa || f.operacion_placa || '',
        qrSource: f.cadena_qr || '',
        logoDataUri: LOGO_CERTIFICADOR_DATA_URI
    };

    validarConsistenciaFiscal(f, viewModel);
    return { facturacion: f, viewModel };
}

async function generarHtml(facturacionId) {
    const { facturacion, viewModel } = await obtenerDatosComprobanteImpreso(facturacionId);
    return String(facturacion.tipo_comprobante).toUpperCase() === 'FACTURA'
        ? renderFacturaHtml(viewModel)
        : renderBoletaHtml(viewModel);
}

const segmentoSeguro = value => String(value || '').replace(/[^A-Za-z0-9_-]/g, '');

async function generarPdf(facturacionId, options = {}) {
    fs.mkdirSync(COMPROBANTES_STORAGE_PATH, { recursive: true });
    const { facturacion, viewModel } = await obtenerDatosComprobanteImpreso(facturacionId);
    const esFactura = String(facturacion.tipo_comprobante).toUpperCase() === 'FACTURA';
    const html = esFactura ? renderFacturaHtml(viewModel) : renderBoletaHtml(viewModel);

    const padNumero = String(facturacion.numero).padStart(8, '0');
    const filename = `${segmentoSeguro(facturacion.ruc_emisor)}-${esFactura ? '01' : '03'}-${segmentoSeguro(facturacion.serie)}-${segmentoSeguro(padNumero)}.pdf`;
    const outputPath = path.join(COMPROBANTES_STORAGE_PATH, filename);
    await generarPdfDesdeHtml(html, outputPath, options);

    const relativeUrl = `/api/faregas/certificados/facturacion/${facturacionId}/pdf`;
    await db.query(
        `UPDATE fg_facturacion
         SET enlace_pdf_faregas = $1, fecha_modificacion = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [relativeUrl, facturacionId]
    );

    return { success: true, facturacionId, pdfPath: outputPath, filename, enlacePdfFaregas: relativeUrl };
}

async function regenerarRepresentacion(facturacionId) {
    return generarPdf(facturacionId, { forzar: true });
}

module.exports = {
    formatearFechaPeruana,
    normalizarMedioItem,
    parseDetallePagosDesdeTexto,
    resolverFormaPagoYDetalle,
    mapearFormaPago,
    validarConsistenciaFiscal,
    obtenerDatosComprobanteImpreso,
    generarHtml,
    generarPdf,
    regenerarRepresentacion,
    COMPROBANTES_STORAGE_PATH
};
