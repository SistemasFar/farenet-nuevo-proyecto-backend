const { escapeHtml, formatDateLong, formatDateShort, formatNumberWithoutTrailingZeros, formatCountTwoDigits, NUMERO_CERTIFICADO_PENDIENTE } = require('./template-utils');

function generateGnvAnualHtml(data, options = { modo: "PREVIEW" }) {
    const cert = data.cabecera || {};
    const veh = data.vehiculo || {};
    const gnv = data.gnv || {};
    const verifs = data.verificaciones || [];
    const titulares = data.titulares || [];

    const numCertificado = cert.numero_certificado || NUMERO_CERTIFICADO_PENDIENTE;

    const fechaImp = formatDateLong(cert.fecha_emision);
    const vigenciaHastaFmt = formatDateShort(gnv.vigencia_hasta).replace(/\//g, '-');

    // Los certificados antiguos no tienen taller_planta_key y mantienen su
    // representación histórica. Los nuevos usan el snapshot resuelto por sede.
    const tallerNombre = gnv.taller_planta_key
        ? gnv.taller_razon_social
        : 'CHARING S.A.C. SEDE SURQUILLO';

    // Verificaciones a-h
    const verifMap = {};
    verifs.forEach(v => { verifMap[v.codigo] = v; });

    const reqVerifs = [
        { code: 'a', desc: 'El equipo completo instalado en el vehículo está compuesto con los elementos, partes o piezas registradas en la base de datos del sistema de control de carga de GNV.' },
        { code: 'b', desc: 'El cilindro y el Kit de montaje no han sido alterados ni se encuentran deteriorados por el uso, ni han sido cambiados.' },
        { code: 'c', desc: 'Cada uno de los componentes están instalados de manera segura, incluyendo las tuberías de alta y baja presión, y que dichos componentes están ubicados en los sitios originales.' },
        { code: 'd', desc: 'No existan fugas en los empalmes o uniones.' },
        { code: 'e', desc: 'Los elementos de cierre actúan herméticamente.' },
        { code: 'f', desc: 'El sistema de combustión a GNV responda a las características originales recomendadas por el fabricante del vehículo, o el Proveedor de Equipos Completos – PEC.' },
        { code: 'g', desc: 'Los controles ubicados en el tablero del vehículo responden a las exigencias para los cuales fueron montados.' },
        { code: 'h', desc: 'Las exigencias sobre ventilación en las distintas zonas de instalación no han sido alteradas, y demás exigencias establecidas por la normativa vigente en la materia.' }
    ];

    const verifHtml = reqVerifs.map(v => {
        const item = verifMap[v.code];
        const desc = item ? item.descripcion : v.desc;
        let estadoLabel = '';
        if (item && item.cumple === true) {
            estadoLabel = '';
        } else if (item && item.cumple === false) {
            estadoLabel = ` <span style="color: red; font-weight: bold;">[NO CUMPLE${item.observacion ? ': ' + escapeHtml(item.observacion) : ''}]</span>`;
        } else {
            estadoLabel = ` <span style="color: #d97706; font-weight: bold;">[PENDIENTE DE EVALUACIÓN]</span>`;
        }
        return `<li><strong class="verif-code">${v.code})</strong><span class="verif-text">${escapeHtml(desc)}${estadoLabel}</span></li>`;
    }).join('');

    const entNombre = cert.entidad_certificadora_nombre || '-';
    const resDirectoral = cert.resolucion_directoral || '-';
    const domFiscal = cert.domicilio_fiscal || '-';
    const telfCert = cert.telefono_certificadora || '-';
    const lugarEmision = cert.lugar_emision || '-';

    // Observaciones del inspector (campo opcional).
// Identifica el tipo de flujo mediante el servicio real, no mediante palabras en el nombre del certificado.
const esTaller = cert && cert.servicio_tipo_flujo === 'TALLER_INSPECCION';

// Para certificados de taller: si viene vacío/espacios → "NINGUNA", si hay texto → mostrarlo tal cual.
// Para certificados normales: comportamiento existente.
let observacionesMostrar;
if (esTaller) {
    // Taller: mostrar "NINGUNA" si viene vacío/espacios, o el texto exacto si hay observación
    const obsRaw = (gnv && gnv.observaciones) || (cert && cert.observaciones) || '';
    observacionesMostrar = String(obsRaw.trim()) || 'NINGUNA';
} else {
    // Normal: comportamiento existente
    const rawObservaciones = (gnv && gnv.observaciones) || (cert && cert.observaciones) || '';
    let cleanObservaciones = typeof rawObservaciones === 'string'
        ? rawObservaciones.trim().slice(0, 250)
        : '';
    if (['NULL', 'UNDEFINED', 'N/A', 'NA', 'SIN OBSERVACIONES', 'NINGUNA', 'NINGUNO', '-', 'VACÍO', 'VACIO', 'NONE'].includes(cleanObservaciones.toUpperCase())) {
        cleanObservaciones = '';
    }
    observacionesMostrar = cleanObservaciones;
}

const obsContentHtml = esTaller
    ? String(observacionesMostrar).trim() === 'NINGUNA'
        ? `<div class="obs-sec">
            <strong>Observaciones</strong>
            <div>- Ninguna.</div>
        </div>`
        : `<div class="obs-sec">
            <strong>Observaciones</strong>
            <div>- ${escapeHtml(observacionesMostrar)}</div>
        </div>`
    : (observacionesMostrar
        ? `<strong>OBSERVACIONES:</strong> ${escapeHtml(observacionesMostrar).replace(/(?:\r\n|\r|\n)/g, '<br>')}`
        : `<div class="obs-header-line">
            <span class="obs-label"><strong>OBSERVACIONES:</strong></span>
            <div class="obs-dots-container">
                <svg width="100%" height="8" style="display:block;"><line x1="0" y1="6" x2="100%" y2="6" stroke="#000" stroke-width="1.2" stroke-dasharray="1 3.5" stroke-linecap="round"/></svg>
            </div>
        </div>
        <div class="obs-dots-full">
            <svg width="100%" height="8" style="display:block;"><line x1="0" y1="6" x2="100%" y2="6" stroke="#000" stroke-width="1.2" stroke-dasharray="1 3.5" stroke-linecap="round"/></svg>
        </div>`);

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Certificado GNV Anual - Previsualización</title>
    <style>
        @page { size: A4 portrait; margin: 0; }
        html {
            width: 210mm;
            min-height: 297mm;
        }
        body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 9pt;
            color: #000;
            line-height: 13.65pt;
            margin: 0;
            padding: 88pt 55pt 35.15pt 55pt;
            box-sizing: border-box;
            width: 210mm;
            min-height: 297mm;
            background-color: #fff;
            position: relative;
            overflow-wrap: normal;
            word-break: normal;
        }
        @media screen {
            html {
                width: 100%;
                min-height: 100%;
            }
            body {
                margin-left: auto;
                margin-right: auto;
            }
        }
        .documento-certificado {
            width: 100%;
            min-height: 297mm;
            box-sizing: border-box;
            padding: 0;
            margin: 0;
            position: relative;
        }
        .cert-content {
            width: 100%;
            font-size: 9pt;
            color: #000;
            line-height: 13.65pt;
        }
        .watermark {
            position: fixed;
            top: 40%;
            left: 10%;
            width: 80%;
            text-align: center;
            font-size: 58px;
            font-weight: 900;
            color: rgba(220, 38, 38, 0.12);
            text-transform: uppercase;
            letter-spacing: 6px;
            transform: rotate(-30deg);
            pointer-events: none;
            z-index: 9999;
        }
        .preview-badge {
            background-color: #fef3c7;
            border: 2px dashed #f59e0b;
            color: #92400e;
            padding: 6px 12px;
            text-align: center;
            font-weight: bold;
            font-size: 11px;
            letter-spacing: 1px;
            margin-bottom: 15px;
            border-radius: 6px;
        }
        .header {
            text-align: center;
            margin: 0;
            position: relative;
        }
        .header-sub {
            width: 241.8pt;
            margin-left: -25pt;
            margin-bottom: 36pt;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 8pt;
            color: #000;
            line-height: 10.5pt;
            letter-spacing: 0;
            text-align: center;
        }
        .title {
            font-size: 14pt;
            font-weight: bold;
            line-height: 16.8pt;
            margin: 0;
            text-align: center;
            text-transform: uppercase;
        }
        .cert-num {
            font-size: 10.5pt;
            font-weight: bold;
            line-height: 12.6pt;
            text-align: right;
            margin-bottom: 8pt;
        }
        .company-name {
            font-size: 10.5pt;
            line-height: 12.6pt;
            margin-bottom: 8pt;
            letter-spacing: 0.05pt;
            text-align: center;
        }
        .certifica-hdr {
            text-align: center;
            font-weight: bold;
            font-size: 9.5pt;
            line-height: 11pt;
            margin: 8pt 0 5pt 0;
            letter-spacing: 0;
        }
        .certifica-p {
            text-align: justify;
            margin: 0 0 5pt 0;
            font-size: 9.5pt;
            line-height: 14.25pt;
            letter-spacing: 0.04pt;
            word-spacing: 0.1pt;
        }
        table.data-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin: 0 0 7.5pt 0;
            font-size: 8.5pt;
            line-height: 10pt;
        }
        table.data-table td, table.data-table th {
            border: 0.5pt solid #000;
            height: 13.5pt;
            padding: 1.25pt 3pt;
            vertical-align: middle;
            overflow-wrap: anywhere;
        }
        table.data-table td.num {
            width: 22px;
            text-align: center;
            font-weight: bold;
        }
        table.data-table td.label {
            font-weight: normal;
        }
        table.data-table td.val {
            font-weight: bold;
        }
        .verif-title {
            font-weight: bold;
            margin: 0 0 3pt 0;
            font-size: 9.5pt;
            line-height: 12.5pt;
        }
        ol.verif-list {
            padding-left: 12pt;
            list-style: none;
            margin: 0 0 6pt 0;
            text-align: left;
            font-size: 9.5pt;
            line-height: 12.5pt;
        }
        ol.verif-list li {
            display: grid;
            grid-template-columns: 12pt minmax(0, 1fr);
            column-gap: 6pt;
            align-items: start;
            padding: 0;
            line-height: 12.5pt;
            margin: 0 0 1.5pt 0;
        }
        .verif-code {
            display: block;
            text-align: left;
        }
        .verif-text {
            display: block;
            min-width: 0;
            text-align: justify;
            overflow-wrap: anywhere;
        }
        .conclusion {
            padding-left: 18pt;
            text-align: justify;
            font-size: 9.5pt;
            line-height: 14.25pt;
            margin: 0 0 7pt 0;
        }
        .obs-sec {
            margin-top: 3pt;
            font-size: 9.5pt;
            line-height: 14.25pt;
            text-align: justify;
        }
        .obs-sec > div:not(.obs-header-line):not(.obs-dots-full):not(.obs-sec) { padding-left: 21pt; }
        .obs-header-line {
            display: flex;
            align-items: baseline;
            gap: 6px;
        }
        .obs-label {
            white-space: nowrap;
        }
        .obs-dots-container {
            flex: 1;
            height: 8px;
        }
        .obs-dots-full {
            width: 100%;
            height: 8px;
            margin-top: 4px;
        }
        .footer-date {
            margin-top: 12pt;
            text-align: left;
            font-size: 9.5pt;
            line-height: 14.25pt;
        }

        /* El diseño de sistema agrega reglas !important al final del head.
           Estas reglas, limitadas a GNV_ANUAL, conservan la escala de impresión del modelo. */
        html body {
            padding: 88pt 55pt 35.15pt 55pt !important;
            font-size: 9pt !important;
            line-height: 13.65pt !important;
        }
        html body .documento-certificado {
            width: 100% !important;
            min-height: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
        }
        html body .documento-certificado .cert-content {
            width: 100% !important;
            font-size: 9pt !important;
            line-height: 13.65pt !important;
        }
        html body .documento-certificado .header .title[data-sistema-edicion="titulo"] {
            font-size: 14pt !important;
            line-height: 16.8pt !important;
            margin-top: 10.5pt !important;
            margin-bottom: 8pt !important;
        }
        html body table.data-table {
            width: 100% !important;
            font-size: 8.5pt !important;
            line-height: 10pt !important;
        }
        html body table.data-table td,
        html body table.data-table th {
            height: 13.5pt !important;
            padding: 1.25pt 3pt !important;
            border-width: 0.5pt !important;
        }
        html body .documento-certificado .footer-date[data-sistema-edicion="pie"] {
            font-size: 9.5pt !important;
            line-height: 14.25pt !important;
            margin-top: 12pt !important;
            text-align: left !important;
        }
    </style>
