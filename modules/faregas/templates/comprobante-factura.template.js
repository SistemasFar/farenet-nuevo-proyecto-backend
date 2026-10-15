/**
 * Plantilla de Representación Impresa Oficial de FACTURA ELECTRÓNICA FAREGAS.
 *
 * Reproduce fielmente la disposición, jerarquía, tablas, bordes y bloques
 * del modelo histórico de referencia (20521536463-01-FE12-00001516).
 */

const { generarQrDataUri } = require('../utils/qr-code');
const { numeroALetras } = require('../utils/numero-a-letras');

const formatMoney = (val) => Number(val || 0).toFixed(2);
const escapeHtml = (str) => String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function renderFacturaHtml(data) {
    const {
        emisor = {},
        comprobante = {},
        cliente = {},
        vehiculo = {},
        items = [],
        totales = {},
        descuento = null,
        qrSource = '',
        logoDataUri = '',
        cuotas = [],
        numeroCertificado = '',
        ordenTrabajo = ''
    } = data;

    const rucEmisor = escapeHtml(emisor.ruc || '');
    const razonSocialEmisor = escapeHtml(emisor.razonSocial || '');
    const direccionEmisor = escapeHtml(emisor.direccion || '');
    const puntoVentaRaw = String(emisor.puntoVenta || '').trim();
    const puntoVenta = escapeHtml(/^FAREGAS\s*-/i.test(puntoVentaRaw) ? puntoVentaRaw : `FAREGAS - ${puntoVentaRaw}`);
    const telefonoEmisor = escapeHtml(emisor.telefono || '');
    const correoEmisor = escapeHtml(emisor.correo || '');

    const serie = escapeHtml(comprobante.serie || 'FE00');
    const numero = String(comprobante.numero || '1').padStart(8, '0');
    const nroComprobante = `${serie}-${numero}`;
    const fechaDocumento = escapeHtml(comprobante.fechaDocumento || '');
    const fechaVencimiento = escapeHtml(comprobante.fechaVencimiento || fechaDocumento);
    const formaPago = escapeHtml(comprobante.formaPago || 'Contado');
    const moneda = escapeHtml(comprobante.moneda || 'Soles');

    const clienteNombre = escapeHtml(cliente.nombre || cliente.razonSocial || '');
    const clienteDocTipo = escapeHtml(cliente.tipoDoc || 'RUC');
    const clienteDocNro = escapeHtml(cliente.nroDoc || '');
    const clienteDireccion = escapeHtml(cliente.direccion || '');
    const clienteTelefono = escapeHtml(cliente.telefono || '');

    const placa = escapeHtml(vehiculo.placa || '');
    const marca = escapeHtml(vehiculo.marca || '');
    const tipoVehiculo = escapeHtml(vehiculo.tipo || vehiculo.clase || '');
    const motor = escapeHtml(vehiculo.motor || '');
    const modelo = escapeHtml(vehiculo.modelo || '');

    const montoTotal = Number(totales.total || 0);
    const textoImporte = numeroALetras(montoTotal, moneda);

    const qrDataUri = generarQrDataUri(qrSource || `${rucEmisor}|01|${serie}|${numero}|${formatMoney(totales.igv)}|${formatMoney(totales.total)}|${fechaDocumento}|6|${clienteDocNro}|`);

    const itemsHtml = items.map((item) => {
        const cant = Number(item.cantidad || 1).toFixed(2);
        const unidad = escapeHtml(item.unidad || 'NIU');
        const desc = escapeHtml(item.descripcion || '');
        const valRef = formatMoney(item.valorReferencial || item.precioUnitario || 0);
        const precUnit = formatMoney(item.precioUnitario || 0);
        const valUnit = formatMoney(item.valorUnitario || (Number(item.precioUnitario || 0) / 1.18));
        const valVenta = formatMoney(item.total || item.valorVenta || (Number(cant) * Number(precUnit)));

        return `
            <tr>
                <td class="col-cant">${cant}</td>
                <td class="col-umed">${unidad}</td>
                <td class="col-desc">${desc}</td>
                <td class="col-num">${valRef}</td>
                <td class="col-num">${precUnit}</td>
                <td class="col-num">${valUnit}</td>
                <td class="col-num">${valVenta}</td>
            </tr>
        `;
    }).join('');

    const cuotasHtml = cuotas.map((cuota) => `
        <div class="cuota-row">
            <strong>Cuota:</strong> ${escapeHtml(cuota.numero)}
            <strong>Fecha:</strong> ${escapeHtml(cuota.fecha)}
            <strong>Monto:</strong> S/ ${formatMoney(cuota.importe)}
        </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Factura Electrónica ${nroComprobante}</title>
    <style>
        @page {
            size: A4 portrait;
            margin: 8mm 10mm 10mm 10mm;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: Arial, Helvetica, sans-serif;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        body {
            background-color: #ffffff;
            color: #000000;
            font-size: 8pt;
            line-height: 1.25;
            padding: 10px 15px;
        }
        .header-bar {
            background-color: #083b66;
            color: #ffffff;
            text-align: center;
            font-weight: bold;
            font-size: 11pt;
            padding: 5px 0;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }
        .top-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 10px;
        }
        .emisor-col {
            width: 58%;
        }
        .logo-box {
            display: block;
            width: 270px;
            max-width: 100%;
            margin-bottom: 6px;
        }
        .logo-box img {
            display: block;
            width: 100%;
            height: auto;
        }
        .emisor-razon {
            font-weight: bold;
            font-size: 8.5pt;
            margin-top: 4px;
            line-height: 1.15;
        }
        .emisor-direccion {
            font-weight: bold;
            font-size: 6.8pt;
            margin-top: 3px;
            color: #111;
        }
        .emisor-contacto {
            font-size: 7pt;
            margin-top: 4px;
            line-height: 1.25;
        }
        .ruc-box {
            width: 38%;
            border: 1px solid #333333;
            border-radius: 6px;
            padding: 12px 6px;
            text-align: center;
        }
        .ruc-num {
            font-size: 10.5pt;
            font-weight: bold;
            margin-bottom: 8px;
        }
        .ruc-tipo {
            font-size: 12pt;
            font-weight: bold;
            line-height: 1.15;
            margin-bottom: 8px;
        }
        .ruc-serie {
            font-size: 11pt;
            font-weight: bold;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            font-size: 7.5pt;
            margin-bottom: 8px;
            line-height: 1.45;
        }
        .info-col-left {
            width: 54%;
        }
        .info-col-right {
            width: 44%;
        }
        .info-label {
            font-weight: bold;
            display: inline-block;
            min-width: 90px;
        }
        .info-label-right {
            font-weight: bold;
            display: inline-block;
            min-width: 125px;
        }
        .vehiculo-box {
            border: 1px solid #777777;
            border-radius: 5px;
            padding: 6px 10px;
            margin-bottom: 8px;
            font-size: 7.5pt;
        }
        .cuotas-box {
            border: 1px solid #777777;
            border-radius: 5px;
            padding: 5px 10px;
            margin-bottom: 8px;
            font-size: 7.5pt;
        }
        .cuota-row {
            display: flex;
            gap: 8px;
            padding: 1px 0;
        }
        .vehiculo-table {
            width: 100%;
            border-collapse: collapse;
        }
        .vehiculo-table td {
            padding: 2px 4px;
            vertical-align: top;
        }
        .v-label {
            width: 110px;
            font-weight: normal;
        }
        .v-value {
            font-weight: bold;
        }
        .items-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 7pt;
            margin-bottom: 6px;
        }
        .items-table th {
            background-color: #b0b0b0;
            color: #ffffff;
            font-weight: bold;
            text-align: center;
            border: 1px solid #999999;
            padding: 4px 2px;
            font-size: 6.8pt;
        }
        .items-table td {
            border: 1px solid #b0b0b0;
            padding: 5px 4px;
            vertical-align: middle;
        }
        .col-cant { width: 7%; text-align: center; }
        .col-umed { width: 8%; text-align: center; }
        .col-desc { width: 41%; text-align: left; }
        .col-num { width: 11%; text-align: right; }
        .son-letras {
            font-size: 7.5pt;
            font-weight: bold;
            margin: 4px 0 8px 0;
        }
        .bottom-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 8px;
        }
        .bottom-left {
            width: 58%;
        }
        .descuento-box {
            border: 1px solid #666666;
            padding: 5px 8px;
            display: inline-block;
            min-width: 180px;
            font-size: 7.5pt;
            line-height: 1.3;
            margin-top: 4px;
        }
        .descuento-codigo {
            font-weight: bold;
        }
        .bottom-right {
            width: 38%;
        }
        .totales-table {
            width: 100%;
            border-collapse: collapse;
            border: 1px solid #666666;
            font-size: 7pt;
        }
        .totales-table td {
            padding: 2.5px 6px;
            border: 1px solid #cccccc;
        }
        .t-label {
            text-align: left;
            width: 55%;
        }
        .t-num {
            text-align: right;
            width: 45%;
        }
        .t-total {
            font-weight: bold;
            font-size: 7.5pt;
            border-top: 1px solid #666666 !important;
        }
        .footer-section {
            margin-top: 15px;
            font-size: 6.5pt;
            color: #666666;
            line-height: 1.35;
        }
        .qr-container {
            margin-bottom: 6px;
        }
        .footer-legal {
            margin-top: 4px;
        }
    </style>
</head>
<body>
    <div class="header-bar">FACTURA ELECTRÓNICA</div>

    <div class="top-row">
        <div class="emisor-col">
            ${logoDataUri ? `<div class="logo-box"><img src="${logoDataUri}" alt="Certificador Vehicular" /></div>` : ''}
            <div class="emisor-razon">${razonSocialEmisor}</div>
            <div class="emisor-direccion">${direccionEmisor}</div>
            <div class="emisor-contacto">
                <div><strong>Punto de venta:</strong> ${puntoVenta}</div>
                ${telefonoEmisor ? `<div><strong>Teléfono:</strong> ${telefonoEmisor}</div>` : ''}
                ${correoEmisor ? `<div><strong>Correo Electrónico:</strong> ${correoEmisor}</div>` : ''}
            </div>
        </div>
        <div class="ruc-box">
            <div class="ruc-num">R.U.C. Nº ${rucEmisor}</div>
            <div class="ruc-tipo">FACTURA ELECTRÓNICA</div>
            <div class="ruc-serie">${nroComprobante}</div>
        </div>
    </div>

    <div class="info-row">
        <div class="info-col-left">
            <div><span class="info-label">SEÑOR (ES):</span> <strong>${clienteNombre}</strong></div>
            <div><span class="info-label">DOMICILIO:</span> ${clienteDireccion}</div>
            <div><span class="info-label">${clienteDocTipo}:</span> ${clienteDocNro}</div>
            ${clienteTelefono ? `<div><span class="info-label">TELÉFONO:</span> ${clienteTelefono}</div>` : ''}
        </div>
        <div class="info-col-right">
            <div><span class="info-label-right">Fecha Documento:</span> ${fechaDocumento}</div>
            <div><span class="info-label-right">Fecha Vencimiento:</span> ${fechaVencimiento}</div>
            <div><span class="info-label-right">Moneda:</span> ${moneda}</div>
            <div><span class="info-label-right">Forma de Pago:</span> ${formaPago}</div>
            ${numeroCertificado ? `<div><span class="info-label-right">Numero Certificado:</span> ${numeroCertificado}</div>` : ''}
            ${ordenTrabajo ? `<div><span class="info-label-right">Orden Trabajo:</span> ${ordenTrabajo}</div>` : ''}
        </div>
    </div>

    ${cuotasHtml ? `<div class="cuotas-box">${cuotasHtml}</div>` : ''}

    <div class="vehiculo-box">
        <table class="vehiculo-table">
            <tr>
                <td class="v-label">Placa</td>
                <td class="v-value">${placa || '—'}</td>
                <td class="v-label">Marca Vehículo</td>
                <td class="v-value">${marca || '—'}</td>
            </tr>
            <tr>
                <td class="v-label">Tipo Vehículo</td>
                <td class="v-value">${tipoVehiculo || '—'}</td>
                <td class="v-label">Motor Vehículo</td>
                <td class="v-value">${motor || '—'}</td>
            </tr>
            <tr>
                <td class="v-label">Modelo Vehículo</td>
                <td class="v-value">${modelo || '—'}</td>
                <td class="v-label"></td>
                <td class="v-value"></td>
            </tr>
        </table>
    </div>

    <table class="items-table">
        <thead>
            <tr>
                <th class="col-cant">CANT</th>
                <th class="col-umed">U. MED.</th>
                <th class="col-desc">DESCRIPCIÓN</th>
                <th class="col-num">VALOR REF.</th>
                <th class="col-num">PREC. UNIT.</th>
                <th class="col-num">VALOR. UNIT.</th>
                <th class="col-num">V. VENTA</th>
            </tr>
        </thead>
        <tbody>
            ${itemsHtml}
        </tbody>
    </table>

    <div class="son-letras">${textoImporte}</div>

    <div class="bottom-row">
        <div class="bottom-left">
            ${descuento && descuento.codigo ? `
                <div class="descuento-box">
                    <div class="descuento-codigo">${escapeHtml(descuento.codigo)}</div>
                    ${descuento.descripcion ? `<div>${escapeHtml(descuento.descripcion)}</div>` : ''}
                </div>
            ` : ''}
        </div>
        <div class="bottom-right">
            <table class="totales-table">
                <tr>
                    <td class="t-label">Op. Gravada</td>
                    <td class="t-num">S/ ${formatMoney(totales.gravada || totales.baseImponible || 0)}</td>
                </tr>
                <tr>
                    <td class="t-label">Op. Inafectas</td>
                    <td class="t-num">S/ ${formatMoney(totales.inafecta || 0)}</td>
                </tr>
                <tr>
                    <td class="t-label">Op. Exonerada</td>
                    <td class="t-num">S/ ${formatMoney(totales.exonerada || 0)}</td>
                </tr>
                <tr>
                    <td class="t-label">Op. Gratuita</td>
                    <td class="t-num">S/ ${formatMoney(totales.gratuita || 0)}</td>
                </tr>
                <tr>
                    <td class="t-label">Descuentos</td>
                    <td class="t-num">S/ ${formatMoney(totales.descuento || 0)}</td>
                </tr>
                <tr>
                    <td class="t-label">IGV</td>
                    <td class="t-num">S/ ${formatMoney(totales.igv || 0)}</td>
                </tr>
                <tr class="t-total">
                    <td class="t-label"><strong>Importe Total</strong></td>
                    <td class="t-num"><strong>S/ ${formatMoney(totales.total || 0)}</strong></td>
                </tr>
            </table>
        </div>
    </div>

    <div class="footer-section">
        <div class="qr-container">
            <img src="${qrDataUri}" width="85" height="85" alt="Código QR SUNAT" />
        </div>
        <div class="footer-legal">
            <div>Representación impresa de la factura electrónica.</div>
            <div>Documento electrónico emitido mediante NubeFact; su validez se sustenta en el XML y CDR correspondientes.</div>
        </div>
    </div>
</body>
</html>`;
}

module.exports = {
    renderFacturaHtml
};
