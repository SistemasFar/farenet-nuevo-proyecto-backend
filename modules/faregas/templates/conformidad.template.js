const {
    escapeHtml,
    formatDateLong,
    formatNumberWithoutTrailingZeros,
    formatTechnicalNumberExpression,
    formatCountTwoDigits,
    NUMERO_CERTIFICADO_PENDIENTE
} = require('./template-utils');

function generateConformidadHtml(data, options = { modo: "PREVIEW" }) {
    const variablesDinamicas = options.variablesDinamicas === true;
    const cert = data.cabecera || {};
    const veh = data.vehiculo || {};
    const conf = data.conformidad || {};
    const titulares = data.titulares || [];

    const numCertificado = cert.numero_certificado || NUMERO_CERTIFICADO_PENDIENTE;
    const fechaImp = variablesDinamicas
        ? {
            dia: '{{documento.fecha_dia}}',
            mes: '{{documento.fecha_mes}}',
            anio: '{{documento.fecha_anio}}'
        }
        : formatDateLong(cert.fecha_emision);

    const propietarioNombre = titulares.length > 0
        ? titulares.map(t => t.nombre_razon_social).join(' / ')
        : (cert.cliente_nombre || '-');

    // Regla documental exclusiva de Conformidad. No usa ni modifica la
    // dirección particular del titular ni la dirección fiscal de facturación.
    const propietarioDireccion = 'LIMA';

    const tipoConf = String(conf.tipo_conformidad || '').toUpperCase();

    const caracRegText = variablesDinamicas
        ? '{{conformidad.caracteristica_registrable}}'
        : conf.caracteristica_registrable
        ? escapeHtml(conf.caracteristica_registrable.toUpperCase())
        : '-';

    const claseTipo = (tipo) => variablesDinamicas
        ? `{{conformidad.clase_${tipo.toLowerCase()}}}`
        : (tipoConf === tipo ? 'active' : '');
    const marcaTipo = (tipo, valor) => variablesDinamicas
        ? `{{conformidad.marca_${tipo.toLowerCase()}}}`
        : (valor ? 'X' : '');
    const bloquePreview = variablesDinamicas
        ? `<div class="watermark {{documento.clase_preview}}">PREVISUALIZACIÓN</div>
    <div class="preview-badge {{documento.clase_preview}}">⚠️ BORRADOR FAREGAS — PREVISUALIZACIÓN NO EMITIDA (DOCUMENTO SIN VALIDEZ LEGAL)</div>`
        : (options.modo === "PREVIEW" ? `<div class="watermark">PREVISUALIZACIÓN</div>
    <div class="preview-badge">⚠️ BORRADOR FAREGAS — PREVISUALIZACIÓN NO EMITIDA (DOCUMENTO SIN VALIDEZ LEGAL)</div>` : "");

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
        html {
            width: 210mm;
            min-height: 297mm;
            background: #fff;
        }
        body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 10pt;
            color: #000;
            line-height: 12pt;
            margin: 0;
            padding: 107.45pt 29.5pt 70.9pt 84.75pt;
            width: 210mm;
            min-height: 297mm;
            box-sizing: border-box;
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
            position: absolute;
            top: 30pt;
            left: 84.75pt;
            width: 481.05pt;
            box-sizing: border-box;
            background-color: #fef3c7;
            border: 1pt dashed #f59e0b;
            color: #92400e;
            padding: 3pt 6pt;
            text-align: center;
            font-weight: bold;
            font-size: 7.5pt;
            line-height: 9pt;
            letter-spacing: .35pt;
            border-radius: 3pt;
            z-index: 3;
        }
        .preview-hidden { display: none !important; }
        /* TipTap conserva los bloques editables como <p>. Sus márgenes de
           navegador no deben agrandar celdas ni generar una segunda hoja. */
        .documento-certificado p { margin: 0; }
        body > p:last-child:empty { display: none; }
        .header {
            margin: 0;
            text-align: center;
        }
        .header-sub {
            position: absolute;
            top: 71.9pt;
            left: 22.7pt;
            width: 253.6pt;
            height: 48.55pt;
            box-sizing: border-box;
            font-size: 8pt;
            color: #000;
            line-height: 9.6pt;
            text-align: center !important;
        }
        .title {
            font-size: 13pt;
            line-height: 15.6pt;
            font-weight: bold;
            margin: 18.55pt 0 0;
            text-align: center;
            text-transform: uppercase;
        }
        .cert-num {
            font-size: 10pt;
            line-height: 12pt;
            font-weight: bold;
            text-align: right;
            margin: 14.4pt 0 0;
        }
        table.type-box {
            width: 219.7pt;
            margin: 15pt auto 9pt;
            border-collapse: collapse;
            font-size: 10pt;
            line-height: 11.25pt;
            font-weight: bold;
            text-align: center;
            table-layout: fixed;
        }
        table.type-box td {
            border: .5pt solid #000;
            height: 12pt;
            padding: 0 2pt;
            box-sizing: border-box;
        }
        table.type-box td.active {
            background-color: #e2e8f0;
        }
        .certifica-p {
            text-align: justify;
            margin: 0 0 2pt;
            font-size: 10pt;
            line-height: 12pt;
        }
        table.type-box + .certifica-p { margin-bottom: 12pt; }
        table.owner-box {
            width: 481.05pt;
            border-collapse: collapse;
            margin: 0 0 4pt;
            font-size: 9pt;
            line-height: 12pt;
            table-layout: fixed;
        }
        table.owner-box td {
            border: .5pt solid #000;
            padding: 1.5pt 4pt;
            box-sizing: border-box;
            vertical-align: middle;
        }
        table.owner-box tr:first-child td { height: 27.1pt; }
        table.owner-box tr:nth-child(2) td { height: 16.35pt; }
        .section-heading {
            margin: 0 0 8pt;
            font-size: 10pt;
            line-height: 12pt;
            font-weight: bold;
        }
        table.data-table {
            width: 480.3pt;
            border-collapse: collapse;
            margin: 0 0 0;
            font-size: 9pt;
            line-height: 11pt;
            table-layout: fixed;
        }
        table.data-table td {
            border: .5pt solid #000;
            height: 11.75pt;
            padding: .65pt 3.5pt;
            box-sizing: border-box;
            vertical-align: middle;
            overflow-wrap: break-word;
        }
        table.data-table tr:first-child td { height: 27.35pt; }
        table.data-table tr:nth-child(2) td { height: 19.7pt; }
        table.data-table td:nth-child(1) { width: 123.15pt; }
        table.data-table td:nth-child(2) { width: 123.25pt; }
        table.data-table td:nth-child(3) { width: 113.4pt; }
        table.data-table td:nth-child(4) { width: 120.5pt; }
        table.data-table td.hdr {
            font-weight: bold;
            background-color: #f8fafc;
        }
        table.data-table td.val {
            font-weight: bold;
        }
        .spec-para {
            font-weight: bold;
            font-size: 10pt;
            line-height: 12pt;
            margin: 12pt 0 10.5pt;
            text-transform: uppercase;
        }
        .grant-line {
            font-size: 9pt;
            line-height: 12pt;
            margin: 0;
        }
        .legal-p {
            text-align: justify;
            margin: 0 0 6pt;
            font-size: 9pt;
            line-height: 12pt;
        }
        .footer-date {
            margin-top: 16.5pt;
            text-align: right;
            font-size: 10pt;
            line-height: 12pt;
        }
    </style>
