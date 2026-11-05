const { escapeHtml, formatDateLong, formatDateShort, formatNumberWithoutTrailingZeros, formatNumeroCertificado, NUMERO_CERTIFICADO_PENDIENTE } = require('./template-utils');

function generateGlpInicialHtml(data, options = { modo: "PREVIEW" }) {
    const cert = data.cabecera || {};
    const veh = data.vehiculo || {};
    const glp = data.glp || {};
    const componentes = data.componentes || [];
    const verifs = data.verificaciones || [];
    const titulares = data.titulares || [];

    const numCertificado = cert.numero_certificado || NUMERO_CERTIFICADO_PENDIENTE;

    const fechaImp = formatDateLong(cert.fecha_emision);
    const vigenciaHastaFmt = formatDateShort(glp.vigencia_hasta);

    const formatoDosDigitos = (valor) => {
        const entero = formatNumberWithoutTrailingZeros(valor, '');
        return /^\d+$/.test(entero) ? entero.padStart(2, '0') : entero;
    };

    const propietarioNombre = titulares.length > 0
        ? titulares.map(t => t.nombre_razon_social).join(' / ')
        : (cert.cliente_nombre || '-');

const tallerDisplay = 'CHARING S.A.C. Calle San Pedro N° 745 Surquillo Lima';

    // Identifica si el certificado pertenece al flujo TALLER_INSPECCION para aplicar
    // la normalización de observaciones: "NINGUNA" si viene vacío, o el texto exacto si hay observación.
    const esTaller = cert && cert.servicio_tipo_flujo === 'TALLER_INSPECCION';
    let observacionesMostrar;
    if (esTaller) {
        const obsRaw = cert.observaciones || '';
        observacionesMostrar = String(obsRaw.trim()) || 'NINGUNA';
    } else {
        // Sin transformación: el campo opcional mantiene su valor original.
        observacionesMostrar = cert.observaciones;
    }

    // Verificaciones 1-7 GLP INICIAL
    const verifMap = {};
    verifs.forEach(v => { verifMap[v.codigo] = v; });

    const reqVerifsGlp = [
        { code: '1', desc: 'El sistema de combustión a GLP (cilindro y kit de conversión) responde a las características originales recomendadas por el fabricante del vehículo y/o el Proveedor de Equipos Completos de Conversión a GLP (PEC-GLP), cumple con la Norma Técnica Peruana NTP 321.115:2003 y su montaje cumple las exigencias sobre la ventilación en las distintas zonas de instalación.' },
        { code: '2', desc: 'El vaporizador/regulador cuenta con un sistema de corte de gas automático, en el caso que el motor deje de funcionar.' },
        { code: '3', desc: 'El tanque de almacenamiento de GLP ha sido fabricado bajo normas ASME Sección VIII y cumple las normas dictadas para recipientes a presión.' },
        { code: '4', desc: 'El tanque de almacenamiento de GLP cuenta con los siguientes componentes:<br>4.1 Válvula check en la entrada de gas<br>4.2 Limitador automático de carga al 80%<br>4.3 Válvula de exceso de presión<br>4.4 Válvula de exceso de flujo' },
        { code: '5', desc: 'Los accesorios e insumos (mangueras, tuberías y válvulas) utilizados en la instalación han sido certificados para el uso de GLP.' },
        { code: '6', desc: 'No existan fugas en los empalmes o uniones y los elementos de cierre actúan herméticamente.' },
        { code: '7', desc: 'Los controles ubicados en el tablero del vehículo responden a las exigencias para los cuales fueron montados.' }
    ];

    const verifHtml = reqVerifsGlp.map(v => {
        const item = verifMap[v.code];
        const desc = item ? escapeHtml(item.descripcion).replace(/\\n/g, '<br>') : v.desc;
        let estadoLabel = '';
        if (item && item.cumple === true) {
            estadoLabel = '';
        } else if (item && item.cumple === false) {
            estadoLabel = ` <span style="color: red; font-weight: bold;">[NO CUMPLE${item.observacion ? ': ' + escapeHtml(item.observacion) : ''}]</span>`;
        } else {
            estadoLabel = ` <span style="color: #d97706; font-weight: bold;">[PENDIENTE DE EVALUACIÓN]</span>`;
        }
        return `<li style="margin-bottom: 3px;"><strong>${v.code}.</strong> ${desc}${estadoLabel}</li>`;
    }).join('');

    // Componentes rows
    const compRowsHtml = componentes.length > 0 ? componentes.map((c, i) => {
        let modRaw = (c.modelo || '').trim();
        if (modRaw.toUpperCase() === 'Q') modRaw = '';
        let modStr = escapeHtml(modRaw);
        if (c.componente === 'CILINDRO' && (c.capacidad_litros || c.anio_fabricacion)) {
            const capVal = formatNumeroCertificado(c.capacidad_litros);
            const cap = capVal ? `${capVal} LTS` : '';
            const anio = c.anio_fabricacion ? `${c.mes_fabricacion ? String(c.mes_fabricacion).padStart(2, '0') + '-' : ''}${c.anio_fabricacion}` : '';
            const extra = [cap, anio].filter(Boolean).join(' / ');
            if (extra) modStr = extra; // Solo mostrar el extra, omitiendo el modelo original
        }
        return `<tr>
            <td style="text-align: center;">${i + 1}</td>
            <td>${escapeHtml(c.componente)}</td>
            <td>${escapeHtml(c.marca || '-')}</td>
            <td>${modStr || '-'}</td>
            <td>${escapeHtml(c.numero_serie || 'NE')}</td>
        </tr>`;
    }).join('') : `
        <tr>
            <td style="text-align: center;">1</td>
            <td>Cilindro</td>
            <td>-</td>
            <td>-</td>
            <td>NE</td>
        </tr>
        <tr>
            <td style="text-align: center;">2</td>
            <td>Regulador</td>
            <td>-</td>
            <td>-</td>
            <td>NE</td>
        </tr>
    `;

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Certificado GLP Inicial - Previsualización</title>
    <style>
        @page { size: A4 portrait; margin: 0; }
        html {
            width: 210mm;
            min-height: 297mm;
        }
        body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 8pt;
            color: #000;
            line-height: 1.15;
            margin: 0;
            padding: 75pt 37.4pt 35.15pt 72pt;
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
        }
        .header-sub {
            width: 257.35pt;
            margin-left: -43.75pt;
            font-size: 8pt;
            color: #000;
            line-height: 1.15;
            text-align: center;
        }
        .title {
            font-size: 13pt;
            font-weight: bold;
            line-height: 1.15;
            margin: 0;
            text-align: center;
            text-transform: uppercase;
        }
        .cert-num {
            font-size: 10pt;
            font-weight: bold;
            line-height: 1.2;
            text-align: right;
        }
        .certifica-hdr {
            text-align: center;
            font-weight: bold;
            font-size: 10.5px;
            margin: 8px 0 4px 0;
        }
        .certifica-p {
            text-align: justify;
            margin: 0;
            font-size: 9pt;
            line-height: 11pt;
        }
        table.data-table {
            width: 489.3pt;
            border-collapse: collapse;
            table-layout: fixed;
            margin: 0;
            font-size: 9pt;
            line-height: 1.05;
        }
        table.data-table td {
            border: 0.5pt solid #000;
            padding: 1.5pt 3.5pt;
            vertical-align: middle;
        }
        table.main-data-table tr:first-child td {
            padding-top: 4.25pt;
            padding-bottom: 4.25pt;
        }
        table.data-table td.num {
            text-align: center;
            font-weight: normal;
        }
        table.data-table td.val {
            font-weight: normal;
            background-color: transparent;
        }
        table.main-data-table tr:first-child td.val,
        table.main-data-table tr:nth-child(2) td:nth-child(3) {
            font-weight: bold;
        }
        .comp-title {
            font-size: 8pt;
            line-height: 1.15;
            margin: 4pt 0 5pt 0;
        }
        table.comp-table {
            width: 489.3pt;
            border-collapse: collapse;
            table-layout: fixed;
            margin: 0 0 4pt 0;
            font-size: 9pt;
            line-height: 1.05;
        }
        table.comp-table th, table.comp-table td {
            border: 0.5pt solid #000;
            padding: 1.75pt 3.5pt;
            text-align: center;
            vertical-align: middle;
        }
        table.comp-table th {
            background-color: #fff;
            font-weight: normal;
            padding-top: 1.25pt;
            padding-bottom: 1.25pt;
        }
        .verif-title {
            font-weight: bold;
            margin: 0;
            font-size: 8pt;
            line-height: 1.15;
        }
        ol.verif-list {
            padding-left: 0;
            list-style: none;
            margin: 0;
            text-align: justify;
            font-size: 8pt;
            line-height: 1.15;
        }
        ol.verif-list li {
            margin-bottom: 0 !important;
            padding-left: 9pt;
            text-indent: -9pt;
        }
        .conclusion {
            margin: 0;
            text-align: justify;
            font-size: 8pt;
            line-height: 1.15;
        }
        .obs-sec {
            margin-top: 4pt;
            font-size: 8pt;
            line-height: 1.15;
        }
        .obs-sec > div:not(:first-of-type) {
            padding-left: 21pt;
        }
        .footer-sec {
            margin-top: 5pt;
            font-size: 8pt;
            line-height: 1.15;
        }
    </style>
