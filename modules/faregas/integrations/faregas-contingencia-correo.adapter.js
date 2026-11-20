const { createHash } = require('node:crypto');
const config = require('../../../config/integrations.config');

let nodemailer;
try {
    nodemailer = require('nodemailer');
} catch {
    // Si nodemailer no está cargado en el entorno, se conserva fallback HTTPS relay
}

const correoValido = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
    && String(value).trim().length <= 254;

const enlaceNubeFact = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password
            && (url.hostname === 'nubefact.com' || url.hostname.endsWith('.nubefact.com'));
    } catch { return false; }
};

const enviar = async (doc, options = {}) => {
    const ajustes = options.config || config.contingencia;
    const smtpConfig = options.smtp || config.smtp || {};

    const emailDestino = String(doc.email || '').trim();
    if (!correoValido(emailDestino)) {
        return { sinCorreo: true, codigo: 'SIN_CORREO_VALIDO' };
    }

    if (!enlaceNubeFact(doc.enlace_pdf)) {
        return { revision: true, codigo: 'PDF_FISCAL_NO_VERIFICABLE' };
    }

    // 1. Envío mediante HTTPS Relay
    if (ajustes.correoUrl && ajustes.correoToken && ajustes.correoIdempotente) {
        if (correoValido(ajustes.correoDestinoDemo) && emailDestino.toLowerCase() !== ajustes.correoDestinoDemo.trim().toLowerCase()) {
            return { revision: true, codigo: 'CORREO_DEMO_FUERA_DEL_BUZON_AUTORIZADO' };
        }
        const send = options.fetch || fetch;
        try {
            const response = await send(ajustes.correoUrl, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(15000),
                headers: {
                    Authorization: 'Bearer ' + ajustes.correoToken,
                    'Content-Type': 'application/json',
                    'Idempotency-Key': 'faregas-demo-' + createHash('sha256')
                        .update([ajustes.baseAislada, doc.facturacion_id, doc.codigo_unico].join('|')).digest('hex')
                },
                body: JSON.stringify({
                    para: emailDestino,
                    asunto: 'DEMO | Comprobante regularizado ' + doc.nro_comprobante,
                    texto: [
                        doc.nombre_razon_social || 'Cliente',
                        'Su comprobante pendiente ya está disponible.',
                        'Comprobante: ' + doc.nro_comprobante,
                        'Fecha fiscal: ' + doc.fecha_fiscal_original,
                        'Certificado: ' + doc.numero_certificado,
                        'PDF: ' + doc.enlace_pdf,
                        ...(ajustes.correoAdjuntarXml && enlaceNubeFact(doc.enlace_xml) ? ['XML: ' + doc.enlace_xml] : [])
                    ].join('\n')
                })
            });
            if ([408, 425, 429].includes(response.status) || response.status >= 500) return { codigo: 'CORREO_TEMPORAL_' + response.status };
            if (!response.ok) return { revision: true, codigo: 'CORREO_RECHAZADO_' + response.status };
            const body = await response.json().catch(() => null);
            if (body?.aceptado !== true || typeof body.referencia !== 'string' || !/^[\w.:-]{1,120}$/.test(body.referencia)) {
                return { codigo: 'CORREO_RESPUESTA_INCIERTA' };
            }
            return { referencia: body.referencia };
        } catch {
            return { codigo: 'CORREO_TRANSPORTE_INCIERTO' };
        }
    }

    // 2. Envío mediante SMTP institucional estándar
    if (smtpConfig.host && smtpConfig.user && smtpConfig.pass) {
        if (correoValido(ajustes.correoDestinoDemo) && emailDestino.toLowerCase() !== ajustes.correoDestinoDemo.trim().toLowerCase()) {
            return { revision: true, codigo: 'CORREO_DEMO_FUERA_DEL_BUZON_AUTORIZADO' };
        }
        try {
            const transport = options.transporter || (nodemailer ? nodemailer.createTransport({
                host: smtpConfig.host,
                port: smtpConfig.port || 587,
                secure: smtpConfig.secure === true,
                auth: { user: smtpConfig.user, pass: smtpConfig.pass },
                connectionTimeout: 10000,
                greetingTimeout: 5000,
                socketTimeout: 15000
            }) : null);
            if (!transport) {
                return { revision: true, codigo: 'SMTP_MODULO_NO_DISPONIBLE' };
            }
            const info = await transport.sendMail({
                from: smtpConfig.from || smtpConfig.user,
                to: emailDestino,
                subject: 'Comprobante electrónico ' + doc.nro_comprobante + ' - FAREGAS',
                text: [
                    'Estimado(a) ' + (doc.nombre_razon_social || 'Cliente') + ',',
                    '',
                    'Se ha emitido y regularizado su comprobante electrónico ' + doc.nro_comprobante + ' para el certificado ' + doc.numero_certificado + '.',
                    'Fecha fiscal: ' + doc.fecha_fiscal_original,
                    '',
                    'Puede consultar y descargar su comprobante en los siguientes enlaces oficiales:',
                    'Comprobante PDF: ' + doc.enlace_pdf,
                    ...(ajustes.correoAdjuntarXml && enlaceNubeFact(doc.enlace_xml) ? ['Archivo XML: ' + doc.enlace_xml] : []),
                    '',
                    'Atentamente,',
                    'FAREGAS'
                ].join('\n')
            });
            if (info && (info.messageId || info.response)) {
                return { referencia: String(info.messageId || info.response).slice(0, 120) };
            }
            return { codigo: 'SMTP_RESPUESTA_SIN_REFERENCIA' };
        } catch (smtpError) {
            if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET'].includes(smtpError?.code)) {
                return { codigo: 'SMTP_TEMPORAL_' + smtpError.code };
            }
            if (smtpError?.responseCode >= 500 || ['EAUTH', 'EENVELOPE'].includes(smtpError?.code)) {
                return { revision: true, codigo: 'SMTP_RECHAZADO_' + (smtpError.code || smtpError.responseCode) };
            }
            return { codigo: 'SMTP_TRANSPORTE_INCIERTO' };
        }
    }

    // 3. Si no existe ningún proveedor de correo configurado
    return { revision: true, codigo: 'CORREO_DEMO_NO_CONFIGURADO' };
};

module.exports = { correoValido, enviar };