</head>
<body>
    ${bloquePreview}

    <div class="documento-certificado">
        <div class="cert-content">
            <div class="header">
                <div class="header-sub" style="text-align: left;">
            R.D. N° 282-2022-MTC/17.03<br>
            Domicilio Fiscal: Calle San Pedro N° 745, Surquillo, Lima, Lima<br>
            Distrito de Surquillo – Provincia y Departamento de Lima<br>
            Celular: 966702160
        </div>
        <div class="title" data-sistema-edicion="titulo">CERTIFICADO DE CONFORMIDAD</div>
        <div class="cert-num">Certificado N°${escapeHtml(numCertificado)}</div>
    </div>

    <table class="type-box">
        <tr>
            <td style="width: 50%;" class="${claseTipo('MODIFICACION')}">MODIFICACION</td>
            <td style="width: 50%; text-align: center; font-weight: bold;">${marcaTipo('MODIFICACION', conf.marca_modificacion)}</td>
        </tr>
        <tr>
            <td style="width: 50%;" class="${claseTipo('MONTAJE')}">MONTAJE</td>
            <td style="width: 50%; text-align: center; font-weight: bold;">${marcaTipo('MONTAJE', conf.marca_montaje)}</td>
        </tr>
        <tr>
            <td style="width: 50%;" class="${claseTipo('FABRICACION')}">FABRICACION</td>
            <td style="width: 50%; text-align: center; font-weight: bold;">${marcaTipo('FABRICACION', conf.marca_fabricacion)}</td>
        </tr>
    </table>

    <div class="certifica-p">
        La empresa SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRÚAS S.A.C. Reconocida como Entidad Certificadora de Conformidad con RESOLUCIÓN DIRECTORAL N°282-2022 MTC/15.
    </div>
    <div class="certifica-p">
        <strong data-sistema-edicion="titulo-certifica">CERTIFICA:</strong> Haber realizado la inspección técnica del vehículo: <strong>${escapeHtml(veh.placa || cert.placa_nueva || '-')}</strong>
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

    <div class="section-heading">LAS CARACTERISTICAS REGISTRABLES FINALES DEL VEHICULO SON:</div>

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
            <td class="val">${escapeHtml(formatNumberWithoutTrailingZeros(veh.altura))}</td>
        </tr>
        <tr>
            <td>Modelo</td>
            <td class="val">${escapeHtml(veh.modelo || '-')}</td>
            <td>Ancho (metros)</td>
            <td class="val">${escapeHtml(formatNumberWithoutTrailingZeros(veh.ancho))}</td>
        </tr>
        <tr>
            <td>Marca</td>
            <td class="val">${escapeHtml(veh.marca || '-')}</td>
            <td>Peso bruto (kg)</td>
            <td class="val">${escapeHtml(formatNumberWithoutTrailingZeros(veh.peso_bruto))}</td>
        </tr>
        <tr>
            <td>Serie / Chasis</td>
            <td class="val">${escapeHtml(veh.serie || veh.vin || '-')}</td>
            <td>Peso neto (kg)</td>
            <td class="val">${escapeHtml(formatNumberWithoutTrailingZeros(veh.peso_seco || veh.peso_neto))}</td>
        </tr>
        <tr>
            <td>Motor</td>
            <td class="val">${escapeHtml(veh.motor || '-')}</td>
            <td>Carga útil (kg)</td>
            <td class="val">${escapeHtml(formatNumberWithoutTrailingZeros(veh.carga_util))}</td>
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
            <td class="val">${escapeHtml(formatTechnicalNumberExpression(veh.potencia))}</td>
            <td>Nº Ejes</td>
            <td class="val">${escapeHtml(formatCountTwoDigits(veh.ejes))}</td>
        </tr>
        <tr>
            <td>Asientos / Pasajeros</td>
            <td class="val">${escapeHtml(formatCountTwoDigits(veh.asientos))} / ${escapeHtml(formatCountTwoDigits(veh.pasajeros))}</td>
            <td>Nº Ruedas</td>
            <td class="val">${escapeHtml(formatCountTwoDigits(veh.ruedas))}</td>
        </tr>
        <tr>
            <td>Cilindrada (cc) / Cilindros</td>
            <td class="val">${escapeHtml(formatNumberWithoutTrailingZeros(veh.cilindrada))} / ${escapeHtml(formatCountTwoDigits(veh.cilindros))}</td>
            <td>Versión</td>
            <td class="val">${escapeHtml(veh.version || '-')}</td>
        </tr>
        <tr>
            <td>Longitud (metros)</td>
            <td class="val">${escapeHtml(formatNumberWithoutTrailingZeros(veh.longitud))}</td>
            <td>VIN</td>
            <td class="val">${escapeHtml(veh.vin || veh.serie || '-')}</td>
        </tr>
    </table>

    <div class="grant-line">
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
        El vehículo originalmente diseñado y construido para transporte de <strong>${escapeHtml(conf.uso_original_vehiculo || '-')}</strong>.
    </div>

    <div class="footer-date" data-sistema-edicion="pie">
        Lima, <strong>${fechaImp.dia}</strong> de <strong>${fechaImp.mes}</strong> del <strong>${fechaImp.anio}</strong>.
    </div>
        </div>
    </div>
