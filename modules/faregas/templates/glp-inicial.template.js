const { escapeHtml, formatDateLong, formatDateShort } = require('./template-utils');

function generateGlpInicialHtml(data, options = { modo: "PREVIEW" }) {
    const cert = data.cabecera || {};
    const veh = data.vehiculo || {};
    const glp = data.glp || {};
    const componentes = data.componentes || [];
    const verifs = data.verificaciones || [];
    const titulares = data.titulares || [];

    const numCertificado = options.modo === 'FINAL' ? (cert.numero_certificado || '') : 'DG-41-PREVIEW';

    const fechaImp = formatDateLong(cert.fecha_emision);
    const vigenciaHastaFmt = formatDateShort(glp.vigencia_hasta);

    const propietarioNombre = titulares.length > 0
        ? titulares.map(t => t.nombre_razon_social).join(' / ')
        : (cert.cliente_nombre || '-');

    const tallerDisplay = 'CHARING S.A.C. Calle San Pedro N° 745 Surquillo Lima';

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
            const cap = c.capacidad_litros ? `${c.capacidad_litros} LTS` : '';
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
        body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 10.5px;
            color: #000;
            line-height: 1.3;
            margin: 0;
            padding: 20px;
            background-color: #fff;
            position: relative;
            overflow-wrap: anywhere;
            word-break: break-word;
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
            margin-bottom: 10px;
        }
        .header-sub {
            font-size: 9px;
            color: #333;
            line-height: 1.25;
            text-align: left;
        }
        .title {
            font-size: 13.5px;
            font-weight: bold;
            margin: 10px 0 4px 0;
            text-align: center;
            text-transform: uppercase;
        }
        .cert-num {
            font-size: 11.5px;
            font-weight: bold;
            text-align: right;
            margin-bottom: 8px;
        }
        .certifica-hdr {
            text-align: center;
            font-weight: bold;
            font-size: 10.5px;
            margin: 8px 0 4px 0;
        }
        .certifica-p {
            text-align: justify;
            margin-bottom: 8px;
            font-size: 10px;
        }
        table.data-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
            font-size: 9.5px;
        }
        table.data-table td {
            border: 1px solid #000;
            padding: 3px 5px;
            vertical-align: middle;
        }
        table.data-table td.num {
            width: 20px;
            text-align: center;
            font-weight: bold;
        }
        table.data-table td.val {
            font-weight: bold;
            background-color: transparent;
        }
        .comp-title {
            font-size: 10px;
            margin: 6px 0;
        }
        table.comp-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 8px;
            font-size: 9.5px;
        }
        table.comp-table th, table.comp-table td {
            border: 1px solid #000;
            padding: 3px 5px;
        }
        table.comp-table th {
            background-color: #f8fafc;
            font-weight: bold;
        }
        .verif-title {
            font-weight: bold;
            margin: 8px 0 4px 0;
            font-size: 10px;
        }
        ol.verif-list {
            padding-left: 0;
            list-style: none;
            margin: 0 0 8px 0;
            text-align: justify;
            font-size: 9.5px;
        }
        .obs-sec {
            margin-top: 8px;
            font-size: 9px;
            line-height: 1.3;
        }
        .footer-sec {
            margin-top: 14px;
            font-size: 10px;
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
                    R.D. N.º 0339-2024-MTC/17.03<br>
                    Domicilio Fiscal: Jr. Alberto Secada N.°315 Prov.<br>
                    Const del Callao – Prov. Const del Callao.<br>
                    Celular: 966702160
                </div>
                <div class="title" style="margin-top: 10px; margin-bottom: 10px;">CERTIFICADO DE CONFORMIDAD DE CONVERSION GLP</div>
                <div style="font-weight: bold; font-size: 14px; margin-bottom: 10px; letter-spacing: 0.5px; text-align: center;">SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.</div>
                <div class="cert-num">Certificado N°${escapeHtml(numCertificado)}</div>
            </div>
            
            <div style="text-align: center; font-weight: bold; font-size: 13px; margin-bottom: 10px;">CERTIFICA</div>

    <div class="certifica-p">
        Haber efectuado la evaluación de las condiciones de seguridad respecto de la conversión del sistema de combustión a Gas Licuado de Petróleo - GLP efectuada por el Taller de Conversión a GLP Autorizado: <strong>CHARING S.A.C. - Calle San Pedro N° 745 Surquillo Lima</strong>, al siguiente vehículo:
    </div>

    <table class="data-table">
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
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.cilindros || '-')} / ${escapeHtml(veh.cilindrada || '-')}</td>
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
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.ejes || '-')} / ${escapeHtml(veh.ruedas || '-')}</td>
        </tr>
        <tr>
            <td class="num">5</td>
            <td>Modelo</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.modelo || '-')}</td>
            <td class="num">13</td>
            <td>N° Asientos / Pasajeros</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.asientos || '-')} / ${escapeHtml(veh.pasajeros || '-')}</td>
        </tr>
        <tr>
            <td class="num">6</td>
            <td>Versión</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.version || '-')}</td>
            <td class="num">14</td>
            <td>Largo / Ancho / Alto (m)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.longitud || '-')} / ${escapeHtml(veh.ancho || '-')} / ${escapeHtml(veh.altura || '-')}</td>
        </tr>
        <tr>
            <td class="num">7</td>
            <td>Año de fabricación</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.ano_fabricacion || '-')}</td>
            <td class="num">15</td>
            <td>Peso neto (kg.)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.peso_seco || veh.peso_neto || '-')}</td>
        </tr>
        <tr>
            <td class="num">8</td>
            <td>VIN / N° de Serie</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.vin || veh.serie || '-')}</td>
            <td class="num">16</td>
            <td>Peso bruto vehicular (kg.)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.peso_bruto || '-')}</td>
        </tr>
        <tr>
            <td class="num">9</td>
            <td>N° de motor</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.motor || '-')}</td>
            <td class="num">17</td>
            <td>Carga útil (kg.)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(veh.carga_util || '-')}</td>
        </tr>
    </table>

    <div class="comp-title">Que cuenta con los siguientes componentes que permiten la combustión a GLP:</div>
    <table class="comp-table">
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

    <div class="comp-title" style="margin-top: 10px;">Como consecuencia de la conversión del sistema de combustión a GLP, las características originales del vehículo se han modificado<br>De la siguiente manera:</div>
    <table class="data-table" style="margin-bottom: 8px;">
        <tr>
            <td class="num">11</td>
            <td style="width: 140px;">Combustible</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(glp.combustible_posterior || 'BI-COMBUSTIBLE GLP')}</td>
        </tr>
        <tr>
            <td class="num">15</td>
            <td>Peso neto (Kg.)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(glp.peso_neto_posterior || '-')}</td>
        </tr>
        <tr>
            <td class="num">17</td>
            <td>Carga útil (Kg.)</td>
            <td class="val" style="background-color: transparent;">${escapeHtml(glp.carga_util_posterior || '-')}</td>
        </tr>
    </table>

    <div class="verif-title">Habiéndose verificado que:</div>
    <ol class="verif-list">
        ${verifHtml}
    </ol>

    <div style="text-align: justify; font-size: 9.5px; margin-bottom: 8px;">
        Conste por el presente documento que el sistema de combustión a Gas Licuado de Petróleo-GLP del vehículo antes referido, no afecta negativamente la seguridad del mismo, el tránsito terrestre, el medio ambiente o incumple con las condiciones técnicas establecidas en la normativa vigente en la materia, según consta en el expediente técnico <strong>N.º ${escapeHtml(glp.expediente_tecnico || numCertificado)}</strong> habilitándose al mismo para cargar Gas Licuado de Petróleo-GLP, hasta el <strong>${escapeHtml(vigenciaHastaFmt)}</strong>.
    </div>

    <div class="obs-sec">
        <strong>Observaciones</strong>
        <div>Este documento no es válido en caso de presentar cualquier tipo de alteración o enmendadura.</div>
        <div>- Este documento es válido únicamente en original, con firma y sello del ingeniero supervisor.</div>
        <div>- Las abreviaturas: S/V significa “Sin Versión”, NE significa “No Especificado en los documentos presentados”</div>
        <div>- Las condiciones técnicas y de seguridad verificadas en el vehículo, corresponden a las expuestas en la Directiva No. 005-2007-MTC/15.</div>
        <div>- El presente Certificado es emitido a solicitud del taller autorizado <strong>CHARING S.A.C. Calle San Pedro N° 745 Surquillo Lima</strong>.</div>
    </div>

    <div class="footer-sec" style="margin-top: 10px; font-weight: bold; text-align: center;">
        Se expide el presente certificado en la Provincia Constitucional del Callao a los ${fechaImp.dia} días del mes de ${fechaImp.mes} del ${fechaImp.anio}.
    </div>
        </div>
    </div>
</body>
</html>`;
}

module.exports = generateGlpInicialHtml;
