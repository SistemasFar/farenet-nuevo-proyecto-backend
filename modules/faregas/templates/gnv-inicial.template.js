const { escapeHtml, formatDateLong, formatDateShort } = require('./template-utils');

function generateGnvInicialHtml(data, options = { modo: "PREVIEW" }) {
    const cert = data.cabecera || {};
    const veh = data.vehiculo || {};
    const gnv = data.gnv || {};
    const componentes = data.componentes || [];

    const numCertificado = cert.numero_certificado || 'PENDIENTE';

    // Formatear la fecha
    let dateStr = cert.fecha_emision || new Date();
    const d = new Date(dateStr);
    const day = d.getDate();
    const month = d.toLocaleString('es-ES', { month: 'long' }).toUpperCase();
    const year = d.getFullYear();
    const fechaLima = `${day} de ${month} del ${year}`;

    const tallerNombre = gnv.taller_razon_social || '';

    // Render components rows
    const compRowsHtml = componentes.length > 0 ? componentes.map((c, i) => `
        <tr>
            <td style="text-align: center;">${c.orden}</td>
            <td style="text-align: center;">${escapeHtml(c.componente || '')}</td>
            <td style="text-align: center; ">${escapeHtml(c.marca || '')}</td>
            <td style="text-align: center; ">${escapeHtml(c.numero_serie || '')}</td>
            <td style="text-align: center; ">${escapeHtml(c.capacidad_litros || '')}</td>
            <td style="text-align: center; ">${escapeHtml(c.mes_fabricacion ? String(c.mes_fabricacion).padStart(2, '0') : '')}/${escapeHtml(c.anio_fabricacion || '')}</td>
        </tr>
    `).join('') : `
        <tr>
            <td style="text-align: center;">1</td>
            <td style="text-align: center;">Reductor</td>
            <td style="text-align: center; "></td>
            <td style="text-align: center; "></td>
            <td style="text-align: center; ">NO APLICA</td>
            <td style="text-align: center; ">/</td>
        </tr>
        <tr>
            <td style="text-align: center;">2</td>
            <td style="text-align: center;">Cilindro (s)</td>
            <td style="text-align: center; "></td>
            <td style="text-align: center; "></td>
            <td style="text-align: center; "></td>
            <td style="text-align: center; ">/</td>
        </tr>
    `;

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Certificado GNV Inicial - Previsualización</title>
    <style>
        @page { size: A4 portrait; margin: 0; }
        body {
            font-family: Arial, Helvetica, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #fff;
            position: relative;
            overflow-wrap: anywhere;
            word-break: break-word;
        }
        .documento-certificado {
            width: 210mm;
            min-height: 297mm;
            box-sizing: border-box;
            padding: 20mm 15mm 15mm 15mm;
            margin: 0 auto;
            position: relative;
        }
        .cert-content {
            font-size: 11px;
            color: #000;
            line-height: 1.35;
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
            margin-bottom: 12px;
            position: relative;
        }
        .header-sub {
            font-size: 9.5px;
            color: #333;
            line-height: 1.3;
            text-align: left;
        }
        .title {
            font-size: 14px;
            font-weight: bold;
            margin: 12px 0 4px 0;
            text-align: center;
            text-transform: uppercase;
        }
        .cert-num {
            font-size: 12px;
            font-weight: bold;
            text-align: right;
            margin-bottom: 10px;
        }
        .certifica-hdr {
            text-align: left;
            font-weight: bold;
            font-size: 12px;
            margin: 10px 0 6px 0;
            letter-spacing: 1px;
        }
        .certifica-p {
            text-align: justify;
            margin-bottom: 10px;
            font-size: 10.5px;
        }
        table.data-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
            font-size: 10px;
        }
        table.data-table td, table.data-table th {
            border: 1px solid #000;
            padding: 4px 6px;
            vertical-align: middle;
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
            
        }
        table.comp-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
            font-size: 10px;
        }
        table.comp-table th, table.comp-table td {
            border: 1px solid #000;
            padding: 4px;
        }
        .obs-sec {
            margin-top: 10px;
            font-size: 10.5px;
            text-align: justify;
            line-height: 1.4;
        }
        .footer-date {
            margin-top: 20px;
            text-align: left;
            font-size: 10.5px;
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
                    Domicilio Fiscal: Jr. Alberto Secada N.°315 Prov.<br>
                    Const del Callao – Prov. Const del Callao.<br>
                    Celular: 966702160
                </div>
                <div class="title">CERTIFICADO DE CONFORMIDAD DE CONVERSIÓN A GNV</div>
                <div class="cert-num">CERTIFICADO N°: <span style="">${escapeHtml(numCertificado)}</span></div>
                <div style="font-weight: bold; font-size: 12px; margin-bottom: 10px; text-align: center;">SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.</div>
            </div>

            <div class="certifica-hdr">CERTIFICA:</div>
            <div class="certifica-p">
                Haber efectuado la evaluación de las condiciones de seguridad respecto de la conversión del sistema de combustión a Gas Natural Vehicular - GNV efectuada por el Taller de Conversión Autorizado: <strong>CONVERTIGAS S.A.C FAREGAS I</strong> al siguiente vehículo:
            </div>

            <table class="data-table">
                <tr>
                    <td class="num">1</td>
                    <td class="label">Placa de Rodaje</td>
                    <td class="val">${escapeHtml(veh.placa || cert.placa_nueva || '-')}</td>
                    <td class="num">9</td>
                    <td class="label">N° Cilindros / Cilindrada (cm3)</td>
                    <td class="val">${escapeHtml(veh.cilindros || '-')} / ${escapeHtml(veh.cilindrada || '-')}</td>
                </tr>
                <tr>
                    <td class="num">2</td>
                    <td class="label">Categoría</td>
                    <td class="val">${escapeHtml(veh.categoria || '-')}</td>
                    <td class="num">10</td>
                    <td class="label">Combustible</td>
                    <td class="val">${escapeHtml(veh.combustible || '-')}</td>
                </tr>
                <tr>
                    <td class="num">3</td>
                    <td class="label">Marca</td>
                    <td class="val">${escapeHtml(veh.marca || '-')}</td>
                    <td class="num">11</td>
                    <td class="label">N° ejes / N° ruedas</td>
                    <td class="val">${escapeHtml(veh.ejes || '-')} / ${escapeHtml(veh.ruedas || '-')}</td>
                </tr>
                <tr>
                    <td class="num">4</td>
                    <td class="label">Modelo</td>
                    <td class="val">${escapeHtml(veh.modelo || '-')}</td>
                    <td class="num">12</td>
                    <td class="label">N° Asientos / Pasajeros</td>
                    <td class="val">${escapeHtml(veh.asientos || '-')} / ${escapeHtml(veh.pasajeros || '-')}</td>
                </tr>
                <tr>
                    <td class="num">5</td>
                    <td class="label">Versión</td>
                    <td class="val">${escapeHtml(veh.version || '-')}</td>
                    <td class="num">13</td>
                    <td class="label">Largo / Ancho / Alto (m)</td>
                    <td class="val">${escapeHtml(veh.longitud || '-')} / ${escapeHtml(veh.ancho || '-')} / ${escapeHtml(veh.altura || '-')}</td>
                </tr>
                <tr>
                    <td class="num">6</td>
                    <td class="label">Año de Fabricación</td>
                    <td class="val">${escapeHtml(veh.anio_fabricacion || '-')}</td>
                    <td class="num">14</td>
                    <td class="label">Color(es)</td>
                    <td class="val">${escapeHtml(veh.color || '-')}</td>
                </tr>
                <tr>
                    <td class="num">7</td>
                    <td class="label">VIN / N° de Serie</td>
                    <td class="val">${escapeHtml(veh.vin || veh.serie || '-')}</td>
                    <td class="num">15</td>
                    <td class="label">Peso Neto (Kg.)</td>
                    <td class="val">${escapeHtml(veh.peso_neto || '-')}</td>
                </tr>
                <tr>
                    <td class="num">8</td>
                    <td class="label">N° de Motor</td>
                    <td class="val">${escapeHtml(veh.motor || '-')}</td>
                    <td class="num">16</td>
                    <td class="label">Peso bruto vehicular (Kg.)</td>
                    <td class="val">${escapeHtml(veh.peso_bruto || '-')}</td>
                </tr>
            </table>

            <div style="margin-bottom: 8px; font-size: 10.5px;">Habiéndose instalado al mismo los siguientes componentes:</div>
            
            <table class="comp-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>COMPONENTE</th>
                        <th>MARCA</th>
                        <th>N° DE SERIE</th>
                        <th>CAP. (Lts)</th>
                        <th>FECHA FAB. (MM/AA)</th>
                    </tr>
                </thead>
                <tbody>
                    ${compRowsHtml}
                </tbody>
            </table>

            <div style="margin-top: 10px; margin-bottom: 8px; font-size: 10.5px;">Como consecuencia de la conversión del sistema de combustión a Gas Natural Vehicular-GNV, las características originales del vehículo se han modificado de la siguiente manera:</div>

            <table class="data-table" style="margin-bottom: 15px;">
                <tr>
                    <td class="num" style="width: 25px;">10</td>
                    <td style="width: 150px;">COMBUSTIBLE</td>
                    <td style="">${escapeHtml(gnv.combustible_posterior || 'BI - COMBUSTIBLE GNV')}</td>
                </tr>
                <tr>
                    <td class="num">15</td>
                    <td>PESO NETO (Kg.)</td>
                    <td style="">${escapeHtml(gnv.peso_neto_posterior || '-')}</td>
                </tr>
            </table>

            <div class="certifica-p">
                Asimismo, se certifica que la conversión del sistema de combustión a Gas Natural Vehicular-GNV efectuada al vehículo antes referido no afecta negativamente la seguridad del mismo, el tránsito terrestre, el medio ambiente o incumple las condiciones técnicas establecidas en la normativa vigente en la materia.
            </div>

            <div style="font-weight: bold; font-size: 11px; margin-top: 10px; margin-bottom: 5px;">OBSERVACIONES:</div>
            <div class="obs-sec">
                Numerales del 1 al 16, obtenidos de la tarjeta de propiedad del vehículo y/o suministro del cliente, por tal motivo deberán ser verificados por el cliente antes de realizar cualquier trámite con este certificado. Las condiciones técnicas y de seguridad verificadas en el vehículo, corresponden a las expuestas en la NTP 111.015:2004 y Directiva N° 001-2005-MTC/15. La sigla "NE" significa "dato no especificado en los documentos o plaqueta del vehículo".<br><br>
                Cumpliendo con D.S. 047-2001-MTC, modificatorias 009-2012 MINAM, D.S N° 010-2017 – MINAM, carta N° 0124-2018-MINAM/VMGA/DGCA indicamos que el resultado de la prueba de emisiones contaminantes del vehículo es aprobatorio
            </div>

            <div class="footer-date">
                Se expide el presente certificado en la ciudad de Lima, al <span style="">${fechaLima}</span>.
            </div>
        </div>
    </div>
</body>
</html>`;
}

module.exports = generateGnvInicialHtml;