</body>
</html>`;
}

module.exports = generateConformidadHtml;

// El diseñador y el renderer histórico comparten deliberadamente esta misma
// función estructural. La fábrica sólo cambia valores reales por variables;
// no mantiene una segunda copia del certificado oficial.
const variable = (key) => `{{${key}}}`;

function crearPlantillaConformidadHtml() {
    return generateConformidadHtml({
        cabecera: {
            numero_certificado: variable('certificado.numero'),
            cliente_nombre: variable('titular.nombre'),
            placa_nueva: variable('vehiculo.placa')
        },
        vehiculo: {
            placa: variable('vehiculo.placa'),
            clase: variable('vehiculo.clase'),
            categoria: variable('vehiculo.categoria'),
            modelo: variable('vehiculo.modelo'),
            marca: variable('vehiculo.marca'),
            serie: variable('vehiculo.serie_chasis'),
            vin: variable('vehiculo.vin'),
            motor: variable('vehiculo.motor'),
            color: variable('vehiculo.color'),
            carroceria: variable('vehiculo.carroceria'),
            combustible: variable('vehiculo.combustible'),
            potencia: variable('vehiculo.potencia'),
            asientos: variable('vehiculo.asientos'),
            pasajeros: variable('vehiculo.pasajeros'),
            cilindrada: variable('vehiculo.cilindrada'),
            cilindros: variable('vehiculo.cilindros'),
            longitud: variable('vehiculo.longitud'),
            altura: variable('vehiculo.altura'),
            ancho: variable('vehiculo.ancho'),
            peso_bruto: variable('vehiculo.peso_bruto'),
            peso_seco: variable('vehiculo.peso_neto'),
            peso_neto: variable('vehiculo.peso_neto'),
            carga_util: variable('vehiculo.carga_util'),
            ano_fabricacion: variable('vehiculo.anio_fabricacion'),
            ano_modelo: variable('vehiculo.anio_modelo'),
            formula_rodante: variable('vehiculo.formula_rodante'),
            ejes: variable('vehiculo.ejes'),
            ruedas: variable('vehiculo.ruedas'),
            version: variable('vehiculo.version')
        },
        conformidad: {
            caracteristica_registrable: variable('conformidad.caracteristica_registrable'),
            uso_original_vehiculo: variable('conformidad.uso_original_vehiculo')
        },
        titulares: []
    }, { modo: 'PREVIEW', variablesDinamicas: true });
}

module.exports.crearPlantillaConformidadHtml = crearPlantillaConformidadHtml;