</head>
<body>
    ${options.modo === "PREVIEW" ? `<div class="watermark">PREVISUALIZACIÓN</div>
    <div class="preview-badge">⚠️ BORRADOR FAREGAS — PREVISUALIZACIÓN NO EMITIDA (DOCUMENTO SIN VALIDEZ LEGAL)</div>` : ""}

    <div class="documento-certificado">
        <div class="cert-content">
            <div class="header">
                <div class="header-sub" style="margin-bottom: 8.2pt;">
                    R.D. N.º 0339-2024-MTC/17.03<br>
                    Domicilio Fiscal: Jr. Alberto Secada N.°315 Prov.<br>
                    Const del Callao – Prov. Const del Callao.<br>
                    Celular: 966702160
                </div>
                <div class="title" style="margin-top: 0; margin-bottom: 4pt;" data-sistema-edicion="titulo">CERTIFICADO DE CONFORMIDAD DE CONVERSION GLP</div>
                <div class="cert-num" style="text-align: right; margin-bottom: 9.5pt;">
                    Certificado N°${escapeHtml(numCertificado)}
                </div>
                <div style="font-weight: bold; font-size: 10pt; line-height: 1.2; margin-bottom: 14pt; letter-spacing: 0; text-align: center;">SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.</div>
            </div>
            
            <div style="text-align: center; font-weight: bold; font-size: 9pt; line-height: 1.15; margin: 0;" data-sistema-edicion="titulo-certifica">CERTIFICA</div>

    <div class="certifica-p" data-sistema-edicion="descripcion-certifica">
        Haber efectuado la evaluación de las condiciones de seguridad respecto de la conversión del sistema de combustión a Gas Licuado de Petróleo - GLP efectuada por el Taller de Conversión a GLP Autorizado: <strong>CHARING S.A.C. - Calle San Pedro N° 745 Surquillo Lima</strong>, al siguiente vehículo:
    </div>

    <table class="data-table main-data-table">
        <colgroup>
            <col style="width: 3.71%;">
            <col style="width: 17.91%;">
            <col style="width: 24.66%;">
            <col style="width: 3.59%;">
            <col style="width: 29.76%;">
            <col style="width: 20.37%;">
        </colgroup>
        <tr>
            <td class="num">1</td>
            <td style="width: 80px;">Propietario</td>
            <td colspan="4" class="val" style="background-color: transparent;">${escapeHtml(propietarioNombre)}</td>
        </tr>
        <tr>
            <td class="num">2</td>
            <td>Placa de Rodaje</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.placa || cert.placa_nueva || '-')}</td>
            <td class="num">10</td>
            <td>N° Cilindros / Cilindrada (cm3)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(formatNumberWithoutTrailingZeros(veh.cilindros))} / ${escapeHtml(formatNumberWithoutTrailingZeros(veh.cilindrada))}</td>
        </tr>
        <tr>
            <td class="num">3</td>
            <td>Categoría</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.categoria || '-')}</td>
            <td class="num">11</td>
            <td>Combustible</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.combustible || 'GASOLINA')}</td>
        </tr>
        <tr>
            <td class="num">4</td>
            <td>Marca</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.marca || '-')}</td>
            <td class="num">12</td>
            <td>N° ejes / N° ruedas</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(formatoDosDigitos(veh.ejes))} / ${escapeHtml(formatoDosDigitos(veh.ruedas))}</td>
        </tr>
        <tr>
            <td class="num">5</td>
            <td>Modelo</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.modelo || '-')}</td>
            <td class="num">13</td>
            <td>N° Asientos / Pasajeros</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(formatoDosDigitos(veh.asientos))} / ${escapeHtml(formatoDosDigitos(veh.pasajeros))}</td>
        </tr>
        <tr>
            <td class="num">6</td>
            <td>Versión</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.version || '-')}</td>
            <td class="num">14</td>
            <td>Largo / Ancho / Alto (m)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(formatNumberWithoutTrailingZeros(veh.longitud))} / ${escapeHtml(formatNumberWithoutTrailingZeros(veh.ancho))} / ${escapeHtml(formatNumberWithoutTrailingZeros(veh.altura))}</td>
        </tr>
        <tr>
            <td class="num">7</td>
            <td>Año de fabricación</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.ano_fabricacion || '-')}</td>
            <td class="num">15</td>
            <td>Peso neto (kg.)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(formatNumberWithoutTrailingZeros(veh.peso_seco || veh.peso_neto))}</td>
        </tr>
        <tr>
            <td class="num">8</td>
            <td>VIN / N° de Serie</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.vin || veh.serie || '-')}</td>
            <td class="num">16</td>
            <td>Peso bruto vehicular (kg.)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(formatNumberWithoutTrailingZeros(veh.peso_bruto))}</td>
        </tr>
        <tr>
            <td class="num">9</td>
            <td>N° de motor</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.motor || '-')}</td>
            <td class="num">17</td>
            <td>Carga útil (kg.)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(formatNumberWithoutTrailingZeros(veh.carga_util))}</td>
        </tr>
    </table>

    <div class="comp-title">Que cuenta con los siguientes componentes que permiten la combustión a GLP:</div>
    <table class="comp-table">
        <colgroup>
            <col style="width: 5.92%;">
            <col style="width: 23.44%;">
            <col style="width: 22.86%;">
            <col style="width: 24.62%;">
            <col style="width: 23.16%;">
        </colgroup>
        <thead>
            <tr>
                <th style="width: 30px;">Ítem</th>
                <th>Componente</th>
                <th>Marca</th>
                <th>Modelo (*)</th>
                <th>N° de Serie</th>
            </tr>
        </thead>
        <tbody>
            ${compRowsHtml}
        </tbody>
    </table>

    <div class="comp-title" style="margin-top: 0; margin-bottom: 5pt;">Como consecuencia de la conversión del sistema de combustión a GLP, las características originales del vehículo se han modificado<br>De la siguiente manera:</div>
    <table class="data-table conversion-data-table" style="margin-bottom: 0;">
        <colgroup>
            <col style="width: 3.61%;">
            <col style="width: 17.34%;">
            <col style="width: 79.05%;">
        </colgroup>
        <tr>
            <td class="num">11</td>
            <td style="width: 140px;">Combustible</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(glp.combustible_posterior || 'BI-COMBUSTIBLE GLP')}</td>
        </tr>
        <tr>
            <td class="num">15</td>
            <td>Peso neto (Kg.)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(formatNumberWithoutTrailingZeros(glp.peso_neto_posterior))}</td>
        </tr>
        <tr>
            <td class="num">17</td>
            <td>Carga útil (Kg.)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(formatNumberWithoutTrailingZeros(glp.carga_util_posterior))}</td>
        </tr>
    </table>

    <div class="verif-title">Habiéndose verificado que:</div>
    <ol class="verif-list">
        ${verifHtml}
    </ol>

    <div class="conclusion" data-sistema-edicion="declaracion">
        Conste por el presente documento que el sistema de combustión a Gas Licuado de Petróleo-GLP del vehículo antes referido, no afecta negativamente la seguridad del mismo, el tránsito terrestre, el medio ambiente o incumple con las condiciones técnicas establecidas en la normativa vigente en la materia, según consta en el expediente técnico <strong>N.º ${escapeHtml(numCertificado)}</strong> habilitándose al mismo para cargar Gas Licuado de Petróleo-GLP, hasta el <strong>${escapeHtml(vigenciaHastaFmt)}</strong>.
    </div>

