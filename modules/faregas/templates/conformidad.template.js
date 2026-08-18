const { escapeHtml, formatDateLong } = require('./template-utils');

function generateConformidadHtml(data, options = { modo: "PREVIEW" }) {
    const cert = data.cabecera || {};
    const veh = data.vehiculo || {};
    const conf = data.conformidad || {};
    const titulares = data.titulares || [];

    const numCertificado = options.modo === 'FINAL' ? (cert.numero_certificado || '') : 'DG-39-PREVIEW';
    const fechaImp = formatDateLong(cert.fecha_emision);

    const propietarioNombre = titulares.length > 0
        ? titulares.map(t => t.nombre_razon_social).join(' / ')
        : (cert.cliente_nombre || '-');

    const propietarioDireccion = titulares.length > 0
        ? (titulares[0].direccion || '-')
        : '-';

    const tipoConf = (conf.tipo_conformidad || 'MODIFICACION').toUpperCase();

    const caracRegText = conf.caracteristica_registrable
        ? escapeHtml(conf.caracteristica_registrable.toUpperCase())
        : '-';

    const entNombre = cert.entidad_certificadora_nombre || '-';
    const resDirectoral = cert.resolucion_directoral || '-';
    const domFiscal = cert.domicilio_fiscal || '-';
    const telfCert = cert.telefono_certificadora || '-';
    const lugarEmision = cert.lugar_emision || '-';

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Certificado de Conformidad - Previsualización</title>
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
        }
        .title {
            font-size: 14px;
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
        table.type-box {
            width: 500px;
            margin: 0 auto 12px auto;
            border-collapse: collapse;
            font-size: 10px;
            font-weight: bold;
            text-align: center;
            table-layout: fixed;
        }
        table.type-box td {
            border: 1px solid #000;
            padding: 4px;
        }
        table.type-box td.active {
            background-color: #e2e8f0;
        }
        .certifica-p {
            text-align: justify;
            margin-bottom: 10px;
            font-size: 10px;
            line-height: 1.35;
        }
        table.owner-box {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
            font-size: 10px;
        }
        table.owner-box td {
            border: 1px solid #000;
            padding: 4px 6px;
        }
        table.data-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
            font-size: 9.5px;
        }
        table.data-table td {
            border: 1px solid #000;
            padding: 3.5px 6px;
            vertical-align: middle;
        }
        table.data-table td.hdr {
            font-weight: bold;
            background-color: #f8fafc;
        }
        table.data-table td.val {
            font-weight: bold;
        }
        .spec-para {
            font-weight: bold;
            font-size: 10.5px;
            margin: 12px 0;
            text-transform: uppercase;
        }
        .legal-p {
            text-align: justify;
            margin-bottom: 10px;
            font-size: 9.5px;
            line-height: 1.35;
        }
        .footer-date {
            margin-top: 25px;
            text-align: right;
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
                <div class="header-sub" style="text-align: left;">
            R.D. N° 282-2022-MTC/17.03<br>
            Domicilio Fiscal: Calle San Pedro N° 745, Surquillo, Lima, Lima<br>
            Distrito de Surquillo – Provincia y Departamento de Lima<br>
            Celular: 966702160
        </div>
        <div class="title">CERTIFICADO DE CONFORMIDAD</div>
        <div class="cert-num">Certificado N°${escapeHtml(numCertificado)}</div>
    </div>

    <table class="type-box">
        <tr>
            <td style="width: 50%;" class="${tipoConf === 'MODIFICACION' ? 'active' : ''}">MODIFICACION</td>
            <td style="width: 50%; text-align: center; font-weight: bold;">${conf.marca_modificacion ? 'X' : ''}</td>
        </tr>
        <tr>
            <td style="width: 50%;" class="${tipoConf === 'MONTAJE' ? 'active' : ''}">MONTAJE</td>
            <td style="width: 50%; text-align: center; font-weight: bold;">${conf.marca_montaje ? 'X' : ''}</td>
        </tr>
        <tr>
            <td style="width: 50%;" class="${tipoConf === 'FABRICACION' ? 'active' : ''}">FABRICACION</td>
            <td style="width: 50%; text-align: center; font-weight: bold;">${conf.marca_fabricacion ? 'X' : ''}</td>
        </tr>
    </table>

    <div class="certifica-p">
        La empresa SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRÚAS S.A.C. Reconocida como Entidad Certificadora de Conformidad con RESOLUCIÓN DIRECTORAL N°282-2022 MTC/15.
    </div>
    <div class="certifica-p">
        <strong>CERTIFICA:</strong> Haber realizado la inspección técnica del vehículo: <strong>${escapeHtml(veh.placa || cert.placa_nueva || '-')}</strong>
    </div>

    <table class="owner-box">
        <tr>
            <td colspan="2">Razón social/Persona natural: <span class="val">${escapeHtml(propietarioNombre)}</span></td>
        </tr>
        <tr>
            <td style="width: 50%;">Placa de rodaje: <strong>${escapeHtml(veh.placa || cert.placa_nueva || '-')}</strong></td>
            <td style="width: 50%;">Clase: <strong>${escapeHtml(veh.clase || '-')}</strong></td>
        </tr>
    </table>

    <div style="font-weight: bold; font-size: 10px; margin-bottom: 4px;">LAS CARACTERISTICAS REGISTRABLES FINALES DEL VEHICULO SON:</div>

    <table class="data-table">
        <tr>
            <td colspan="4">Razón social/Persona natural: <strong>${escapeHtml(propietarioNombre)}</strong></td>
        </tr>
        <tr>
            <td colspan="4">Dirección: <strong>${escapeHtml(propietarioDireccion)}</strong></td>
        </tr>
        <tr>
            <td style="width: 140px;">Categoría</td>
            <td class="val">${escapeHtml(veh.categoria || '-')}</td>
            <td style="width: 140px;">Altura (metros)</td>
            <td class="val">${escapeHtml(veh.altura || '-')}</td>
        </tr>
        <tr>
            <td>Modelo</td>
            <td class="val">${escapeHtml(veh.modelo || '-')}</td>
            <td>Ancho (metros)</td>
            <td class="val">${escapeHtml(veh.ancho || '-')}</td>
        </tr>
        <tr>
            <td>Marca</td>
            <td class="val">${escapeHtml(veh.marca || '-')}</td>
            <td>Peso bruto (kg)</td>
            <td class="val">${escapeHtml(veh.peso_bruto || '-')}</td>
        </tr>
        <tr>
            <td>Serie / Chasis</td>
            <td class="val">${escapeHtml(veh.serie || veh.vin || '-')}</td>
            <td>Peso neto (kg)</td>
            <td class="val">${escapeHtml(veh.peso_seco || veh.peso_neto || '-')}</td>
        </tr>
        <tr>
            <td>Motor</td>
            <td class="val">${escapeHtml(veh.motor || '-')}</td>
            <td>Carga útil (kg)</td>
            <td class="val">${escapeHtml(veh.carga_util || '-')}</td>
        </tr>
        <tr>
            <td>Color</td>
            <td class="val">${escapeHtml(veh.color || '-')}</td>
            <td>Año de fabricación</td>
            <td class="val">${escapeHtml(veh.ano_fabricacion || '-')}</td>
        </tr>
        <tr>
            <td>Carrocería</td>
            <td class="val">${escapeHtml(veh.carroceria || '-')}</td>
            <td>Año de modelo</td>
            <td class="val">${escapeHtml(veh.ano_modelo || veh.ano_fabricacion || '-')}</td>
        </tr>
        <tr>
            <td>Combustible</td>
            <td class="val">${escapeHtml(veh.combustible || '-')}</td>
            <td>Fórmula rodante</td>
            <td class="val">${escapeHtml(veh.formula_rodante || '-')}</td>
        </tr>
        <tr>
            <td>Potencia (kw / rpm)</td>
            <td class="val">${escapeHtml(veh.potencia || '-')}</td>
            <td>Nº Ejes</td>
            <td class="val">${escapeHtml(veh.ejes || '-')}</td>
        </tr>
        <tr>
            <td>Asientos / Pasajeros</td>
            <td class="val">${escapeHtml(veh.asientos || '-')} / ${escapeHtml(veh.pasajeros || '-')}</td>
            <td>Nº Ruedas</td>
            <td class="val">${escapeHtml(veh.ruedas || '-')}</td>
        </tr>
        <tr>
            <td>Cilindrada (cc) / Cilindros</td>
            <td class="val">${escapeHtml(veh.cilindrada || '-')} / ${escapeHtml(veh.cilindros || '-')}</td>
            <td>Versión</td>
            <td class="val">${escapeHtml(veh.version || '-')}</td>
        </tr>
        <tr>
            <td>Longitud (metros)</td>
            <td class="val">${escapeHtml(veh.longitud || '-')}</td>
            <td>VIN</td>
            <td class="val">${escapeHtml(veh.vin || veh.serie || '-')}</td>
        </tr>
    </table>

    <div style="font-size: 9.5px; margin-bottom: 8px;">
        Se otorga la certificación de conformidad al vehículo de placa: <strong>${escapeHtml(veh.placa || cert.placa_nueva || '-')}</strong>
    </div>

    <div class="spec-para">
        ${caracRegText}
    </div>

    <div class="legal-p">
        El vehículo no ha sido modificado en sus características de fabricación originales, No altera o modifica su carrocería, Se respeta los parámetros de fabricante y cumple la normatividad vigente, Resolución del Superintendente Nacional de los Registros Públicos N°039 – 2013 – SUNARP / SN).
    </div>
    <div class="legal-p">
        En cumplimiento del D.S N°058-2003-MTC y modificatorias se procede a entregar el presente certificado de conformidad de la modificación, montaje o fabricación efectuada, El vehículo cumple los requisitos técnicos exigidos para el SNTT, no afecta negativamente su seguridad ni el medio ambiente.
    </div>
    <div class="legal-p">
        El vehículo originalmente diseñado y construido para transporte de <strong>${escapeHtml(conf.uso_original_vehiculo || 'PERSONAS')}</strong>.
    </div>

    <div class="footer-date">
        Lima, <strong>${fechaImp.dia}</strong> de <strong>${fechaImp.mes}</strong> del <strong>${fechaImp.anio}</strong>.
    </div>
        </div>
    </div>
</body>
</html>`;
}

module.exports = generateConformidadHtml;
