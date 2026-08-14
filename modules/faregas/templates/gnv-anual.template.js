const { escapeHtml, formatDateLong, formatDateShort } = require('./template-utils');

function generateGnvAnualHtml(data) {
    const cert = data.cabecera || {};
    const veh = data.vehiculo || {};
    const gnv = data.gnv || {};
    const verifs = data.verificaciones || [];
    const titulares = data.titulares || [];

    const numCertificado = 'DG-22-PREVIEW';

    const fechaImp = formatDateLong(cert.fecha_emision);
    const vigenciaHastaFmt = formatDateShort(gnv.vigencia_hasta);

    const tallerNombre = gnv.taller_razon_social || '';
    const tallerSede = gnv.taller_sede || '';

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
        return `<li style="margin-bottom: 5px;"><strong>${v.code})</strong> ${escapeHtml(desc)}${estadoLabel}</li>`;
    }).join('');

    const entNombre = cert.entidad_certificadora_nombre || '-';
    const resDirectoral = cert.resolucion_directoral || '-';
    const domFiscal = cert.domicilio_fiscal || '-';
    const telfCert = cert.telefono_certificadora || '-';
    const lugarEmision = cert.lugar_emision || '-';

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Certificado GNV Anual - Previsualización</title>
    <style>
        @page { size: A4 portrait; margin: 15mm; }
        body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 11px;
            color: #000;
            line-height: 1.35;
            margin: 0;
            padding: 20px;
            background-color: #fff;
            position: relative;
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
            margin-bottom: 12px;
            position: relative;
        }
        .header-sub {
            font-size: 9.5px;
            color: #333;
            line-height: 1.3;
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
            text-align: center;
            font-weight: bold;
            font-size: 11px;
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
            font-weight: bold;
        }
        .verif-title {
            font-weight: bold;
            margin: 10px 0 4px 0;
        }
        ol.verif-list {
            padding-left: 0;
            list-style: none;
            margin: 0 0 10px 0;
            text-align: justify;
            font-size: 10px;
        }
        .obs-sec {
            margin-top: 10px;
            font-size: 10px;
        }
        .footer-date {
            margin-top: 20px;
            text-align: left;
            font-size: 10.5px;
        }
    </style>
</head>
<body>
    <div class="watermark">PREVISUALIZACIÓN</div>
    <div class="preview-badge">⚠️ BORRADOR FAREGAS — PREVISUALIZACIÓN NO EMITIDA (DOCUMENTO SIN VALIDEZ LEGAL)</div>

    <div class="header">
        <div class="header-sub">
            ${escapeHtml(resDirectoral)}<br>
            Domicilio Fiscal: ${escapeHtml(domFiscal)}<br>
            Celular: ${escapeHtml(telfCert)}
        </div>
        <div class="title">CERTIFICADO DE INSPECCION ANUAL DEL VEHICULO A GNV</div>
        <div class="cert-num">Certificado N° ${escapeHtml(numCertificado)}</div>
        <div style="font-weight: bold; font-size: 11px; margin-top: 4px;">${escapeHtml(entNombre)}</div>
    </div>

    <div class="certifica-hdr">CERTIFICA</div>
    <div class="certifica-p">
        Haber efectuado la evaluación de las condiciones de seguridad respecto de la conversión del sistema de combustión a Gas Natural - GNV, efectuada por el Taller de Conversión Autorizado: <strong>${escapeHtml(tallerNombre || '-')}</strong>, al siguiente vehículo:
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
            <td class="val">${escapeHtml(veh.combustible || 'BI-COMBUSTIBLE GNV')}</td>
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
            <td class="val">${escapeHtml(veh.peso_seco || veh.peso_neto || '-')}</td>
        </tr>
        <tr>
            <td class="num">8</td>
            <td class="label">N° de motor</td>
            <td class="val">${escapeHtml(veh.motor || '-')}</td>
            <td class="num">16</td>
            <td class="label">Peso bruto vehicular (kg.)</td>
            <td class="val">${escapeHtml(veh.peso_bruto || '-')}</td>
        </tr>
    </table>

    <div class="verif-title">Habiéndose verificado que:</div>
    <ol class="verif-list">
        ${verifHtml}
    </ol>
    <div style="text-align: justify; font-size: 10px; margin-bottom: 10px;">
        Conste por el presente documento que el sistema de combustión a Gas Natural Vehicular – GNV del vehículo antes referido, no afecta negativamente la seguridad del mismo, el tránsito terrestre, el medio ambiente o incumplen las condiciones técnicas establecidas en la normativa vigente en la materia, habilitándose al mismo para cargar Gas Natural Vehicular – GNV hasta el <strong>${escapeHtml(vigenciaHastaFmt)}</strong>.
    </div>

    <div class="obs-sec">
        <strong>OBSERVACIONES:</strong> ${escapeHtml(cert.observaciones || '……………………………………………………………………………………………………………………….')}
    </div>

    <div class="footer-date">
        Se expide el presente certificado en <strong>${escapeHtml(lugarEmision)}</strong> a los <strong>${fechaImp.dia}</strong> días del mes de <strong>${fechaImp.mes}</strong> del <strong>${fechaImp.anio}</strong>.
    </div>
</body>
</html>`;
}

module.exports = generateGnvAnualHtml;