</head>
<body>
    ${options.modo === "PREVIEW" ? `<div class="watermark">PREVISUALIZACIÓN</div>
    <div class="preview-badge">⚠️ BORRADOR FAREGAS — PREVISUALIZACIÓN NO EMITIDA (DOCUMENTO SIN VALIDEZ LEGAL)</div>` : ""}

    <div class="documento-certificado">
        <div class="cert-content">
            <div class="header">
                <div class="header-sub">
                    R.D. N° 0296-2024 - MTC/17.03<br>
                    Domicilio Fiscal: Jr. Alberto Secada N°315 Prov.<br>
                    Const del Callao – Prov. Const del Callao<br>
                    Celular: 966702160
                </div>
                <div class="title" style="margin-top: 10px; margin-bottom: 10px;" data-sistema-edicion="titulo">CERTIFICADO DE INSPECCION ANUAL DEL VEHICULO A GNV</div>
                <div class="cert-num" style="text-align: right;">Certificado N° ${escapeHtml(numCertificado)}</div>
                <div class="company-name" style="font-weight: bold;">SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.</div>
    </div>

    <div class="certifica-hdr" data-sistema-edicion="titulo-certifica">CERTIFICA</div>
    <div class="certifica-p">
        Haber efectuado la evaluación de las condiciones de seguridad respecto de la conversión del sistema de combustión a Gas Natural - GNV, efectuada por el Taller de Conversión Autorizado: ${escapeHtml(tallerNombre || '-')}, al siguiente vehículo:
    </div>

    <table class="data-table">
        <colgroup>
            <col style="width: 3.8%;">
            <col style="width: 19.6%;">
            <col style="width: 22.8%;">
            <col style="width: 3.8%;">
            <col style="width: 27.2%;">
            <col style="width: 22.8%;">
        </colgroup>
        <tr>
            <td class="num">1</td>
            <td class="label">Placa de Rodaje</td>
            <td class="val">${escapeHtml(veh.placa || cert.placa_nueva || '-')}</td>
            <td class="num">9</td>
            <td class="label">N° Cilindros / Cilindrada (cm3)</td>
            <td class="val">${escapeHtml(formatNumberWithoutTrailingZeros(veh.cilindros))} / ${escapeHtml(formatNumberWithoutTrailingZeros(veh.cilindrada))}</td>
        </tr>
        <tr>
            <td class="num">2</td>
            <td class="label">Categoría</td>
            <td class="val">${escapeHtml(veh.categoria || '-')}</td>
            <td class="num">10</td>
            <td class="label">Combustible</td>
            <td class="val">${escapeHtml(veh.combustible || 'BI-COMBUSTIBLE GNV')}</td>
        </tr>
        <tr>
            <td class="num">3</td>
            <td class="label">Marca</td>
            <td class="val">${escapeHtml(veh.marca || '-')}</td>
            <td class="num">11</td>
            <td class="label">N° ejes / N° ruedas</td>
            <td class="val">${escapeHtml(formatCountTwoDigits(veh.ejes))} / ${escapeHtml(formatCountTwoDigits(veh.ruedas))}</td>
        </tr>
        <tr>
            <td class="num">4</td>
            <td class="label">Modelo</td>
            <td class="val">${escapeHtml(veh.modelo || '-')}</td>
            <td class="num">12</td>
            <td class="label">N° Asientos / Pasajeros</td>
            <td class="val">${escapeHtml(formatCountTwoDigits(veh.asientos))} / ${escapeHtml(formatCountTwoDigits(veh.pasajeros))}</td>
        </tr>
        <tr>
            <td class="num">5</td>
            <td class="label">Versión</td>
            <td class="val">${escapeHtml(veh.version || '-')}</td>
            <td class="num">13</td>
            <td class="label">Largo / Ancho / Alto (m)</td>
            <td class="val">${escapeHtml(formatNumberWithoutTrailingZeros(veh.longitud))} / ${escapeHtml(formatNumberWithoutTrailingZeros(veh.ancho))} / ${escapeHtml(formatNumberWithoutTrailingZeros(veh.altura))}</td>
        </tr>
        <tr>
            <td class="num">6</td>
            <td class="label">Año de fabricación</td>
            <td class="val">${escapeHtml(veh.ano_fabricacion || '-')}</td>
            <td class="num">14</td>
            <td class="label">Color (es)</td>
            <td class="val">${escapeHtml(veh.color || '-')}</td>
        </tr>
        <tr>
            <td class="num">7</td>
            <td class="label">VIN / N° de Serie</td>
            <td class="val">${escapeHtml(veh.vin || veh.serie || '-')}</td>
            <td class="num">15</td>
            <td class="label">Peso neto vehicular (kg.)</td>
            <td class="val">${escapeHtml(formatNumberWithoutTrailingZeros(veh.peso_seco || veh.peso_neto))}</td>
        </tr>
        <tr>
            <td class="num">8</td>
            <td class="label">N° de motor</td>
            <td class="val">${escapeHtml(veh.motor || '-')}</td>
            <td class="num">16</td>
            <td class="label">Peso bruto vehicular (kg.)</td>
            <td class="val">${escapeHtml(formatNumberWithoutTrailingZeros(veh.peso_bruto))}</td>
        </tr>
    </table>

    <div class="verif-title">Habiéndose verificado que:</div>
    <ol class="verif-list">
        ${verifHtml}
    </ol>
    <div class="conclusion">
        Conste por el presente documento que el sistema de combustión a Gas Natural Vehicular – GNV del vehículo antes referido, no afecta negativamente la seguridad del mismo, el tránsito terrestre, el medio ambiente o incumplen las condiciones técnicas establecidas en la normativa vigente en la materia, habilitándose al mismo para cargar Gas Natural Vehicular – GNV hasta el <strong>${escapeHtml(vigenciaHastaFmt)}</strong>.
    </div>

    <div class="obs-sec">
        ${obsContentHtml}
    </div>

    <div class="footer-date" data-sistema-edicion="pie">
        Se expide el presente certificado en Lima a los <strong>${fechaImp.dia}</strong> días del mes de <strong>${fechaImp.mes}</strong> del <strong>${fechaImp.anio}</strong>.
    </div>
        </div>
    </div>
</body>
</html>`;
}

module.exports = generateGnvAnualHtml;