<div class="obs-sec" data-sistema-edicion="observaciones-previas">
        <strong>Observaciones</strong>
        ${esTaller ? observacionesMostrar : (
            `<div>- Este documento no es válido en caso de presentar cualquier tipo de alteración o enmendadura.</div>
            <div>- Este documento es válido únicamente en original, con firma y sello del representante y del ingeniero supervisor.</div>
            <div>- Las abreviaturas: S/V significa “Sin Versión”, NE significa “No Especificado en los documentos presentados”</div>
            <div>- Las condiciones técnicas y de seguridad verificadas en el vehículo, corresponden a las expuestas en la Directiva No. 005-2007-MTC/15 y sus modificatorias.</div>
            <div>- El presente Certificado es emitido a solicitud del taller autorizado <strong>CHARING S.A.C. Calle San Pedro N° 745 Surquillo Lima</strong>.</div>`
        )}
    </div>

    <div class="footer-sec" style="margin-top: 5pt; font-weight: bold; text-align: center;" data-sistema-edicion="pie">
        Se expide el presente certificado en la Provincia Constitucional del Callao a los ${fechaImp.dia} días del mes de ${fechaImp.mes} del ${fechaImp.anio}.
    </div>
        </div>
    </div>
</body>
</html>`;
}

module.exports = generateGlpInicialHtml;
